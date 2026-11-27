/*
 * `okf review-comments`: post each draft's `T001` finding, from
 * `okf check --review-file`, as a file-level review comment on the pull
 * request a GitHub Actions run is for, which the owner resolves to
 * acknowledge that the record merges as a draft.
 *
 * - A hidden marker names the record, the code, and the record's blob at the
 *   pull request's head, so a later run finds its own comment again by the
 *   record's text, not its line.
 *
 * - A comment it can't post, a draft outside the pull request's diff, and
 *   every draft when the pull request can't be read, print as annotations
 *   instead, so no draft goes unreported. Only a drafts file it can't read
 *   fails the run.
 *
 * - It calls GitHub with `fetch` and the job's `GITHUB_TOKEN`, which needs
 *   `pull-requests: write` to post and `contents: write` to resolve.
 */
import { readFileSync } from "node:fs";

import type { CheckFinding, CheckSeverity } from "./check-engine.ts";
import type { ExitCode } from "./exit-codes.ts";
import type { Outcome } from "./outcome.ts";
import type { Output } from "./output.ts";

import { formatAnnotation } from "./check.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { describeError, toTerminalLine } from "./output.ts";

/** The `fetch` a run calls GitHub with, injected so tests can answer. */
export type Fetch = typeof globalThis.fetch;

/** One thing a run does: post, edit, resolve, or annotate instead. */
export type ReviewAction =
  | {
      /**
       * The comment's new text.
       *
       * @example "**T001 draft** (info) …"
       */
      body: string;

      /**
       * The comment to edit.
       *
       * @example 2_400_000_001
       */
      commentId: number;

      /**
       * The draft it posts.
       *
       * @example `{ code: "T001", path: "docs/a.md", … }`
       */
      finding: CheckFinding;

      /**
       * Edit a comment of an earlier run.
       *
       * @example "update"
       */
      kind: "update";
    }
  | {
      /**
       * The comment's text.
       *
       * @example "**T001 draft** (info) …"
       */
      body: string;

      /**
       * The draft it posts.
       *
       * @example `{ code: "T001", path: "docs/a.md", … }`
       */
      finding: CheckFinding;

      /**
       * Post a new comment.
       *
       * @example "create"
       */
      kind: "create";
    }
  | {
      /**
       * The comment's text with its marker's blob set to `0`.
       *
       * @example "…okf check resolved this thread…"
       */
      body: string;

      /**
       * The thread's first comment, which holds the marker.
       *
       * @example 2_400_000_001
       */
      commentId: number;

      /**
       * Resolve a thread whose draft is no longer reported as it was.
       *
       * @example "resolve"
       */
      kind: "resolve";

      /**
       * The record the thread is on.
       *
       * @example "docs/a.md"
       */
      path: string;

      /**
       * The thread's GraphQL node ID.
       *
       * @example "PRRT_kwDO…"
       */
      threadId: string;
    }
  | {
      /**
       * The draft it annotates.
       *
       * @example `{ code: "T001", path: "docs/a.md", … }`
       */
      finding: CheckFinding;

      /**
       * Annotate the draft instead, as a file outside the diff needs.
       *
       * @example "annotate"
       */
      kind: "annotate";
    };

/** A review thread an earlier run started, read back by its marker. */
export type ReviewThread = {
  /**
   * The record's blob its marker names, or `0` once a run resolved it.
   *
   * @example "3b18e512dba79e4c8300dd08aeb37f8e728b8dad"
   */
  blob: string;

  /**
   * The finding's code its marker names.
   *
   * @example "T001"
   */
  code: string;

  /**
   * Its first comment's text.
   *
   * @example "**T001 draft** (info) …"
   */
  commentBody: string;

  /**
   * Its first comment's REST ID.
   *
   * @example 2_400_000_001
   */
  commentId: number;

  /**
   * Its GraphQL node ID.
   *
   * @example "PRRT_kwDO…"
   */
  id: string;

  /**
   * Whether someone resolved it.
   *
   * @example false
   */
  isResolved: boolean;

  /**
   * The record its marker names.
   *
   * @example "docs/a.md"
   */
  path: string;
};

