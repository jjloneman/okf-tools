/*
 * The source rules `okf check` runs beside the trust rules: whether a file a
 * record cites in `sources` changed in a commit outside the history of the
 * record's re-stamps and sign-offs, or has uncommitted changes, which git
 * shows.
 *
 * - Only a `sources[].resource` that resolves to a path in the repo is
 *   checked, by §6's rules; a URL, and a scope descriptor, which has a space
 *   a path would percent-encode, are skipped.
 *
 * - A path may leave the bundle, since a record written from code cites the
 *   code. Only its history and whether it exists are read, never its text.
 *
 * - They work at file level, so a change that leaves the record true still
 *   warns; judging the prose is the review skill's audit mode.
 */
import { DateTime } from "luxon";
import path from "node:path";
import { isSeq } from "yaml";

import type {
  CheckedFile,
  CheckRule,
  FileChange,
  RuleHit,
} from "./check-engine.ts";
import type { ParsedFile } from "./spec-rules.ts";

import { readNodeLine } from "./check-engine.ts";
import { isGeneratedAhead, isVerifiedAhead } from "./frontmatter/read.ts";
import {
  parseFrontmatter,
  readTimestamp,
  splitFrontmatter,
} from "./frontmatter/shared.ts";
import { hasScheme } from "./markdown.ts";
import {
  decodePath,
  isValidTimestamp,
  readEvents,
  readParsed,
  withConcept,
} from "./spec-rules.ts";
import { readChangedAt } from "./trust-rules.ts";

/** A `sources` entry whose `resource` resolves to a path in the repo. */
type CitedSource = {
  /**
   * Its `resource` node, for the line a finding is on.
   *
   * @example `parsed.read(entry, "resource")`
   */
  node: unknown;

  /**
   * The path it resolves to, from the repo root, with `/` separators.
   *
   * @example "src/check.ts"
   */
  path: string;

  /**
   * Its `resource` as written.
   *
   * @example "../../src/check.ts"
   */
  resource: string;
};

/** The source rules, by code. */
export const SOURCE_RULES: readonly CheckRule[] = [
  {
    checkFile: checkSourceChanged,
    code: "T007",
    name: "source-changed",
    severity: "warning",
  },
  {
    checkFile: checkSourceGone,
    code: "T008",
    name: "source-gone",
    severity: "error",
  },
];

/**
 * Read the paths in the repo a record's `sources` cite, each once, or none
 * for a file that isn't a concept.
 */
export function readSourcePaths(file: CheckedFile): string[] {
  const parsed = readParsed(file);

  return file.kind === "markdown" && parsed !== undefined
    ? [...new Set(readCitedSources(parsed).map(({ path }) => path))]
    : [];
}

/**
 * Read a record's `generated` and `verified` as one value, for telling which
 * of its commits re-stamped or signed it off, or `undefined` when the text
 * has no frontmatter YAML can read.
 *
 * - By what they mean, every mapping's keys sorted, so a change of layout,
 *   flow or block, or of key order, isn't a re-stamp.
 *
 * - An alias that can't be resolved, one that expands past the parser's
 *   limit, or one that loops back on itself reads as `undefined`, since a
 *   past commit's frontmatter is never checked before it's read.
 */
export function readStamp(text: string | undefined): string | undefined {
  const block = text === undefined ? undefined : splitFrontmatter(text);

  if (block === undefined) {
    return undefined;
  }

  const doc = parseFrontmatter(block.text);

  if (doc.errors.length > 0) {
    return undefined;
  }

  try {
    const data: unknown = doc.toJS();
    const fields = new Map(
      typeof data === "object" && data !== null ? Object.entries(data) : []
    );

    return JSON.stringify(
      [fields.get("generated"), fields.get("verified")],
      sortKeys
    );
  } catch {
    return undefined;
  }
}

/**
 * Warn about a cited path changed since the record was last written or
 * signed off.
 *
 * - A commit counts when it isn't in the history of a commit that re-stamped
 *   or signed off the record, changing its `generated` or `verified`, so a
 *   rebase, which resets every committer time, doesn't make a commit the
 *   record built on read as new, a merged branch's commit counts whenever it
 *   was made, and an edit that didn't re-stamp, such as to `tags` alone or
 *   an `okf format`, doesn't hide one.
 *
 * - While the record's `generated` or `verified` differs from `HEAD`'s, as
 *   an uncommitted re-stamp `okf touch` made, a commit counts only when it's
 *   also later than the later of `generated.at` and the latest sign-off,
 *   since git can't say what an uncommitted re-stamp saw; a record no commit
 *   re-stamped or signed off is judged by that time alone.
 *
 * - Uncommitted changes count unless the record has an uncommitted re-stamp
 *   or sign-off too; an uncommitted edit that changes neither, such as an
 *   `okf format` fix, hides nothing.
 *
 * - When git couldn't read the record's history, or say which commits it
 *   holds, the record is skipped, as `okf check` says on stderr.
 *
 * - A path that no longer exists is `T008`'s.
 */
function checkSourceChanged(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const writtenAt = readWrittenAt(parsed);

    if (writtenAt === undefined) {
      return [];
    }

    const seen = file.readUnseenCommits(file.filePath);

    if (seen === undefined) {
      return [];
    }

    const { hasUncommittedStamp, lastSeen, unseen } = seen;
    const isUnseen = ({ at, commit }: FileChange): boolean =>
      commit === undefined
        ? !hasUncommittedStamp
        : unseen.has(commit.hash) &&
          ((!hasUncommittedStamp && lastSeen !== undefined) || at > writtenAt);

    return readCitedSources(parsed).flatMap(({ node, path, resource }) => {
      if (!file.doesExist(path)) {
        return [];
      }

      const [change] = file
        .readChanges(path)
        .filter(isUnseen)
        .sort((left, right) => right.at - left.at);

      if (change === undefined) {
        return [];
      }

      const since = `since the record was last written or signed off, at ${formatSeconds(writtenAt)}`;

      return [
        {
          line: readNodeLine({ file, node }),
          message: `${describeChange({ change, lastSeen, resource, since })}; check the record still holds, then re-stamp generated with okf touch`,
        },
      ];
    });
  });
}

