/*
 * Reads a record's frontmatter into a summary and works out whether it is
 * verified. Reading accepts any valid YAML; only editing is allowlisted.
 */
import { DateTime } from "luxon";
import { isNode, isScalar } from "yaml";

import type { RecordStatus, Timestamp, VerifyRecordParams } from "./types.ts";

import {
  describeYamlErrors,
  ENTRY_KEYS,
  findFenceProblem,
  findOwnEntry,
  FRONTMATTER_KEYS,
  isNullScalar,
  isRecordStatus,
  parseFrontmatter,
  readField,
  readNodeEnd,
  readString,
  readTime,
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

  /**
   * The record's `status` as written, whether or not OKF defines it.
   *
   * - `undefined` means the record has no `status`, an empty or null one, or
   *   one that isn't a single value, so it tells an absent status from one
   *   OKF doesn't define.
   *
   * @example "wip"
   */
  writtenStatus: string | undefined;
};

/** The timestamps the state is judged by, out of a `RecordSummary`. */
export type RecordTimes = Pick<RecordSummary, "generatedAt" | "verifiedAt">;

/**
 * Check that a record's frontmatter is valid YAML, in a block whose fences
 * can be found, so it can be read and edited safely.
 *
 * - A block that is almost right, such as one with no closing `---` line,
 *   is a problem too, so it's never taken for no frontmatter at all.
 *
 * @returns why it isn't, or `undefined` when it is or there's no frontmatter.
 */
export function findFrontmatterProblem(text: string): string | undefined {
  const block = splitFrontmatter(text);

  return block === undefined
    ? findFenceProblem(text)
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
 *
 * - Times are compared at whole seconds, since a sign-off is stamped to the
 *   second.
 *
 * - It never reads the clock: a `generated.at` ahead of it is judged like any
 *   other, and `isGeneratedAhead` is how a listing refuses such a record.
 */
export function getRecordState(summary: RecordTimes): RecordState {
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
  if (!verifiedTime.isValid) {
    return "changed";
  }

  return toSeconds(generatedTime) <= toSeconds(verifiedTime)
    ? "verified"
    : "changed";
}

/**
 * Whether a record's `generated.at` is later than now, to the second, as a
 * wrong time zone writes it.
 *
 * - Such a record is refused when it's listed, since any sign-off made now
 *   would be older than it, and one made later would hide a regeneration.
 */
export function isGeneratedAhead(summary: RecordTimes): boolean {
  if (summary.generatedAt === undefined) {
    return false;
  }

  const generatedTime = readTime(summary.generatedAt);

  return (
    generatedTime.isValid &&
    toSeconds(generatedTime) > toSeconds(DateTime.utc())
  );
}

/**
 * Read the fields the verify flow shows and decides on.
 *
 * - Reads every layout YAML allows, aliases included, unlike the edits.
 *
 * - Reads what it can of frontmatter that isn't valid YAML;
 *   `findFrontmatterProblem` tells such a record apart.
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

  const statusNode = readField({
    doc,
    key: FRONTMATTER_KEYS.status,
    map: contents,
  });
  const statusText =
    isScalar(statusNode) && isNullScalar(statusNode)
      ? undefined
      : readString(statusNode);
  const status = statusText === "" ? undefined : statusText;

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
    writtenStatus: status,
  };
}

/**
 * Read a record's `status` as it is written, even one OKF doesn't define.
 *
 * - `readRecordSummary` leaves such a status out, so a hint reads it here
 *   rather than claim the record has none.
 *
 * - A list or a mapping is returned as it is written, since it's there all
 *   the same.
 *
 * @returns the status, or `undefined` when it's missing or null.
 */
export function readStatusText(text: string): string | undefined {
  const block = splitFrontmatter(text);

  if (block === undefined) {
    return undefined;
  }

  const doc = parseFrontmatter(block.text);
  const node = readField({
    doc,
    key: FRONTMATTER_KEYS.status,
    map: doc.contents,
  });

  if (!isNode(node) || (isScalar(node) && isNullScalar(node))) {
    return undefined;
  }

  return isScalar(node)
    ? readString(node)
    : block.text.slice(node.range?.[0], readNodeEnd(node));
}

/** Read a time as whole seconds since the epoch, dropping any fraction. */
function toSeconds(time: DateTime): number {
  return Math.floor(time.toSeconds());
}