/** The pinned spec a section such as §5.3 links to. */
const SPEC_URL =
  "https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md";

/** The marker that ends a comment: the record, the code, and the blob. */
const MARKER =
  /<!-- okf-check: (?<path>\S+) (?<code>\S+) (?<blob>[0-9a-f]+) -->$/u;

/** The logins a comment made with a workflow's `GITHUB_TOKEN` shows. */
const BOT_LOGINS = new Set(["github-actions", "github-actions[bot]"]);

/** What follows an `@` so it mentions no one, written as its code point. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x20_0b);

/** The page size GitHub's lists take at most. */
const PAGE_SIZE = 100;

/** GitHub lists at most 3,000 files of a pull request: 30 pages. */
const MAX_FILE_PAGES = 30;

/** The severities a drafts file may name. */
const SEVERITIES: readonly CheckSeverity[] = ["error", "info", "warning"];

/** The query for a page of a pull request's review threads. */
const THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes { id isResolved comments(first: 1) { nodes { author { login } body databaseId } } }
      }
    }
  }
}`;

/** The mutation that resolves a review thread. */
const RESOLVE_MUTATION = `mutation ($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id } }
}`;

/** How a run reaches GitHub, from the job's environment. */
type GitHubContext = {
  /**
   * The REST API's root.
   *
   * @example "https://api.github.com"
   */
  apiUrl: string;

  /**
   * The pull request's head commit, which a new comment is made on.
   *
   * @example "4c2a9f0e8b1d7c6a5f4e3d2c1b0a9f8e7d6c5b4a"
   */
  commitId: string;

  /**
   * The `fetch` to call.
   *
   * @example `globalThis.fetch`
   */
  fetch: Fetch;

  /**
   * The GraphQL endpoint.
   *
   * @example "https://api.github.com/graphql"
   */
  graphqlUrl: string;

  /**
   * The pull request's number.
   *
   * @example 147
   */
  number: number;

  /**
   * The repo's owner.
   *
   * @example "jjloneman"
   */
  owner: string;

  /**
   * The repo's name.
   *
   * @example "okf-tools"
   */
  repo: string;

  /**
   * The job's token.
   *
   * @example "ghs_…"
   */
  token: string;
};

/**
 * Plan what a run does for each draft and each earlier thread.
 *
 * - A thread for the same blob is kept as it is, resolved or not, its text
 *   edited only when the wording changed; else an open thread is edited to
 *   the new blob; else a new comment is posted, so a resolved thread stays
 *   resolved until the record changes again.
 *
 * - Every other open thread is resolved, its marker's blob set to `0`, so a
 *   resolution the owner never made can't stand for theirs if the record
 *   comes back as it was.
 *
 * - A draft the pull request doesn't change is annotated, since GitHub takes
 *   a comment only on a file in the diff; its thread is left as it is.
 */
export function planReviewComments(params: {
  /**
   * The drafts' findings, from `okf check --review-file`.
   *
   * @example `[{ code: "T001", path: "docs/a.md", … }]`
   */
  drafts: readonly CheckFinding[];

  /**
   * Each file the pull request changes, by path, with its blob at the head.
   *
   * @example `new Map([["docs/a.md", "3b18e51…"]])`
   */
  files: ReadonlyMap<string, string>;

  /**
   * The threads earlier runs started.
   *
   * @example `[{ blob: "3b18e51…", code: "T001", … }]`
   */
  threads: readonly ReviewThread[];
}): ReviewAction[] {
  const { drafts, files, threads } = params;
  const kept = new Set<string>();
  const actions: ReviewAction[] = [];

  for (const finding of drafts) {
    const blob = files.get(finding.path);
    const own = threads.filter(
      ({ code, path }) => code === finding.code && path === finding.path
    );
    const thread =
      own.find((candidate) => candidate.blob === blob) ??
      [...own].reverse().find(({ isResolved }) => !isResolved);

    if (thread !== undefined) {
      kept.add(thread.id);
    }

    if (blob === undefined) {
      actions.push({ finding, kind: "annotate" });

      continue;
    }

    const body = wordComment({ blob, finding });

    if (thread === undefined) {
      actions.push({ body, finding, kind: "create" });
    } else if (thread.commentBody !== body) {
      actions.push({
        body,
        commentId: thread.commentId,
        finding,
        kind: "update",
      });
    }
  }

  for (const thread of threads) {
    if (!thread.isResolved && !kept.has(thread.id)) {
      actions.push({
        body: thread.commentBody.replace(
          MARKER,
          `okf check resolved this thread: the record no longer reads as it did here, or is no longer a draft.\n\n<!-- okf-check: ${encodeURIComponent(thread.path)} ${thread.code} 0 -->`
        ),
        commentId: thread.commentId,
        kind: "resolve",
        path: thread.path,
        threadId: thread.id,
      });
    }
  }

  return actions;
}

/**
 * Read a review thread's first comment back as one an earlier run made, or
 * nothing when it isn't one.
 *
 * - Only a comment made with a workflow's token counts, so no one else's
 *   comment can stand in for one.
 */
export function readReviewThread(node: unknown): ReviewThread | undefined {
  const [comment] = readArray(
    readPath({ keys: ["comments", "nodes"], value: node })
  );
  const body = readPath({ keys: ["body"], value: comment });
  const commentId = readPath({ keys: ["databaseId"], value: comment });
  const login = readPath({ keys: ["author", "login"], value: comment });
  const id = readPath({ keys: ["id"], value: node });
  const isResolved = readPath({ keys: ["isResolved"], value: node });
  const groups =
    typeof body === "string" ? MARKER.exec(body)?.groups : undefined;
  const path =
    typeof groups?.path === "string" ? decodePath(groups.path) : undefined;

  if (
    groups === undefined ||
    typeof groups.blob !== "string" ||
    typeof groups.code !== "string" ||
    path === undefined ||
    typeof body !== "string" ||
    typeof commentId !== "number" ||
    typeof id !== "string" ||
    typeof isResolved !== "boolean" ||
    typeof login !== "string" ||
    !BOT_LOGINS.has(login)
  ) {
    return undefined;
  }

  return {
    blob: groups.blob,
    code: groups.code,
    commentBody: body,
    commentId,
    id,
    isResolved,
    path,
  };
}

/**
 * Run `okf review-comments`: read the drafts, then post, edit and resolve
 * their review comments, or annotate them where it can't.
 */
export async function runReviewComments(params: {
  /**
   * The file `okf check --review-file` wrote.
   *
   * @example "/tmp/okf-drafts.json"
   */
  draftsFile: string;

  /**
   * The job's environment, for its token and the pull request's event.
   *
   * @example `process.env`
   */
  env: Readonly<Record<string, string | undefined>>;

  /**
   * The `fetch` to call GitHub with.
   *
   * @example `globalThis.fetch`
   */
  fetch: Fetch;

  /**
   * Where the run prints.
   *
   * @example `createOutput("okf")`
   */
  output: Output;
}): Promise<ExitCode> {
  const { draftsFile, env, fetch, output } = params;
  const drafts = readDraftsFile(draftsFile);

  if (!drafts.isOk) {
    output.error(toTerminalLine(drafts.reason));

    return EXIT_CODES.failure;
  }

  const annotateAll = (reason: string): ExitCode => {
    output.error(
      toTerminalLine(`${reason}; each draft is an annotation instead.`)
    );

    for (const finding of drafts.value) {
      output.data(formatAnnotation(finding));
    }

    return EXIT_CODES.ok;
  };

  const context = readGitHubContext({ env, fetch });

  if (!context.isOk) {
    return annotateAll(context.reason);
  }

  // A newer push's run posts its own drafts; this one's could tag a comment
  // with a blob its check never saw.
  const head = await send({
    context: context.value,
    method: "GET",
    url: `${context.value.apiUrl}/repos/${context.value.owner}/${context.value.repo}/pulls/${context.value.number}`,
  });

  if (!head.isOk) {
    return annotateAll(head.reason);
  }

  if (
    readPath({ keys: ["head", "sha"], value: head.value }) !==
    context.value.commitId
  ) {
    return annotateAll(
      `The pull request's head moved on from ${context.value.commitId}, so a newer run posts its drafts`
    );
  }

  const threads = await readThreads(context.value);

  if (!threads.isOk) {
    return annotateAll(threads.reason);
  }

  const files = await readFiles(context.value);

  if (!files.isOk) {
    return annotateAll(files.reason);
  }

  const actions = planReviewComments({
    drafts: drafts.value,
    files: files.value,
    threads: threads.value,
  });

  for (const action of actions) {
    await applyAction({ action, context: context.value, output });
  }

  output.info(
    `${countActions({ actions, kind: "create" })} posted, ${countActions({ actions, kind: "update" })} edited, ${countActions({ actions, kind: "resolve" })} resolved, ${countActions({ actions, kind: "annotate" })} annotated.`
  );

  return EXIT_CODES.ok;
}

