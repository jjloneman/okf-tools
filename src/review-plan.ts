/*
 * The pure part of `okf review-comments`: what a run does for each draft and
 * each review thread an earlier run started, read back by the hidden marker
 * that ends each comment.
 *
 * - The marker names the record, the code, and the record's blob at the pull
 *   request's head, so a later run finds its own comment by the record's
 *   text, not its line.
 */
import { createHash } from "node:crypto";

import type {
  CheckFinding,
  CheckSeverity,
  FindingSource,
} from "./check-engine.ts";

import { nameSources } from "./cited-sources.ts";
import { readArray, readPath } from "./json.ts";

/** One thing a run does: post, edit, resolve, or annotate instead. */
export type ReviewAction =
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

      /** The record the thread is on. @example "docs/a.md" */
      path: string;

      /** The thread's GraphQL node ID. @example "PRRT_kwDO…" */
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
    }
  | {
      /** The comment's new text. @example "**T001 draft** (info) …" */
      body: string;

      /** The comment to edit. @example 2_400_000_001 */
      commentId: number;

      /**
       * The draft it posts.
       *
       * @example `{ code: "T001", path: "docs/a.md", … }`
       */
      finding: CheckFinding;

      /** Edit a comment of an earlier run. @example "update" */
      kind: "update";
    }
  | {
      /** The comment's text. @example "**T001 draft** (info) …" */
      body: string;

      /**
       * The draft it posts.
       *
       * @example `{ code: "T001", path: "docs/a.md", … }`
       */
      finding: CheckFinding;

      /** Post a new comment. @example "create" */
      kind: "create";
    };

