/*
 * `okf index`: syncs each bundle's `index.md` lines, and its tag index, from
 * the records' frontmatter, or with `--check` only reports the ones that
 * differ.
 *
 * - It edits only index files that already exist; writing an index's own
 *   prose or headings is left to people.
 */
import { existsSync, lstatSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { IndexRecord } from "./index-sync.ts";
import type { Outcome } from "./outcome.ts";
import type { Candidate, RecordEdit } from "./records.ts";
import type { SkippedRecord } from "./repo.ts";
import type { BundleContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { listIndexPaths } from "./git.ts";
import { syncIndex } from "./index-sync.ts";
import { describeError, toTerminalLine } from "./output.ts";
import { loadCandidates, matchExcluded, readRecordText } from "./repo.ts";

/** The file name of a folder's index. */
const INDEX_FILE = "index.md";

/**
 * The actor records are read as. An index needs no one's sign-off, so no
 * real actor is asked for; `okf` isn't a producer name a record would carry.
 */
export const NO_SIGNER = "okf:none";

/** The records one index lists, and the ones it can't read. */
type IndexScope = {
  /**
   * The records whose nearest index it is.
   *
   * @example `[{ path: "docs/decisions/a.md", title: "A", … }]`
   */
  records: IndexRecord[];

  /**
   * The files in its scope that couldn't be read as records.
   *
   * @example `[{ filePath: "docs/decisions/b.md", reason: "…" }]`
   */
  skipped: SkippedRecord[];
};

/** One index's synced text, worked out but not written, or why it can't be. */
type PlannedSync =
  | {
      /**
       * It could be synced.
       *
       * @example "planned"
       */
      kind: "planned";

      /**
       * Its text now, to compare with or restore.
       *
       * @example `"# Decisions\n"`
       */
      originalText: string;

      /**
       * Its synced text, the same as `originalText` when it's current.
       *
       * @example `"# Decisions\n\n- [A](a.md) - The first.\n"`
       */
      text: string;
    }
  | Extract<SyncResult, { kind: "refused" }>;

/** What syncing one index came to. */
type SyncResult =
  | {
      /**
       * It couldn't be synced.
       *
       * @example "refused"
       */
      kind: "refused";

      /**
       * Why, worded to follow the index's path.
       *
       * @example "has a tag-index:start marker but no tag-index:end"
       */
      reason: string;
    }
  | {
      /**
       * It was already current.
       *
       * @example "current"
       */
      kind: "current";
    }
  | {
      /**
       * It was out of date: written, or under `--check` only reported.
       *
       * @example "changed"
       */
      kind: "changed";
    };

/**
 * Find the index that lists a record: the nearest `index.md` in its folder or
 * a folder above it, still inside a bundle.
 *
 * @returns its path from the repo root, or `undefined` when no folder up to
 * the bundle has one.
 */
export function findNearestIndex(params: {
  bundleDirs: readonly string[];
  filePath: string;
  repoRoot: string;
}): string | undefined {
  const { bundleDirs, filePath, repoRoot } = params;
  let folder = path.posix.dirname(filePath);

  while (isInsideBundle({ bundleDirs, folder })) {
    const indexPath = path.posix.join(folder, INDEX_FILE);

    if (existsSync(path.join(repoRoot, indexPath))) {
      return indexPath;
    }

    if (folder === ".") {
      return undefined;
    }

    folder = path.posix.dirname(folder);
  }

  return undefined;
}

/**
 * Work out the index a new record would be listed in, synced with it as
 * `okf index` syncs it, before the record is written.
 *
 * @returns the index's path, its text now, and its synced text; `undefined`
 * when no folder up to the bundle has an index; or why it can't be synced.
 */
export function planIndexWithRecord(params: {
  context: BundleContext;
  record: IndexRecord;
}): Outcome<RecordEdit | undefined> {
  const { context, record } = params;
  const { bundleDirs, excludeGlobs, repoRoot } = context;
  const indexPath = findNearestIndex({
    bundleDirs,
    filePath: record.path,
    repoRoot,
  });

  if (indexPath === undefined) {
    return { isOk: true, value: undefined };
  }

  const loaded = loadCandidates({
    bundleDirs,
    excludeGlobs,
    isReadOnly: true,
    repoRoot,
    verifiedBy: NO_SIGNER,
  });

  if (!loaded.isOk) {
    return loaded;
  }

  const records = [
    ...loaded.value.candidates.map((candidate) => toIndexRecord(candidate)),
    record,
  ];
  const isListedHere = (filePath: string): boolean =>
    findNearestIndex({ bundleDirs, filePath, repoRoot }) === indexPath;
  const scope: IndexScope = {
    records: records.filter((listed) => isListedHere(listed.path)),
    skipped: loaded.value.skipped.filter((skipped) =>
      isListedHere(skipped.filePath)
    ),
  };
  const planned = planSync({ indexPath, records, repoRoot, scope });

  return planned.kind === "refused"
    ? {
        isOk: false,
        reason: `${indexPath} can't be synced: ${planned.reason}`,
      }
    : {
        isOk: true,
        value: {
          filePath: indexPath,
          originalText: planned.originalText,
          text: planned.text,
        },
      };
}

/**
 * Run `okf index`: sync every index in the bundles, or with `isCheck` only
 * report the ones out of date.
 *
 * - Exits `1` when an index can't be synced, or under `isCheck` when one
 *   differs; a record it can't read refuses only the index that lists it, since
 *   that index can't be written without its line.
 */
export function runIndex(params: {
  context: BundleContext;
  isCheck: boolean;
}): ExitCode {
  const { context, isCheck } = params;
  const { bundleDirs, excludeGlobs, output, repoRoot } = context;

  const loaded = loadCandidates({
    bundleDirs,
    excludeGlobs,
    isReadOnly: true,
    repoRoot,
    verifiedBy: NO_SIGNER,
  });

  if (!loaded.isOk) {
    output.error(loaded.reason);

    return EXIT_CODES.failure;
  }

  const records = loaded.value.candidates.map((candidate) =>
    toIndexRecord(candidate)
  );
  const scopes = groupByIndex({
    bundleDirs,
    excludeGlobs,
    records,
    repoRoot,
    skipped: loaded.value.skipped,
  });

  if (scopes.size === 0) {
    output.info("No index.md in the bundles to sync.");

    return EXIT_CODES.ok;
  }

  let isFailed = false;
  let didReport = false;

  for (const [indexPath, scope] of [...scopes].sort(([left], [right]) =>
    left < right ? -1 : 1
  )) {
    const result = syncOne({
      indexPath,
      isCheck,
      records,
      repoRoot,
      scope,
    });

    if (result.kind === "current") {
      continue;
    }

    didReport = true;

    if (result.kind === "refused") {
      isFailed = true;
      // A reason can quote a record's own text, such as a YAML error.
      output.error(
        toTerminalLine(`${indexPath} can't be synced: ${result.reason}`)
      );
    } else if (isCheck) {
      isFailed = true;
      output.error(
        toTerminalLine(`${indexPath} is out of date; run okf index to sync it.`)
      );
    } else {
      output.info(toTerminalLine(`Updated ${indexPath}.`));
    }
  }

  if (!didReport) {
    output.info("Every index is current.");
  }

  return isFailed ? EXIT_CODES.failure : EXIT_CODES.ok;
}

/** Read a loaded record as an index lists it. */
export function toIndexRecord(candidate: Candidate): IndexRecord {
  const { filePath, summary } = candidate;

  return {
    description: summary.description,
    path: filePath,
    tags: summary.tags ?? [],
    title: summary.title,
  };
}

/**
 * Group the records by the index that lists them, with every bundle's own
 * `index.md` and every one git tracks in a bundle too, so one whose records
 * were all removed still loses their lines.
 */
function groupByIndex(params: {
  bundleDirs: readonly string[];
  excludeGlobs: readonly string[];
  records: readonly IndexRecord[];
  repoRoot: string;
  skipped: readonly SkippedRecord[];
}): Map<string, IndexScope> {
  const { bundleDirs, excludeGlobs, records, repoRoot, skipped } = params;
  const isExcluded = matchExcluded(excludeGlobs);
  const scopes = new Map<string, IndexScope>();

  const scopeOf = (indexPath: string): IndexScope => {
    const scope = scopes.get(indexPath) ?? { records: [], skipped: [] };

    scopes.set(indexPath, scope);

    return scope;
  };

  const tracked = listIndexPaths(repoRoot).filter(
    (filePath) =>
      path.posix.basename(filePath) === INDEX_FILE &&
      !isExcluded(filePath) &&
      isInsideBundle({ bundleDirs, folder: path.posix.dirname(filePath) })
  );

  for (const indexPath of [
    ...bundleDirs.map((bundleDir) => path.posix.join(bundleDir, INDEX_FILE)),
    ...tracked,
  ]) {
    if (existsSync(path.join(repoRoot, indexPath))) {
      scopeOf(indexPath);
    }
  }

  for (const record of records) {
    const indexPath = findNearestIndex({
      bundleDirs,
      filePath: record.path,
      repoRoot,
    });

    if (indexPath !== undefined) {
      scopeOf(indexPath).records.push(record);
    }
  }

  for (const record of skipped) {
    const indexPath = findNearestIndex({
      bundleDirs,
      filePath: record.filePath,
      repoRoot,
    });

    if (indexPath !== undefined) {
      scopeOf(indexPath).skipped.push(record);
    }
  }

  return scopes;
}

/** Whether a folder, from the repo root, is a bundle or inside one. */
function isInsideBundle(params: {
  bundleDirs: readonly string[];
  folder: string;
}): boolean {
  const { bundleDirs, folder } = params;

  return bundleDirs.some(
    (bundleDir) =>
      bundleDir === "." ||
      folder === bundleDir ||
      folder.startsWith(`${bundleDir}/`)
  );
}

/**
 * Work out one index's synced text, from every record and the ones it lists,
 * writing nothing.
 *
 * - A symlink is refused, as records are, since git commits the link, not the
 *   file it points to.
 */
function planSync(params: {
  indexPath: string;
  records: readonly IndexRecord[];
  repoRoot: string;
  scope: IndexScope;
}): PlannedSync {
  const { indexPath, records, repoRoot, scope } = params;
  const absolutePath = path.join(repoRoot, indexPath);
  const [unreadable] = scope.skipped;

  if (unreadable !== undefined) {
    return {
      kind: "refused",
      reason: `a record it lists can't be read. ${unreadable.reason}`,
    };
  }

  let text: string;

  try {
    if (lstatSync(absolutePath).isSymbolicLink()) {
      return {
        kind: "refused",
        reason: "it's a symlink; an index is synced only at its own path",
      };
    }

    text = readRecordText({ filePath: indexPath, repoRoot });
  } catch (error) {
    return { kind: "refused", reason: describeError(error) };
  }

  const synced = syncIndex({
    doesExist: (filePath) => existsSync(path.join(repoRoot, filePath)),
    indexPath,
    records,
    scoped: scope.records,
    text,
  });

  return synced.isOk
    ? { kind: "planned", originalText: text, text: synced.text }
    : { kind: "refused", reason: `it ${synced.problem}` };
}

/** Sync one index, and write it back when it changed, unless `isCheck`. */
function syncOne(params: {
  indexPath: string;
  isCheck: boolean;
  records: readonly IndexRecord[];
  repoRoot: string;
  scope: IndexScope;
}): SyncResult {
  const { indexPath, isCheck, repoRoot } = params;
  const planned = planSync(params);

  if (planned.kind === "refused") {
    return planned;
  }

  if (planned.text === planned.originalText) {
    return { kind: "current" };
  }

  if (!isCheck) {
    try {
      writeFileSync(path.join(repoRoot, indexPath), planned.text);
    } catch (error) {
      return { kind: "refused", reason: describeError(error) };
    }
  }

  return { kind: "changed" };
}