/**
 * Word a draft's comment, ending in its marker.
 *
 * - A record's own text can reach the message, so it can't mention anyone,
 *   open an HTML comment, or forge a marker.
 */
export function wordComment(params: {
  /**
   * The record's blob at the pull request's head.
   *
   * @example "3b18e512dba79e4c8300dd08aeb37f8e728b8dad"
   */
  blob: string;

  /**
   * The draft's finding.
   *
   * @example `{ code: "T001", path: "docs/a.md", … }`
   */
  finding: CheckFinding;
}): string {
  const { blob, finding } = params;
  const message = finding.message
    .replaceAll("<", "&lt;")
    .replaceAll("@", `@${ZERO_WIDTH_SPACE}`)
    .replaceAll(/§(?<section>\d+(?:\.\d+)*)/gu, `[§$<section>](${SPEC_URL})`);

  return [
    `**${finding.code} ${finding.rule}** (${finding.severity})`,
    "",
    message,
    "",
    "Resolve this thread to acknowledge that the record merges as a draft. It stays resolved until the record changes again.",
    "",
    `<!-- okf-check: ${encodeURIComponent(finding.path)} ${finding.code} ${blob} -->`,
  ].join("\n");
}

/** Carry out one action, annotating the draft when GitHub refuses it. */
async function applyAction(params: {
  action: ReviewAction;
  context: GitHubContext;
  output: Output;
}): Promise<void> {
  const { action, context, output } = params;
  const { apiUrl, commitId, number, owner, repo } = context;
  const pulls = `${apiUrl}/repos/${owner}/${repo}/pulls`;

  if (action.kind === "annotate") {
    output.data(formatAnnotation(action.finding));

    return;
  }

  if (action.kind === "resolve") {
    const edited = await send({
      body: { body: action.body },
      context,
      method: "PATCH",
      url: `${pulls}/comments/${action.commentId}`,
    });
    const resolved = edited.isOk
      ? await sendGraphql({
          context,
          query: RESOLVE_MUTATION,
          variables: { id: action.threadId },
        })
      : edited;

    if (!resolved.isOk) {
      output.error(
        toTerminalLine(
          `Couldn't resolve the review thread on ${action.path}: ${resolved.reason}`
        )
      );
    }

    return;
  }

  const sent = await send(
    action.kind === "create"
      ? {
          body: {
            body: action.body,
            commit_id: commitId,
            path: action.finding.path,
            subject_type: "file",
          },
          context,
          method: "POST",
          url: `${pulls}/${number}/comments`,
        }
      : {
          body: { body: action.body },
          context,
          method: "PATCH",
          url: `${pulls}/comments/${action.commentId}`,
        }
  );

  if (sent.isOk) {
    return;
  }

  output.error(
    toTerminalLine(
      `Couldn't post a review comment on ${action.finding.path}, so it's an annotation instead: ${sent.reason}`
    )
  );
  output.data(formatAnnotation(action.finding));
}

