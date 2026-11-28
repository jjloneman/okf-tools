import { DateTime, Duration } from "luxon";
import path from "node:path";

import type { RecordVerification } from "./frontmatter/edit.ts";
import type { RecordState, RecordSummary } from "./frontmatter/read.ts";
import type {
  EntryStyle,
  Timestamp,
  VerifyRecordParams,
} from "./frontmatter/types.ts";

import { verifyRecord } from "./frontmatter/edit.ts";
import { removeField, writeFields } from "./frontmatter/fields.ts";
import { readStatusText } from "./frontmatter/read.ts";
import { FRONTMATTER_KEYS } from "./frontmatter/shared.ts";
import { findBundleDir } from "./repo.ts";

/** A record in a bundle that could be verified. */
export type Candidate = {
  /**
   * Path from the repo root, with `/` separators, as git prints it.
   *
   * @example "docs/decisions/package-promise.md"
   */
  filePath: string;

  /**
   * Whether the record still needs a sign-off.
   *
   * @example "unverified"
   */
  state: RecordState;

  /**
   * The frontmatter fields shown and decided on.
   *
   * @example `{ status: "draft", title: "What every export promises" }`
   */
  summary: RecordSummary;

  /**
   * The record as it is on disk.
   *
   * @example
   * ```ts
   * "---\ntype: Decision\n---\n"
   * ```
   */
  text: string;
};

/** The edits for the records that accept them, and why the rest refused. */
export type PreparedEdits = {
  /**
   * The new text of each record that accepted the edit.
   *
   * @example `[{ filePath: "docs/decisions/a.md", originalText: "---\nstatus: draft\n---\n", text: "---\nstatus: stable\n---\n" }]`
   */
  edits: RecordEdit[];

  /**
   * One line per record that refused it.
   *
   * @example `["docs/decisions/a.md: no frontmatter block"]`
   */
  failures: string[];
};

/** A record's path and the text to write there. */
export type RecordEdit = {
  /**
   * Path from the repo root.
   *
   * @example "docs/decisions/package-promise.md"
   */
  filePath: string;

  /**
   * The record's text before the edit, to restore if a later write fails.
   *
   * @example `"---\nstatus: draft\n---\n"`
   */
  originalText: string;

  /**
   * The record's new text.
   *
   * @example `"---\nstatus: stable\n---\n"`
   */
  text: string;
};

/**
 * Build the commit message: a subject counting the records, then one bullet
 * per record.
 *
 * - The scope is the bundle's folder name, or `okf` when the records span more
 *   than one bundle or the bundle is the repo root.
 *
 * - A record's bundle is the first of `bundleDirs` that holds it, at any
 *   depth, so records in a bundle's subfolders share its scope.
 */
export function buildCommitMessage(params: {
  bundleDirs: readonly string[];
  selected: readonly Candidate[];
}): string {
  const { selected } = params;
  const bundleDirs = new Set(
    selected.map(({ filePath }) =>
      findBundleDir({ bundleDirs: params.bundleDirs, filePath })
    )
  );

  const types = new Set(selected.map(({ summary }) => summary.type));
  const [onlyBundle] = bundleDirs.size === 1 ? bundleDirs : [];
  const [onlyType] = types.size === 1 ? types : [];
  const noun = onlyType?.toLowerCase() ?? "okf";
  const count = selected.length;

  const bullets = selected.map(({ filePath, summary }) => {
    const fileName = path.posix.basename(filePath);

    return `- ${summary.title ?? fileName} (${fileName})`;
  });

  return [
    `docs(${scopeFor(onlyBundle)}): 📝 verify ${count} ${noun} ${count === 1 ? "record" : "records"}`,
    "",
    ...bullets,
  ].join("\n");
}

/** The current UTC time, to the second, as a record writes it. */
export function currentTimestamp(): string {
  return DateTime.utc().startOf("second").toISO({ suppressMilliseconds: true });
}

/** Word a candidate's state as a short hint. */
export function describeState(candidate: Candidate): string {
  const hints: Record<RecordState, string> = {
    changed: "changed since you verified it",
    unverified: describeStatus(candidate),
    verified: "already verified, unchanged",
  };

  return hints[candidate.state];
}

/** Whether a record still needs a sign-off from the actor it was read for. */
export function needsSignOff(candidate: Candidate): boolean {
  return candidate.state !== "verified";
}

/**
 * Work out every chosen record's new text, before anything is written.
 *
 * - Returns both lists, so a caller that already knows every record accepts
 *   (the texts it checked haven't changed) can take the edits as they are.
 *
 * - A caller treats any failure as "edit nothing".
 */
export function prepareEdits(params: {
  at: string;
  candidates: readonly Candidate[];
  staleIn: string | undefined;
  style: EntryStyle;
  verifiedBy: string;
}): PreparedEdits {
  const { at, candidates, staleIn, style, verifiedBy } = params;
  const staleAfter =
    staleIn === undefined ? undefined : addDuration({ at, duration: staleIn });

  const edits: RecordEdit[] = [];
  const failures: string[] = [];

  candidates.forEach(({ filePath, text }) => {
    const verified = signOffRecord({ at, style, text, verifiedBy });
    const result =
      verified.isOk && staleAfter !== undefined
        ? writeStaleAfter({ staleAfter, text: verified.text })
        : verified;

    if (result.isOk) {
      edits.push({ filePath, originalText: text, text: result.text });
    } else {
      failures.push(`${filePath}: ${result.reason}`);
    }
  });

  return { edits, failures };
}

/**
 * Sign a record off as `verifyRecord` does, then take out the reason its
 * last re-stamp gave, `x-okf-restamp-reason`, so an old reason never
 * outlives the review it was written for.
 */
export function signOffRecord(params: VerifyRecordParams): RecordVerification {
  const verified = verifyRecord(params);

  return verified.isOk
    ? removeField({ key: FRONTMATTER_KEYS.restampReason, text: verified.text })
    : verified;
}

/**
 * Write a signed-off record's `stale_after`, replacing any it holds, after
 * its `verified`, where a sign-off has just put one.
 */
export function writeStaleAfter(params: {
  staleAfter: Timestamp;
  text: string;
}): RecordVerification {
  const { staleAfter, text } = params;

  return writeFields({
    fields: [
      {
        after: FRONTMATTER_KEYS.verified,
        key: FRONTMATTER_KEYS.staleAfter,
        value: staleAfter,
      },
    ],
    text,
  });
}

/**
 * Add an ISO 8601 duration, which `--stale-in` checked, to a sign-off time,
 * in UTC to the second.
 */
function addDuration(params: { at: Timestamp; duration: string }): Timestamp {
  const { at, duration } = params;

  return DateTime.fromISO(at, { zone: "utc" })
    .plus(Duration.fromISO(duration))
    .toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

/**
 * Word an unverified record's status for its hint.
 *
 * - A status OKF doesn't define, such as `wip`, is named as written, since
 *   "no status" would send someone looking for a field that's there.
 */
function describeStatus(candidate: Candidate): string {
  const { summary, text } = candidate;

  if (summary.status !== undefined) {
    return summary.status;
  }

  const written = readStatusText(text);

  if (written === undefined) {
    return "no status";
  }

  // The hint is one line of a terminal prompt, so the record's own text can't
  // break it, send the terminal control codes, or reorder it with bidi marks.
  const shown = written.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim();

  return `status "${shown}", which OKF doesn't define`;
}

/** Name a commit's scope after its one bundle, or `okf` for none or the root. */
function scopeFor(bundleDir: string | undefined): string {
  return bundleDir === undefined || bundleDir === "."
    ? "okf"
    : path.posix.basename(bundleDir);
}