/** A review thread an earlier run started, read back by its marker. */
export type ReviewThread = {
  /**
   * The record's blob its marker names, or `0` once a run resolved it.
   *
   * @example "3b18e512dba79e4c8300dd08aeb37f8e728b8dad"
   */
  blob: string;

  /** The finding's code its marker names. @example "T001" */
  code: string;

  /** Its first comment's text. @example "**T001 draft** (info) …" */
  commentBody: string;

  /** Its first comment's REST ID. @example 2_400_000_001 */
  commentId: number;

  /** Its GraphQL node ID. @example "PRRT_kwDO…" */
  id: string;

  /** Whether someone resolved it. @example false */
  isResolved: boolean;

  /** The record its marker names. @example "docs/a.md" */
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

/**
 * The GitHub alert a live comment sits in, by the finding's severity.
 *
 * - A draft at `info` blocks the merge until someone acts on it, so it's
 *   `IMPORTANT`, which reads as needed, not `NOTE`, which reads as optional.
 *
 * - `NOTE` is kept for a thread `okf check` resolved, so its blue sets it
 *   apart from every live one.
 */
const SEVERITY_ALERTS: Record<CheckSeverity, string> = {
  error: "CAUTION",
  info: "IMPORTANT",
  warning: "WARNING",
};

/**
 * Where the README documents each family of codes, by the code's letter:
 * okf-tools' own trust and house rules, and the spec rules for the rest.
 *
 * - It links `main`, not the installed version's tag, since a release's
 *   README can predate a rule, and a code is never reused, so its anchor
 *   holds.
 */
const RULE_DOCS: Readonly<Record<string, string>> = {
  H: "https://github.com/jjloneman/okf-tools#-house-rules",
  T: "https://github.com/jjloneman/okf-tools#-trust-rules",
};

/** The README section for the spec rules' `E`, `W` and `I` codes. */
const SPEC_RULE_DOCS = "https://github.com/jjloneman/okf-tools#-rules";

/** A rule code, such as `T001` or `W101`, in a finding's message. */
const RULE_CODE = /\b[EHITW]\d{3}\b/gu;

/**
 * What a comment sets as code: an RFC 3339 time, an actor before `'s`, a
 * dotted frontmatter field, and an `okf` command.
 */
const CODE_TOKEN =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z|\b[a-z][a-z0-9-]*:[\w.-]+(?='s\b)|\b(?:generated|verified)\.(?:at|by)\b|\bokf [a-z-]+/gu;

/** How `T001` opens the clause quoting `okf touch --reason`'s reason. */
const RESTAMP_REASON_LEAD = '; it was re-stamped because "';

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
  /** The head commit the run checked. @example "e8da3644c0b1" */
  commitId: string;

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
   * The pull request's page, which a cited source in its diff links into.
   *
   * @example "https://github.com/jjloneman/okf-tools/pull/162"
   */
  pullUrl: string;

  /**
   * The threads earlier runs started.
   *
   * @example `[{ blob: "3b18e51…", code: "T001", … }]`
   */
  threads: readonly ReviewThread[];
}): ReviewAction[] {
  const { commitId, drafts, files, pullUrl, threads } = params;

  // GitHub anchors each file of a pull request's diff by its path's SHA-256.
  const diffUrl = (path: string): string | undefined => {
    const hash = createHash("sha256").update(path).digest("hex");

    return files.has(path) ? `${pullUrl}/files#diff-${hash}` : undefined;
  };
  const actions: ReviewAction[] = [];
  const kept = new Set<string>();

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

    const body = wordComment({ blob, diffUrl, finding });

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
      const isReported = drafts.some(
        ({ code, path }) => code === thread.code && path === thread.path
      );

      actions.push({
        body: wordRelease({ commitId, isReported, thread }),
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
  const id = readPath({ keys: ["id"], value: node });
  const isResolved = readPath({ keys: ["isResolved"], value: node });
  const login = readPath({ keys: ["author", "login"], value: comment });
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
 * Word a draft's comment, ending in its marker: an alert by severity,
 * holding a heading with the linked code, the finding's first clause as
 * its summary, and the clauses between as bullets; then, after the alert,
 * the two ways to settle it.
 *
 * - The finding's message joins its clauses with `; `, and ends with the
 *   command that settles it, as `T001`'s does.
 *
 * - Times, actors, fields, and `okf` commands read as code, and a rule
 *   code links to the README's table of its rules.
 *
 * - Each cited source the finding names reads as code, linked to its file
 *   in the pull request's diff when it's there.
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
   * Where a path's file is in the pull request's diff, or nothing when the
   * diff doesn't hold it; nothing is linked, unless given.
   *
   * @example `(path) => "https://github.com/o/r/pull/1/files#diff-…"`
   */
  diffUrl?: ((path: string) => string | undefined) | undefined;

  /** The draft's finding. @example `{ code: "T001", path: "docs/a.md", … }` */
  finding: CheckFinding;
}): string {
  const { blob, diffUrl = () => undefined, finding } = params;
  const sources = finding.sources ?? [];
  // The summary holds the actor, a record's own text, so only the clauses
  // after it are searched for the sources.
  const [summary = "", ...rest] = splitClauses(finding.message).map(
    (clause, index) =>
      toSentence(
        index === 0
          ? formatClause(clause)
          : formatSourcesClause({ clause, diffUrl, sources })
      )
  );
  const details = rest.slice(0, -1);
  const settle = rest.at(-1);
  const alert = [
    `[!${SEVERITY_ALERTS[finding.severity]}]`,
    `**${linkCode(finding.code)} ${finding.rule}** · ${finding.severity}`,
    "",
    summary,
    ...(details.length === 0
      ? []
      : ["", ...details.map((detail) => `- ${detail}`)]),
  ];
  const steps =
    settle === undefined
      ? [MERGE_AS_DRAFT]
      : [
          "**What to do**, one or the other:",
          "",
          `- **Sign it off:** ${settle.replace(/\.$/u, "")}, and the next run resolves this thread.`,
          `- **Or merge it as a draft:** ${MERGE_AS_DRAFT_STEP}`,
        ];

  return [
    ...alert.map((line) => (line === "" ? ">" : `> ${line}`)),
    "",
    ...steps,
    "",
    formatMarker({ blob, code: finding.code, path: finding.path }),
  ].join("\n");
}

/** How to merge a draft as it is, when it's the only way to settle it. */
const MERGE_AS_DRAFT_STEP =
  "resolve this thread yourself to acknowledge it. It stays resolved until the record changes again.";

/** The one step to take when a finding names no command that settles it. */
const MERGE_AS_DRAFT = `**What to do:** ${MERGE_AS_DRAFT_STEP}`;

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
    .replaceAll(RULE_CODE, (code) => linkCode(code))
    .replaceAll(/§(?<section>\d+(?:\.\d+)*)/gu, `[§$<section>](${SPEC_URL})`);
}

/**
 * Set text as a code span, its fence longer than any run of backticks in
 * it, so a record's own text can't close it early.
 */
