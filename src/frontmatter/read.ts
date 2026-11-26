/*
 * Reads a record's frontmatter into a summary and works out whether it is
 * verified. Reading accepts any valid YAML; only editing is allowlisted.
 */
import { DateTime } from "luxon";
import { isNode, isScalar, isSeq } from "yaml";

import type { Frontmatter } from "./shared.ts";
import type {
  RecordStatus,
  Timestamp,
  TrustTier,
  Verification,
  VerifyRecordParams,
} from "./types.ts";

import {
  describeYamlErrors,
  ENTRY_KEYS,
  findFenceProblem,
  findLatestIndex,
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
  resolveAlias,
  splitFrontmatter,
} from "./shared.ts";
import { TRUST_TIERS } from "./types.ts";

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
   * The record's `description`, without its quotes.
   *
   * - Optional, so a summary built before it existed still type-checks;
   *   `readRecordSummary` always sets it.
   *
   * @example "Every export returns a fallback instead of throwing."
   */
  description?: string | undefined;

  /**
   * When the record was last generated, if it says.
   *
   * @example "2026-10-01T15:00:00Z"
   */
  generatedAt: Timestamp | undefined;

  /**
   * When the record goes stale, from its `stale_after`, if it says.
   *
   * - The record is stale from this instant on, as OKF defines it.
   *
   * - Optional, so a summary built before it existed still type-checks;
   *   `readRecordSummary` always sets it.
   *
   * @example "2027-01-01T00:00:00Z"
   */
  staleAfter?: Timestamp | undefined;

  /**
   * The record's `status`, when it is one OKF defines.
   *
   * - Absent means `stable`, as OKF defines it.
   *
   * @example "draft"
   */
  status: RecordStatus | undefined;

  /**
   * The record's `tags`, in the order it lists them, each once, whatever
   * the list's layout: block, flow, or a flow list wrapped over lines.
   *
   * - Empty when it has none, or `tags` isn't a list; an item that isn't a
   *   non-empty string is left out.
   *
   * - Optional, so a summary built before it existed still type-checks;
   *   `readRecordSummary` always sets it.
   *
   * @example `["agents", "cli"]`
   */
  tags?: readonly string[] | undefined;

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
   * Every `verified` event with both a `by` and an `at`, by any actor, in
   * the order the record lists them; OKF ignores an event without both.
   *
   * - Optional, so a summary built before it existed still type-checks;
   *   `readRecordSummary` always sets it.
   *
   * @example `[{ at: "2026-10-02T13:30:00Z", by: "human:jjloneman" }]`
   */
  verifications?: readonly Verification[] | undefined;

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

/** What the trust tier is judged by, out of a `RecordSummary`. */
export type TrustTimes = Pick<RecordSummary, "generatedAt" | "verifications">;

/** The actor scheme that alone earns the `human-reviewed` tier. */
const HUMAN_SCHEME = "human:";

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
 * - It never reads the clock: a `generated.at` or `verified.at` ahead of it
 *   is judged like any other. A listing refuses the first with
 *   `isGeneratedAhead`, and treats the second as `changed` with
 *   `isVerifiedAhead`.
 */
export function getRecordState(summary: RecordTimes): RecordState {
  const { generatedAt, verifiedAt } = summary;

  if (verifiedAt === undefined) {
    return "unverified";
  }

  return isAtOrAfterGeneration({ at: verifiedAt, generatedAt })
    ? "verified"
    : "changed";
}

/**
 * Calculate a record's trust tier as OKF v0.3 does, from its current
 * `verified` events, by any actor.
 *
 * - Each actor's latest event counts, as `findOwnEntry` picks the signer's,
 *   so the signer's part agrees with `getRecordState` whenever each of its
 *   events has an `at`.
 *
 * - That event is current when `getRecordState` would call it `verified`:
 *   at or after `generated.at`, to the whole second, or with a missing or
 *   unreadable `generated.at`.
 *
 * - One ahead of the clock isn't current, as a listing treats such a
 *   sign-off as `changed`; so, like `isStale`, it reads the clock.
 *
 * - Only a `human:<id>` actor earns `human-reviewed`; any other, `team:`
 *   included, earns `machine-confirmed`.
 */
export function getTrustTier(summary: TrustTimes): TrustTier {
  const { generatedAt, verifications = [] } = summary;
  const current = readLatestByActor(verifications).filter(({ at }) =>
    isCurrentVerification({ at, generatedAt })
  );

  if (current.length === 0) {
    return TRUST_TIERS.unverified;
  }

  return current.some(({ by }) => isHumanActor(by))
    ? TRUST_TIERS.humanReviewed
    : TRUST_TIERS.machineConfirmed;
}

/**
 * Whether a `verified` event is current, as OKF v0.3 counts one: at or after
 * `generated.at`, to the whole second, and not ahead of the clock.
 *
 * - A missing or unreadable `generated.at` can't be compared, so any
 *   readable sign-off not ahead of the clock is current, as
 *   `getRecordState` has it.
 *
 * - It reads the clock, so a sign-off ahead of it isn't current, as a
 *   listing treats such a sign-off as `changed`.
 */
export function isCurrentVerification(params: {
  /**
   * When the event says it signed the record off.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  at: Timestamp;

  /**
   * When the record was last generated, if it says.
   *
   * @example "2026-10-01T15:00:00Z"
   */
  generatedAt: Timestamp | undefined;
}): boolean {
  return !isAhead(params.at) && isAtOrAfterGeneration(params);
}

/**
 * Whether a record's `generated.at` is later than now, to the second, as a
 * wrong time zone writes it.
 *
 * - Such a record is refused when it's listed, since any sign-off made now
 *   would be older than it, and one made later would hide a regeneration.
 */
