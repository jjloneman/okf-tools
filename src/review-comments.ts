/*
 * `okf review-comments`: post each draft's `T001` finding, from
 * `okf check --review-file`, as a file-level review comment on the pull
 * request a GitHub Actions run is for, which the owner resolves to
 * acknowledge that the record merges as a draft.
 *
 * - `review-plan.ts` decides what to post, edit, or resolve, and
 *   `github-client.ts` makes the calls.
 *
 * - A comment it can't post, a draft outside the pull request's diff, and
 *   every draft when the pull request can't be read, print as annotations
 *   instead, so no draft goes unreported. Only a drafts file it can't read
 *   fails the run.
 */
import { readFileSync } from "node:fs";

import type {
  CheckFinding,
  CheckSeverity,
  FindingSource,
} from "./check-engine.ts";
import type { ExitCode } from "./exit-codes.ts";
import type { Fetch, GitHubClient, GitHubTarget } from "./github-client.ts";
import type { Outcome } from "./outcome.ts";
import type { Output } from "./output.ts";
import type { ReviewAction } from "./review-plan.ts";

import { formatAnnotation } from "./check.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { createGitHubClient } from "./github-client.ts";
import { readArray, readPath } from "./json.ts";
import { describeError, toTerminalLine } from "./output.ts";
import { planReviewComments, readReviewThread } from "./review-plan.ts";

/** How the summary words each kind of action, in the order it lists them. */
const ACTION_VERBS: readonly {
  /** The kind of action. @example "create" */
  kind: ReviewAction["kind"];

  /** What the summary says was done. @example "posted" */
  verb: string;
}[] = [
  { kind: "create", verb: "posted" },
  { kind: "update", verb: "edited" },
  { kind: "resolve", verb: "resolved" },
  { kind: "annotate", verb: "annotated" },
];

/** The pull request a run is for, and how to reach GitHub. */
type ReviewTarget = {
  /**
   * The pull request's page.
   *
   * @example "https://github.com/jjloneman/okf-tools/pull/162"
   */
  pullUrl: string;
} & GitHubTarget;

/** The severities a drafts file may name. */
const SEVERITIES: readonly CheckSeverity[] = ["error", "info", "warning"];

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

  /** The `fetch` to call GitHub with. @example `globalThis.fetch` */
  fetch: Fetch;

  /** Where the run prints. @example `createOutput("okf")` */
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

  const target = readGitHubTarget({ env, fetch });

  if (!target.isOk) {
    return annotateAll(target.reason);
  }

  const client = createGitHubClient(target.value);

  // A newer push's run posts its own drafts; this one's could tag a comment
  // with a blob its check never saw.
  const head = await client.readHeadSha();

  if (!head.isOk) {
    return annotateAll(head.reason);
  }

  if (head.value !== target.value.commitId) {
    return annotateAll(
      `The pull request's head moved on from ${target.value.commitId}, so a newer run posts its drafts`
    );
  }

  const nodes = await client.readReviewThreads();

  if (!nodes.isOk) {
    return annotateAll(nodes.reason);
  }

  const files = await client.listFiles();

  if (!files.isOk) {
    return annotateAll(files.reason);
  }

  const actions = planReviewComments({
    commitId: target.value.commitId,
    drafts: drafts.value,
    files: files.value,
    pullUrl: target.value.pullUrl,
    threads: nodes.value.flatMap((node) => readReviewThread(node) ?? []),
  });

  for (const action of actions) {
    await applyAction({ action, client, output });
  }

  const counts = ACTION_VERBS.map(
    ({ kind, verb }) => `${countActions({ actions, kind })} ${verb}`
  );

  output.info(`${counts.join(", ")}.`);

  return EXIT_CODES.ok;
}

/** Carry out one action, annotating the draft when GitHub refuses it. */
async function applyAction(params: {
  /** What to do. @example `{ finding, kind: "annotate" }` */
  action: ReviewAction;

  /** The pull request's client. @example `createGitHubClient(target)` */
  client: GitHubClient;

  /** Where the run prints. @example `createOutput("okf")` */
  output: Output;
}): Promise<void> {
  const { action, client, output } = params;

  if (action.kind === "annotate") {
    output.data(formatAnnotation(action.finding));

    return;
  }

  if (action.kind === "resolve") {
    const edited = await client.updateComment(action);
    const resolved = edited.isOk
      ? await client.resolveThread(action.threadId)
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

  const outcome = await (action.kind === "create"
    ? client.createFileComment({
        body: action.body,
        path: action.finding.path,
      })
    : client.updateComment(action));

  if (outcome.isOk) {
    return;
  }

  output.error(
    toTerminalLine(
      `Couldn't post a review comment on ${action.finding.path}, so it's an annotation instead: ${outcome.reason}`
    )
  );
  output.data(formatAnnotation(action.finding));
}

/** Count the actions of one kind. */
function countActions(params: {
  /** The run's actions. @example `[{ finding, kind: "annotate" }]` */
  actions: readonly ReviewAction[];

  /** The kind to count. @example "create" */
  kind: ReviewAction["kind"];
}): number {
  return params.actions.filter(({ kind }) => kind === params.kind).length;
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

  const items: unknown[] = Array.isArray(parsed) ? parsed : [undefined];
  const drafts = items.map(readFinding);

  return drafts.every((draft) => draft !== undefined)
    ? { isOk: true, value: drafts }
    : {
        isOk: false,
        reason: `${draftsFile} isn't a list of findings, as okf check --review-file writes.`,
      };
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
  const sources = readArray(readPath({ keys: ["sources"], value })).flatMap(
    readSource
  );

  return typeof code === "string" &&
    (line === null || typeof line === "number") &&
    typeof message === "string" &&
    typeof path === "string" &&
    typeof rule === "string" &&
    severity !== undefined
    ? {
        code,
        line,
        message,
        path,
        rule,
        severity,
        ...(sources.length === 0 ? {} : { sources }),
      }
    : undefined;
}

/**
 * Read how to reach GitHub from the job's environment, and which pull
 * request the run is for from its event.
 */
function readGitHubTarget(params: {
  /** The job's environment. @example `process.env` */
  env: Readonly<Record<string, string | undefined>>;

  /** The `fetch` to call GitHub with. @example `globalThis.fetch` */
  fetch: Fetch;
}): Outcome<ReviewTarget> {
  const { env, fetch } = params;
  const token = env.GITHUB_TOKEN ?? "";
  const [owner = "", repo = ""] = (env.GITHUB_REPOSITORY ?? "").split("/");
  const apiUrl = env.GITHUB_API_URL ?? "https://api.github.com";
  const serverUrl = (env.GITHUB_SERVER_URL ?? "").replace(/\/+$/u, "");

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

  const commitId = readPath({
    keys: ["pull_request", "head", "sha"],
    value: event,
  });
  const number = readPath({ keys: ["pull_request", "number"], value: event });

  return typeof number === "number" && typeof commitId === "string"
    ? {
        isOk: true,
        value: {
          apiUrl,
          commitId,
          fetch,
          number,
          owner,
          pullUrl: `${serverUrl === "" ? "https://github.com" : serverUrl}/${owner}/${repo}/pull/${String(number)}`,
          repo,
          token,
        },
      }
    : { isOk: false, reason: "The run isn't for a pull request" };
}

/** Read one source of a finding, or nothing when it isn't one. */
function readSource(value: unknown): FindingSource[] {
  const path = readPath({ keys: ["path"], value });
  const resource = readPath({ keys: ["resource"], value });

  return typeof path === "string" && typeof resource === "string"
    ? [{ path, resource }]
    : [];
}