/** Count the actions of one kind. */
function countActions(params: {
  actions: readonly ReviewAction[];
  kind: ReviewAction["kind"];
}): number {
  return params.actions.filter(({ kind }) => kind === params.kind).length;
}

/** Decode a marker's path, or nothing when it isn't valid percent-encoding. */
function decodePath(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/** Read a value as a list, or an empty one when it isn't. */
function readArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: unknown[] = value;

  return items;
}

/** Read and check the drafts `okf check --review-file` wrote. */
function readDraftsFile(draftsFile: string): Outcome<CheckFinding[]> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(draftsFile, "utf8"));
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read ${draftsFile}: ${describeError(error)}`,
    };
  }

  const drafts = Array.isArray(parsed)
    ? readArray(parsed).map(readFinding)
    : [undefined];

  return drafts.every((draft) => draft !== undefined)
    ? { isOk: true, value: drafts }
    : {
        isOk: false,
        reason: `${draftsFile} isn't a list of findings, as okf check --review-file writes.`,
      };
}

/** Read every file a pull request changes, with its blob at the head. */
async function readFiles(
  context: GitHubContext
): Promise<Outcome<Map<string, string>>> {
  const { apiUrl, number, owner, repo } = context;
  const files = new Map<string, string>();

  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const answer = await send({
      context,
      method: "GET",
      url: `${apiUrl}/repos/${owner}/${repo}/pulls/${number}/files?per_page=${PAGE_SIZE}&page=${page}`,
    });

    if (!answer.isOk) {
      return answer;
    }

    const items = readArray(answer.value);

    for (const item of items) {
      const filename = readPath({ keys: ["filename"], value: item });
      const sha = readPath({ keys: ["sha"], value: item });

      if (typeof filename === "string" && typeof sha === "string") {
        files.set(filename, sha);
      }
    }

    if (items.length < PAGE_SIZE) {
      break;
    }
  }

  return { isOk: true, value: files };
}