export function isGeneratedAhead(summary: RecordTimes): boolean {
  return isAhead(summary.generatedAt);
}

/**
 * Whether a record is past its `stale_after`: stale from that instant on, as
 * OKF defines it.
 *
 * - It reads the clock, unlike `getRecordState`.
 *
 * - It compares to the millisecond, not the second, so a record is never
 *   stale before the instant it names.
 *
 * - A `stale_after` that can't be read as a time isn't stale, since no
 *   instant can be compared with it.
 */
export function isStale(summary: Pick<RecordSummary, "staleAfter">): boolean {
  if (summary.staleAfter === undefined) {
    return false;
  }

  const time = readTime(summary.staleAfter);

  return time.isValid && DateTime.utc().toMillis() >= time.toMillis();
}

/**
 * Whether the signer's latest `verified.at` is later than now, to the second,
 * as a wrong time zone writes it.
 *
 * - A listing treats such a record as `changed`, since a sign-off still to
 *   come would hide every regeneration until the clock passed it; signing it
 *   again renews that entry with a real time.
 */
export function isVerifiedAhead(summary: RecordTimes): boolean {
  return isAhead(summary.verifiedAt);
}

/**
 * Keep each actor's latest event, in the order each actor first appears:
 * the one whose `at` is latest once read, as `findLatestIndex` picks it.
 *
 * - `okf verify` renews only the signer's latest event, so an older one is
 *   history, never a sign-off of its own.
 */
export function readLatestByActor<T extends Verification>(
  verifications: readonly T[]
): T[] {
  const byActor = new Map<string, T[]>();

  for (const event of verifications) {
    byActor.set(event.by, [...(byActor.get(event.by) ?? []), event]);
  }

  return [...byActor.values()].flatMap((events) => {
    const latestIndex = findLatestIndex(events.map(({ at }) => at));

    return events.filter((_event, index) => index === latestIndex);
  });
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
    description: readString(
      readField({ doc, key: FRONTMATTER_KEYS.description, map: contents })
    ),
    generatedAt: readTimestamp(
      readField({ doc, key: ENTRY_KEYS.at, map: generated })
    ),
    staleAfter: readTimestamp(
      readField({ doc, key: FRONTMATTER_KEYS.staleAfter, map: contents })
    ),
    status: status !== undefined && isRecordStatus(status) ? status : undefined,
    tags: readTags({
      doc,
      node: readField({ doc, key: FRONTMATTER_KEYS.tags, map: contents }),
    }),
    title: readString(
      readField({ doc, key: FRONTMATTER_KEYS.title, map: contents })
    ),
    type: readString(
      readField({ doc, key: FRONTMATTER_KEYS.type, map: contents })
    ),
    verifications: readVerifications(doc),
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

/** Whether a readable timestamp is later than now, to the second. */
function isAhead(timestamp: Timestamp | undefined): boolean {
  if (timestamp === undefined) {
    return false;
  }

  const time = readTime(timestamp);

  return time.isValid && toSeconds(time) > toSeconds(DateTime.utc());
}

/**
 * Whether a sign-off at `at` still holds against the generation time.
 *
 * - A missing or unreadable generation time can't be compared, and treating
 *   it as later would ask for a sign-off no sign-off could satisfy.
 *
 * - An unreadable sign-off time doesn't hold, so it's signed again.
 *
 * - Times are compared at whole seconds, since a sign-off is stamped to the
 *   second.
 */
function isAtOrAfterGeneration(params: {
  at: Timestamp;
  generatedAt: Timestamp | undefined;
}): boolean {
  const { at, generatedAt } = params;
  const generatedTime =
    generatedAt === undefined ? undefined : readTime(generatedAt);

  if (generatedTime?.isValid !== true) {
    return true;
  }

  const time = readTime(at);

  return time.isValid && toSeconds(generatedTime) <= toSeconds(time);
}

/** Whether an actor is a person: `human:` with an id after it. */
function isHumanActor(by: string): boolean {
  return by.startsWith(HUMAN_SCHEME) && by.length > HUMAN_SCHEME.length;
}

/**
 * Read a `tags` list: each item a non-empty string, each once, in the order
 * listed, or none when it isn't a list.
 */
function readTags(params: { doc: Frontmatter; node: unknown }): string[] {
  const { doc, node } = params;

  if (!isSeq(node)) {
    return [];
  }

  const tags = node.items
    .map((item) => readString(resolveAlias({ doc, node: item })))
    .filter((tag): tag is string => tag !== undefined && tag !== "");

  return [...new Set(tags)];
}

/**
 * Read every `verified` event that has both a `by` and an `at`, aliases
 * resolved by `readField`; a bare mapping is one event, as OKF reads it.
 */
function readVerifications(doc: Frontmatter): Verification[] {
  const verified = readField({
    doc,
    key: FRONTMATTER_KEYS.verified,
    map: doc.contents,
  });
  const entries: unknown[] = isSeq(verified) ? verified.items : [verified];

  return entries.flatMap((map) => {
    // `readTimestamp` reads any single non-null, non-empty value, a `by`
    // too.
    const by = readTimestamp(readField({ doc, key: ENTRY_KEYS.by, map }));
    const at = readTimestamp(readField({ doc, key: ENTRY_KEYS.at, map }));

    return by === undefined || at === undefined ? [] : [{ at, by }];
  });
}

/** Read a time as whole seconds since the epoch, dropping any fraction. */
function toSeconds(time: DateTime): number {
  return Math.floor(time.toSeconds());
}
