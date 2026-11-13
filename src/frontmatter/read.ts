/*
 * Reads a record's frontmatter into a summary and works out whether it is
 * verified. Reading accepts any valid YAML; only editing is allowlisted.
 */
import { DateTime } from "luxon";

import type { RecordStatus, Timestamp, VerifyRecordParams } from "./types.ts";

import {
  describeYamlErrors,
  ENTRY_KEYS,
  findOwnEntry,
  FRONTMATTER_KEYS,
  isRecordStatus,
  parseFrontmatter,
  readField,
  readString,
  readTimestamp,
  splitFrontmatter,
} from "./shared.ts";

/** What `readRecordSummary` needs: the record, and whose sign-off counts. */
export type ReadRecordSummaryParams = Pick<
  VerifyRecordParams,
  "text" | "verifiedBy"
>;

/**
 * Where a record stands with the human sign-off.
 *
 * - `unverified` has no sign-off from the verifier yet.
 * - `changed` was regenerated after the sign-off, so it needs a fresh one.
 * - `verified` was signed off and left alone since.
 */
export type RecordState = "changed" | "unverified" | "verified";

/** The frontmatter fields the verify flow shows and decides on. */
export type RecordSummary = {
  /**
   * When the record was last generated, if it says.
   *
   * @example "2026-10-01T15:00:00Z"
   */
  generatedAt: Timestamp | undefined;

  /**
   * The record's `status`, when it is one OKF defines.
   *
   * - Absent means `stable`, as OKF defines it.
   *
   * @example "draft"
   */
  status: RecordStatus | undefined;

  /**
   * The record's `title`, without its quotes.
   *
   * @example "What every export promises"
   */
  title: string | undefined;

  /**
   * The record's `type`.
   *
   * @example "Decision"
   */
  type: string | undefined;

  /**
   * When `verifiedBy` last signed the record off, if they did.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  verifiedAt: Timestamp | undefined;
};

/**
 * Check that a record's frontmatter is valid YAML, so it can be read and
 * edited safely.
 *
 * @returns why it isn't, or `undefined` when it is or there's no frontmatter.
 */
export function findFrontmatterProblem(text: string): string | undefined {
  const block = splitFrontmatter(text);

  return block === undefined
    ? undefined
    : describeYamlErrors(parseFrontmatter(block.text));
}

/**
 * Judge whether a record still needs a human sign-off.
 *
 * - `changed` means it was generated after `verifiedBy` last signed it off, or
 *   that the sign-off's timestamp can't be read.
 *
 * - `verified` means it was signed off and not touched since, or that the
 *   generation time can't be read, since no sign-off could ever follow it.
 */
export function getRecordState(summary: RecordSummary): RecordState {
  if (summary.verifiedAt === undefined) {
    return "unverified";
  }

  if (summary.generatedAt === undefined) {
    return "verified";
  }

  const generatedTime = readTime(summary.generatedAt);

  // An unreadable generation time can't be compared, and treating it as
  // "changed" would ask for a sign-off no sign-off could satisfy.
  if (!generatedTime.isValid) {
    return "verified";
  }

  const verifiedTime = readTime(summary.verifiedAt);

  // An unreadable sign-off time reads as "changed", so it's signed again.
  return verifiedTime.isValid &&
    generatedTime.toMillis() <= verifiedTime.toMillis()
    ? "verified"
    : "changed";
}

/**
 * Read the fields the verify flow shows and decides on.
 *
 * - Reads every layout YAML allows, aliases included, unlike the edits.
 *
 * @returns the summary, or `undefined` when the text has no frontmatter block.
 */
export function readRecordSummary(
  params: ReadRecordSummaryParams
): RecordSummary | undefined {
  const { text, verifiedBy } = params;
  const block = splitFrontmatter(text);

  if (block === undefined) {
    return undefined;
  }

  const doc = parseFrontmatter(block.text);
  const { contents } = doc;
  const ownEntry = findOwnEntry({ doc, verifiedBy });

  const generated = readField({
    doc,
    key: FRONTMATTER_KEYS.generated,
    map: contents,
  });

  const status = readString(
    readField({ doc, key: FRONTMATTER_KEYS.status, map: contents })
  );

  return {
    generatedAt: readTimestamp(
      readField({ doc, key: ENTRY_KEYS.at, map: generated })
    ),
    status: status !== undefined && isRecordStatus(status) ? status : undefined,
    title: readString(
      readField({ doc, key: FRONTMATTER_KEYS.title, map: contents })
    ),
    type: readString(
      readField({ doc, key: FRONTMATTER_KEYS.type, map: contents })
    ),
    verifiedAt: readTimestamp(
      readField({ doc, key: ENTRY_KEYS.at, map: ownEntry })
    ),
  };
}

/** Read a timestamp as ISO 8601, or with a space before the time, in UTC. */
function readTime(value: Timestamp): DateTime {
  const iso = DateTime.fromISO(value, { zone: "utc" });

  return iso.isValid ? iso : DateTime.fromSQL(value, { zone: "utc" });
}
