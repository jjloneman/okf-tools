/*
 * The pure part of `okf review-comments`: what a run does for each draft and
 * each review thread an earlier run started, read back by the hidden marker
 * that ends each comment.
 *
 * - The marker names the record, the code, and the record's blob at the pull
 *   request's head, so a later run finds its own comment by the record's
 *   text, not its line.
 */
import type { CheckFinding, CheckSeverity } from "./check-engine.ts";

import { readArray, readPath } from "./json.ts";

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

/** The emoji a comment's heading opens with, by the finding's severity. */
const SEVERITY_EMOJIS: Record<CheckSeverity, string> = {
  error: "🛑",
  info: "📝",
  warning: "⚠️",
};

/**
 * What a comment sets as code: an RFC 3339 time, an actor before `'s`, a
 * dotted frontmatter field, and an `okf` command.
 */
const CODE_TOKEN =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z|\b[a-z][a-z0-9-]*:[\w.-]+(?='s\b)|\b(?:generated|verified)\.(?:at|by)\b|\bokf [a-z-]+/gu;

/** What follows an `@` so it mentions no one, written as its code point. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x20_0b);

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
 * Word a draft's comment, ending in its marker: a heading with the code, the
 * finding's first clause as its summary, the clauses between as bullets, and
 * what to do, in bold, as the last.
 *
 * - The finding's message joins its clauses with `; `, and ends with the
 *   command that settles it, as `T001`'s does.
 *
 * - Times, actors, fields, and `okf` commands read as code.
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
  const [summary = "", ...rest] = finding.message
    .split("; ")
    .map((clause) => toSentence(formatClause(clause)));
  const settle = rest.at(-1);
  const details = rest.slice(0, -1);

  return [
    `**${SEVERITY_EMOJIS[finding.severity]} \`${finding.code}\` ${finding.rule}** · ${finding.severity}`,
    "",
    summary,
    ...(details.length === 0
      ? []
      : ["", ...details.map((detail) => `- ${detail}`)]),
    "",
    "**What to do:**",
    "",
    ...(settle === undefined ? [] : [`- **Sign it off:** ${settle}`]),
    "- **Resolve this thread** to acknowledge that the record merges as a draft. It stays resolved until the record changes again.",
    "",
    `<!-- okf-check: ${encodeURIComponent(finding.path)} ${finding.code} ${blob} -->`,
  ].join("\n");
}

/** Decode a marker's path, or nothing when it isn't valid percent-encoding. */
function decodePath(encoded: string): string | undefined {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/**
 * Defuse a clause of a finding's message, set its times, actors, fields,
 * and commands as code, and link its spec sections.
 */
function formatClause(clause: string): string {
  return clause
    .replaceAll("<", "&lt;")
    .replaceAll("@", `@${ZERO_WIDTH_SPACE}`)
    .replaceAll(CODE_TOKEN, (token) => `\`${token}\``)
    .replaceAll(/§(?<section>\d+(?:\.\d+)*)/gu, `[§$<section>](${SPEC_URL})`);
}

/** Make a clause a sentence: a capital first letter and a full stop. */
function toSentence(clause: string): string {
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}