/** Read one finding from a drafts file, or nothing when it isn't one. */
function readFinding(value: unknown): CheckFinding | undefined {
  const code = readPath({ keys: ["code"], value });
  const line = readPath({ keys: ["line"], value });
  const message = readPath({ keys: ["message"], value });
  const path = readPath({ keys: ["path"], value });
  const rule = readPath({ keys: ["rule"], value });
  const severity = SEVERITIES.find(
    (known) => known === readPath({ keys: ["severity"], value })
  );

  return typeof code === "string" &&
    (line === null || typeof line === "number") &&
    typeof message === "string" &&
    typeof path === "string" &&
    typeof rule === "string" &&
    severity !== undefined
    ? { code, line, message, path, rule, severity }
    : undefined;
}

/**
 * Read how to reach GitHub from the job's environment, and which pull
 * request the run is for from its event.
 */
function readGitHubContext(params: {
  env: Readonly<Record<string, string | undefined>>;
  fetch: Fetch;
}): Outcome<GitHubContext> {
  const { env, fetch } = params;
  const token = env.GITHUB_TOKEN ?? "";
  const [owner = "", repo = ""] = (env.GITHUB_REPOSITORY ?? "").split("/");
  const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";

  if (token === "" || owner === "" || repo === "") {
    return {
      isOk: false,
      reason: "GITHUB_TOKEN and GITHUB_REPOSITORY must be set",
    };
  }

  let event: unknown;

  try {
    event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read the event at GITHUB_EVENT_PATH: ${describeError(error)}`,
    };
  }

  const number = readPath({ keys: ["pull_request", "number"], value: event });
  const commitId = readPath({
    keys: ["pull_request", "head", "sha"],
    value: event,
  });

  return typeof number === "number" && typeof commitId === "string"
    ? {
        isOk: true,
        value: {
          apiUrl,
          commitId,
          fetch,
          graphqlUrl: env.GITHUB_GRAPHQL_URL ?? `${apiUrl}/graphql`,
          number,
          owner,
          repo,
          token,
        },
      }
    : { isOk: false, reason: "The run isn't for a pull request" };
}

/** Parse an error's body as JSON, or nothing when it isn't, as a proxy's page. */
function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Read a nested field of parsed JSON, or nothing when a step is missing. */
function readPath(params: {
  keys: readonly string[];
  value: unknown;
}): unknown {
  return params.keys.reduce<unknown>(
    (value, key): unknown =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Reflect.get(value, key)
        : undefined,
    params.value
  );
}

/** Read every review thread an earlier run started on the pull request. */
async function readThreads(
  context: GitHubContext
): Promise<Outcome<ReviewThread[]>> {
  const { number, owner, repo } = context;
  const threads: ReviewThread[] = [];
  let cursor: null | string = null;

  do {
    const answer = await sendGraphql({
      context,
      query: THREADS_QUERY,
      variables: { cursor, number, owner, repo },
    });

    if (!answer.isOk) {
      return answer;
    }

    const page = readPath({
      keys: ["repository", "pullRequest", "reviewThreads"],
      value: answer.value,
    });

    // An answer without the threads, such as a pull request that isn't
    // there, would read as none and post every draft again.
    if (!Array.isArray(readPath({ keys: ["nodes"], value: page }))) {
      return {
        isOk: false,
        reason: "GitHub answered without the pull request's review threads",
      };
    }

    for (const node of readArray(readPath({ keys: ["nodes"], value: page }))) {
      const thread = readReviewThread(node);

      if (thread !== undefined) {
        threads.push(thread);
      }
    }

    const endCursor = readPath({
      keys: ["pageInfo", "endCursor"],
      value: page,
    });

    cursor =
      readPath({ keys: ["pageInfo", "hasNextPage"], value: page }) === true &&
      typeof endCursor === "string"
        ? endCursor
        : null;
  } while (cursor !== null);

  return { isOk: true, value: threads };
}

/** Send one REST request, reading a JSON answer, or say why it failed. */
async function send(params: {
  body?: unknown;
  context: GitHubContext;
  method: "GET" | "PATCH" | "POST";
  url: string;
}): Promise<Outcome<unknown>> {
  const { body, context, method, url } = params;

  try {
    const response = await context.fetch(url, {
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${context.token}`,
        "user-agent": "okf-tools",
        "x-github-api-version": "2022-11-28",
      },
      method,
    });
    const text = await response.text();

    if (!response.ok) {
      const message = readPath({ keys: ["message"], value: readJson(text) });

      return {
        isOk: false,
        reason: `${method} ${url} answered ${response.status}${typeof message === "string" ? `: ${message}` : ""}`,
      };
    }

    return { isOk: true, value: text === "" ? undefined : JSON.parse(text) };
  } catch (error) {
    return {
      isOk: false,
      reason: `${method} ${url} failed: ${describeError(error)}`,
    };
  }
}

/** Send one GraphQL request, failing on any error it answers with. */
async function sendGraphql(params: {
  context: GitHubContext;
  query: string;
  variables: Record<string, unknown>;
}): Promise<Outcome<unknown>> {
  const { context, query, variables } = params;
  const answer = await send({
    body: { query, variables },
    context,
    method: "POST",
    url: context.graphqlUrl,
  });

  if (!answer.isOk) {
    return answer;
  }

  const errors = readArray(readPath({ keys: ["errors"], value: answer.value }));

  return errors.length === 0
    ? { isOk: true, value: readPath({ keys: ["data"], value: answer.value }) }
    : {
        isOk: false,
        reason: errors
          .map((error) => {
            const message = readPath({ keys: ["message"], value: error });

            return typeof message === "string" ? message : "an unknown error";
          })
          .join("; "),
      };
}
