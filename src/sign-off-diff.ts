/*
 * What changed in a record since the signer last signed it off, for the
 * person to review before signing it again.
 */
import type { DateTime } from "luxon";

import type { RecordSummary } from "./frontmatter/read.ts";
import type { Timestamp } from "./frontmatter/types.ts";
import type { Outcome } from "./outcome.ts";

import { getRecordState, readRecordSummary } from "./frontmatter/read.ts";
import { readTime } from "./frontmatter/shared.ts";
import {
  diffSince,
  isShallowRepo,
  listFileCommits,
  readTextAt,
} from "./git.ts";

/** A carriage return's code unit. */
const CARRIAGE_RETURN = 0x0d;

/** A line feed's code unit. */
const LINE_FEED = 0x0a;

/** A tab's code unit. */
const TAB = 0x09;

/** What a record shows for review: its diff, or the whole record. */
export type SignOffDiff =
  | {
      /**
       * The commit that set the signer's `verified.at` was found.
       *
       * @example "diff"
       */
      kind: "diff";

      /**
       * That commit's hash as git abbreviates it.
       *
       * @example "1a2b3c4"
       */
      shortHash: string;

      /**
       * The diff from that commit to the record on disk; empty when nothing
       * changed.
       *
       * @example
       * ```ts
       * "@@ -5 +5 @@\n-Body text.\n+New body text.\n"
       * ```
       */
      text: string;
    }
  | {
      /**
       * The record holds a sign-off, but no commit shows what was signed: it
       * was signed by hand and not committed, or the commit that set it holds
       * the record generated again after it.
       *
       * @example "noCommit"
       */
      kind: "noCommit";

      /**
       * The whole record.
       *
       * @example
       * ```ts
       * "---\ntype: Decision\n---\n"
       * ```
       */
      text: string;
    }
  | {
      /**
       * The signer has never signed the record off.
       *
       * @example "unsigned"
       */
      kind: "unsigned";

      /**
       * The whole record.
       *
       * @example
       * ```ts
       * "---\ntype: Decision\n---\n"
       * ```
       */
      text: string;
    };

/** A `SignOffDiff` worded for a person: a heading, then what to show. */
export type SignOffReport = {
  /**
   * The diff or the record, to show under the heading; empty when there's
   * nothing to show.
   *
   * @example
   * ```ts
   * "@@ -5 +5 @@\n-Body text.\n+New body text.\n"
   * ```
   */
  body: string;

  /**
   * One line saying what the body is.
   *
   * @example "docs/decisions/a.md: changes since human:jjloneman's sign-off in 1a2b3c4"
   */
  heading: string;
};

/**
 * Word a record's `SignOffDiff` for a person, naming the record and the
 * signer.
 *
 * - Control characters are shown as escapes, so text in a record can't move
 *   the cursor or erase lines of the review.
 */
export function describeSignOffDiff(params: {
  diff: SignOffDiff;
  filePath: string;
  verifiedBy: string;
}): SignOffReport {
  const { body, heading } = wordSignOffDiff(params);

  return {
    body: escapeControlCharacters(body),
    heading: escapeControlCharacters(heading),
  };
}

/**
 * Find what changed in a record since `verifiedBy` last signed it off.
 *
 * - The sign-off commit is the newest of the record's commits that holds the
 *   disk's sign-off when none of its parents does, and whose record is
 *   verified, not generated again after it. A merge, or a branch whose
 *   commits interleave with it by date, never ends the search early, and a
 *   commit that adds the record already signed, as `okf verify` or a squash
 *   does, counts when what it adds is what was signed.
 *
 * - The diff runs from there to the disk, uncommitted changes included.
 *
 * - When no commit qualifies, as for a sign-off made by hand and not
 *   committed, or one a commit restored after the record was regenerated, the
 *   whole record is shown.
 */
