import { DateTime } from "luxon";
import path from "node:path";

import type { RecordState, RecordSummary } from "./okf-frontmatter.ts";

import { verifyRecord } from "./okf-frontmatter.ts";

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
 */
export function buildCommitMessage(selected: readonly Candidate[]): string {
  const bundleDirs = new Set(
    selected.map(({ filePath }) => path.posix.dirname(filePath))
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
    unverified: candidate.summary.status ?? "no status",
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
  verifiedBy: string;
}): PreparedEdits {
  const { at, candidates, verifiedBy } = params;

  const edits: RecordEdit[] = [];
  const failures: string[] = [];

  candidates.forEach(({ filePath, text }) => {
    const result = verifyRecord({ at, text, verifiedBy });

    if (result.isOk) {
      edits.push({ filePath, originalText: text, text: result.text });
    } else {
      failures.push(`${filePath}: ${result.reason}`);
    }
  });

  return { edits, failures };
}

/** Name a commit's scope after its one bundle, or `okf` for none or the root. */
function scopeFor(bundleDir: string | undefined): string {
  return bundleDir === undefined || bundleDir === "."
    ? "okf"
    : path.posix.basename(bundleDir);
}