/** Fail a cited path that git history has but the working tree doesn't. */
function checkSourceGone(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) =>
    readCitedSources(parsed)
      .filter(
        ({ path }) => !file.doesExist(path) && file.readChanges(path).length > 0
      )
      .map(({ node, resource }) => ({
        line: readNodeLine({ file, node }),
        message: `source ${resource} no longer exists, though git history has it; cite where it is now, or remove the source`,
      }))
  );
}

/**
 * Say how a cited path changed.
 *
 * - By uncommitted changes.
 *
 * - By a commit missing from the history of the record's last re-stamp or
 *   sign-off.
 *
 * - For a record no commit re-stamped or signed off, by a commit later than
 *   when it was written.
 */
function describeChange(params: {
  /**
   * The change to the cited path.
   *
   * @example `{ at: 1790000000, commit: { hash: "1a2b…", shortHash: "1a2b" } }`
   */
  change: FileChange;

  /**
   * The record's last commit that re-stamped or signed it off, or
   * `undefined` when none did.
   *
   * @example `{ hash: "5e6f…", shortHash: "5e6f7a8" }`
   */
  lastSeen: FileChange["commit"];

  /** The `resource` as written. @example "../../src/check.ts" */
  resource: string;

  /**
   * When the record was last written or signed off, as the message says it.
   *
   * @example "since the record was last written or signed off, at …"
   */
  since: string;
}): string {
  const { change, lastSeen, resource, since } = params;

  if (change.commit === undefined) {
    return `source ${resource} has uncommitted changes ${since}`;
  }

  const changed = `source ${resource} changed in ${change.commit.shortHash}, at ${formatSeconds(change.at)}`;

  return lastSeen === undefined
    ? `${changed}, ${since}`
    : `${changed}, which isn't in the history of the record's last re-stamp or sign-off, ${lastSeen.shortHash}`;
}

/** Write whole seconds since the epoch as a UTC date-time. */
function formatSeconds(seconds: number): string {
  return DateTime.fromSeconds(seconds, { zone: "utc" }).toFormat(
    "yyyy-MM-dd'T'HH:mm:ss'Z'"
  );
}

/**
 * Read each `sources` entry whose `resource` resolves to a path in the repo,
 * a bare mapping as one entry (§11.2).
 */
function readCitedSources(parsed: ParsedFile): CitedSource[] {
  const sources = parsed.get("sources");

  // Anything but a list is read as one entry, which yields nothing unless
  // it's a mapping.
  const entries: unknown[] = isSeq(sources) ? sources.items : [sources];

  return entries.flatMap((entry) => {
    const node = parsed.read(parsed.resolve(entry), "resource");
    const resource = readTimestamp(node);

    if (resource === undefined) {
      return [];
    }

    const resolved = resolveSourcePath({ file: parsed.file, resource });

    return resolved === undefined ? [] : [{ node, path: resolved, resource }];
  });
}

/**
 * Read the later of `generated.at` and the latest sign-off, in whole seconds
 * since the epoch, or `undefined` when neither can be read.
 *
 * - A `generated.at` or a sign-off later than now is left out, as `T003`
 *   and `T004` warn, so it can't hide a source change until the clock
 *   passes it.
 */
function readWrittenAt(parsed: ParsedFile): number | undefined {
  const signedAt = readEvents(parsed)
    .map(({ at }) => readTimestamp(at))
    .filter(
      (value) => !isVerifiedAhead({ generatedAt: undefined, verifiedAt: value })
    );
  const generatedAt = readTimestamp(readChangedAt(parsed));
  const times = [
    ...(isGeneratedAhead({ generatedAt, verifiedAt: undefined })
      ? []
      : [generatedAt]),
    ...signedAt,
  ].flatMap((value) =>
    value !== undefined && isValidTimestamp(value)
      ? [Math.floor(DateTime.fromISO(value, { zone: "utc" }).toSeconds())]
      : []
  );

  return times.length === 0 ? undefined : Math.max(...times);
}

/**
 * Resolve a `resource` to a path from the repo root, by §6's rules, or
 * `undefined` when it isn't a path in the repo.
 *
 * - A value with a space is a scope descriptor, since a path would
 *   percent-encode it (§6).
 */
function resolveSourcePath(params: {
  file: CheckedFile;
  resource: string;
}): string | undefined {
  const { file, resource } = params;

  if (
    /\s/u.test(resource) ||
    hasScheme(resource) ||
    resource.startsWith("//") ||
    resource.startsWith("#")
  ) {
    return undefined;
  }

  const clean = decodePath(resource.replace(/[#?].*$/u, ""));
  const base = clean.startsWith("/")
    ? file.bundleDir
    : path.posix.dirname(file.filePath);
  const resolved = path.posix.join(base, clean).replace(/\/+$/u, "");

  return resolved === "." || resolved === ".." || resolved.startsWith("../")
    ? undefined
    : resolved;
}

/**
 * Sort a mapping's keys, as `JSON.stringify` replaces each value, so two
 * mappings that mean the same are written the same.
 */
function sortKeys(_key: string, value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    : value;
}