function formatCode(text: string): string {
  const runs = text.match(/`+/gu) ?? [];
  const fence = "`".repeat(
    Math.max(0, ...runs.map(({ length }) => length)) + 1
  );
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";

  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Write the marker that ends a comment, for a later run to find it by. */
function formatMarker(params: {
  /** The record's blob, or `0` once released. @example "aaaa1111" */
  blob: string;

  /** The finding's code. @example "T001" */
  code: string;

  /** The record, from the repo root. @example "docs/a.md" */
  path: string;
}): string {
  const { blob, code, path } = params;

  return `<!-- okf-check: ${encodeURIComponent(path)} ${code} ${blob} -->`;
}

/**
 * Format a clause, setting the sources it names as code, each linked to its
 * diff where there is one, and the rest as `formatClause` does.
 *
 * - It finds them by the phrase `nameSources` builds, as `T001` names them,
 *   so a path is never matched inside other text.
 */
function formatSourcesClause(params: {
  /** The clause. @example "its source ../a.ts changed on this branch" */
  clause: string;

  /** Where a path's diff is. @example `() => undefined` */
  diffUrl: (path: string) => string | undefined;

  /** The sources the finding names. @example `[{ path: "a.ts", … }]` */
  sources: readonly FindingSource[];
}): string {
  const { clause, diffUrl, sources } = params;
  const named = nameSources(sources.map(({ resource }) => resource));
  const at = sources.length === 0 ? -1 : clause.indexOf(named);

  if (at === -1) {
    return formatClause(clause);
  }

  const linked = nameSources(
    sources.map(({ path, resource }) => {
      const code = formatCode(resource);
      const url = diffUrl(path);

      return url === undefined ? code : `[${code}](${url})`;
    })
  );

  const before = formatClause(clause.slice(0, at));
  const after = formatClause(clause.slice(at + named.length));

  return `${before}${linked}${after}`;
}

/** Set a rule code as code, linked to the README's table of its rules. */
function linkCode(code: string): string {
  return `[\`${code}\`](${RULE_DOCS[code.charAt(0)] ?? SPEC_RULE_DOCS})`;
}

/**
 * Split a finding's message into its clauses at each `; `, but keep the
 * reason `T001` quotes whole, from its lead to the last clause, since the
 * reason is the owner's own text and may hold a `; ` itself.
 *
 * - It finds the reason by its lead, as `formatSourcesClause` finds the
 *   sources by their phrase, so the report's JSON needs no new field.
 *
 * - It takes the last lead, since the clauses before the reason can hold
 *   a record's own text, such as the signer's `by` in the summary.
 *
 * - `T001` always ends with the step that signs it off, after the reason,
 *   so the last `; ` ends the reason.
 */
function splitClauses(message: string): string[] {
  const at = message.lastIndexOf(RESTAMP_REASON_LEAD);
  const end = message.lastIndexOf("; ");

  if (at === -1) {
    return message.split("; ");
  }

  return [
    ...message.slice(0, at).split("; "),
    message.slice(at + 2, end),
    message.slice(end + 2),
  ];
}

/** Make a clause a sentence: a capital first letter and a full stop. */
function toSentence(clause: string): string {
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * Word a thread `okf check` resolves: a note on top saying why, at which
 * commit, then the finding as it was, out of its alert, since GitHub nests
 * no alert in another and advises against two in a row.
 *
 * - When the draft is gone, as when it was signed off, the sign-off step
 *   is struck out, as the one that settled it.
 *
 * - When it's still reported, a newer thread for its new text replaces
 *   this one, so it's superseded.
 *
 * - Its marker's blob is set to `0`, so if the record comes back as it was,
 *   a resolution the owner never made can't stand for theirs.
 */
function wordRelease(params: {
  /** The head commit the run checked. @example "e8da3644c0b1" */
  commitId: string;

  /** Whether the run still reports the draft. @example false */
  isReported: boolean;

  /** The thread to resolve. @example `{ code: "T001", path: "a.md", … }` */
  thread: ReviewThread;
}): string {
  const { commitId, isReported, thread } = params;
  const at = `\`${commitId.slice(0, 7)}\``;
  const note = isReported
    ? `↪️ **Superseded** at ${at}: the record changed, so a newer thread replaces this one.`
    : `✅ **Resolved by \`okf check\`** at ${at}: the record is no longer reported as a draft.`;
  const finding = thread.commentBody
    .replace(MARKER, "")
    .trimEnd()
    .split("\n")
    .filter((line) => !/^> \[!\w+\]$/u.test(line))
    .map((line) => line.replace(/^> ?/u, ""))
    .map((line) =>
      !isReported && line.startsWith("- **Sign it off:** ")
        ? `- ~~${line.slice(2)}~~`
        : line
    );

  return [
    "> [!NOTE]",
    `> ${note}`,
    "",
    ...finding,
    "",
    formatMarker({ blob: "0", code: thread.code, path: thread.path }),
  ].join("\n");
}