export function readSignOffDiff(params: {
  filePath: string;
  repoRoot: string;
  text: string;
  verifiedBy: string;
}): Outcome<SignOffDiff> {
  const { filePath, repoRoot, text, verifiedBy } = params;
  const signedAt = readRecordSummary({ text, verifiedBy })?.verifiedAt;

  if (signedAt === undefined) {
    return { isOk: true, value: { kind: "unsigned", text } };
  }

  const commits = listFileCommits({ filePath, repoRoot });

  if (!commits.isOk) {
    return commits;
  }

  // A commit is read again as the next one's parent, so each is read once.
  const cache = new Map<string, Outcome<RecordSummary | undefined>>();
  const readAt = (ref: string): Outcome<RecordSummary | undefined> => {
    const cached =
      cache.get(ref) ??
      readCommittedSummary({ filePath, ref, repoRoot, verifiedBy });
    cache.set(ref, cached);

    return cached;
  };

  for (const { hash, parents, shortHash } of commits.value) {
    const committed = readAt(hash);

    if (!committed.isOk) {
      return committed;
    }

    if (
      committed.value === undefined ||
      !isSameTime({ committedAt: committed.value.verifiedAt, signedAt }) ||
      getRecordState(committed.value) !== "verified"
    ) {
      continue;
    }

    let isInherited = false;

    for (const parent of parents) {
      const inParent = readAt(parent);

      if (!inParent.isOk) {
        return inParent;
      }

      isInherited = isSameTime({
        committedAt: inParent.value?.verifiedAt,
        signedAt,
      });

      if (isInherited) {
        break;
      }
    }

    if (isInherited) {
      continue;
    }

    // A shallow clone lists its oldest commits with no parents, so one of
    // them can't be told from the commit that added the record.
    if (parents.length === 0 && isShallowRepo(repoRoot)) {
      break;
    }

    const diff = diffSince({ commit: hash, filePath, repoRoot });

    return diff.isOk
      ? { isOk: true, value: { kind: "diff", shortHash, text: diff.value } }
      : diff;
  }

  return { isOk: true, value: { kind: "noCommit", text } };
}

/**
 * Show a text's control characters as `\\x..` escapes.
 *
 * - Tabs, line feeds, and a carriage return that ends a line are kept.
 */
function escapeControlCharacters(text: string): string {
  let escaped = "";

  // By code unit, since every control character is one, and a surrogate
  // pair passes through unchanged a half at a time.
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const isLineBreak =
      code === TAB ||
      code === LINE_FEED ||
      (code === CARRIAGE_RETURN && text.charCodeAt(index + 1) === LINE_FEED);
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);

    escaped +=
      isControl && !isLineBreak
        ? `\\x${code.toString(16).padStart(2, "0")}`
        : text.charAt(index);
  }

  return escaped;
}

/**
 * Whether a committed sign-off is the one on disk: written the same, or the
 * same time to the second, however it's written.
 */
function isSameTime(params: {
  committedAt: Timestamp | undefined;
  signedAt: Timestamp;
}): boolean {
  const { committedAt, signedAt } = params;

  if (committedAt === undefined) {
    return false;
  }

  if (committedAt === signedAt) {
    return true;
  }

  const committedTime = readTime(committedAt);
  const signedTime = readTime(signedAt);

  return (
    committedTime.isValid &&
    signedTime.isValid &&
    toSeconds(committedTime) === toSeconds(signedTime)
  );
}

/**
 * Read the record's summary as a commit holds it, for `verifiedBy`.
 *
 * @returns the summary, or `undefined` when the commit doesn't hold the
 * record, or holds it with no frontmatter.
 */
function readCommittedSummary(params: {
  filePath: string;
  ref: string;
  repoRoot: string;
  verifiedBy: string;
}): Outcome<RecordSummary | undefined> {
  const { filePath, ref, repoRoot, verifiedBy } = params;
  const committed = readTextAt({ filePath, ref, repoRoot });

  if (!committed.isOk) {
    return committed;
  }

  return {
    isOk: true,
    value:
      committed.value === undefined
        ? undefined
        : readRecordSummary({ text: committed.value, verifiedBy }),
  };
}

/** Read a time as whole seconds since the epoch, dropping any fraction. */
function toSeconds(time: DateTime): number {
  return Math.floor(time.toSeconds());
}

/** Word a record's `SignOffDiff` before its control characters are escaped. */
function wordSignOffDiff(params: {
  diff: SignOffDiff;
  filePath: string;
  verifiedBy: string;
}): SignOffReport {
  const { diff, filePath, verifiedBy } = params;

  switch (diff.kind) {
    case "diff": {
      return {
        body: diff.text,
        heading:
          diff.text === ""
            ? `${filePath}: unchanged since ${verifiedBy}'s sign-off in ${diff.shortHash}`
            : `${filePath}: changes since ${verifiedBy}'s sign-off in ${diff.shortHash}`,
      };
    }

    case "noCommit": {
      return {
        body: diff.text,
        heading: `${filePath}: no commit shows what ${verifiedBy} signed off, so here is the whole record`,
      };
    }

    case "unsigned": {
      return {
        body: diff.text,
        heading: `${filePath}: never signed off by ${verifiedBy}, so here is the whole record`,
      };
    }
  }
}
