/*
 * The source rules `okf check` runs beside the trust rules: whether a file a
 * record cites in `sources` changed in a commit outside the history of the
 * record's own commits, or has uncommitted changes, which git shows.
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
import { readTimestamp } from "./frontmatter/shared.ts";
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
 * Warn about a cited path changed since the record was last written or
 * signed off.
 *
 * - A commit counts when it isn't in the history of a commit that changed
 *   the record, so a rebase, which resets every committer time, doesn't
 *   make a commit the record built on read as new, and a merged branch's
 *   commit counts whenever it was made.
 *
 * - While the record has uncommitted changes, such as a re-stamp `okf touch`
 *   made, a commit counts only when it's also later than the later of
 *   `generated.at` and the latest sign-off, since git can't say what an
 *   uncommitted record saw; a record git has no commits of is judged by
 *   that time alone.
 *
 * - Uncommitted changes count unless the record has some too.
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

    const ownChanges = file.readChanges(file.filePath);
    const isDirty = ownChanges.some(({ commit }) => commit === undefined);
    const lastCommit = ownChanges.find(
      ({ commit }) => commit !== undefined
    )?.commit;
    const unseen = file.readUnseenCommits(file.filePath);

    if (unseen === undefined) {
      return [];
    }
    const isUnseen = ({ at, commit }: FileChange): boolean =>
      commit === undefined
        ? !isDirty
        : unseen.has(commit.hash) &&
          ((!isDirty && lastCommit !== undefined) || at > writtenAt);

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
          message: `${describeChange({ change, lastCommit, resource, since })}; check the record still holds, then re-stamp generated with okf touch`,
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
 * - By a commit missing from the history of the record's last commit.
 *
 * - For a record git has no commits of, by a commit later than when it was
 *   written.
 */
function describeChange(params: {
  /**
   * The change to the cited path.
   *
   * @example `{ at: 1790000000, commit: { hash: "1a2b…", shortHash: "1a2b" } }`
   */
  change: FileChange;

  /**
   * The record's last commit, or `undefined` when git has none of it.
   *
   * @example `{ hash: "5e6f…", shortHash: "5e6f7a8" }`
   */
  lastCommit: FileChange["commit"];

  /** The `resource` as written. @example "../../src/check.ts" */
  resource: string;

  /**
   * When the record was last written or signed off, as the message says it.
   *
   * @example "since the record was last written or signed off, at …"
   */
  since: string;
}): string {
  const { change, lastCommit, resource, since } = params;

  if (change.commit === undefined) {
    return `source ${resource} has uncommitted changes ${since}`;
  }

  const changed = `source ${resource} changed in ${change.commit.shortHash}, at ${formatSeconds(change.at)}`;

  return lastCommit === undefined
    ? `${changed}, ${since}`
    : `${changed}, which isn't in the history of the record's last commit, ${lastCommit.shortHash}`;
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
