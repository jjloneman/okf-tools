/*
 * The source rules `okf check` runs beside the trust rules: whether a file a
 * record cites in `sources` changed after the record was last written or
 * signed off, which its git history shows.
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

import type { CheckedFile, CheckRule, RuleHit } from "./check-engine.ts";
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
 * Warn about a cited path changed after the later of `generated.at` and the
 * latest sign-off.
 *
 * - A commit that changed the record too doesn't count, since the record
 *   kept up with it, as a squash-merged pull request does; nor do
 *   uncommitted changes while the record has some too.
 *
 * - A path that no longer exists is `T008`'s.
 */
function checkSourceChanged(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const writtenAt = readWrittenAt(parsed);

    if (writtenAt === undefined) {
      return [];
    }

    const ownChanges = new Set(
      file.readChanges(file.filePath).map(({ commit }) => commit?.hash)
    );

    return readCitedSources(parsed).flatMap(({ node, path, resource }) => {
      if (!file.doesExist(path)) {
        return [];
      }

      const [change] = file
        .readChanges(path)
        .filter(
          ({ at, commit }) => at > writtenAt && !ownChanges.has(commit?.hash)
        )
        .sort((left, right) => right.at - left.at);

      if (change === undefined) {
        return [];
      }

      const since = `since the record was last written or signed off, at ${formatSeconds(writtenAt)}`;

      return [
        {
          line: readNodeLine({ file, node }),
          message: `${
            change.commit === undefined
              ? `source ${resource} has uncommitted changes ${since}`
              : `source ${resource} changed in ${change.commit.shortHash}, at ${formatSeconds(change.at)}, ${since}`
          }; check the record still holds, then re-stamp generated with okf touch`,
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
