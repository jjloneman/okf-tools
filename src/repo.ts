/*
 * The CLI's file-system work on records, always relative to the repo root:
 * resolving bundles and paths, loading candidates, and reading and writing
 * records.
 */
import { isUtf8 } from "node:buffer";
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import picomatch from "picomatch";

import type { RecordState, RecordTimes } from "./frontmatter/read.ts";
import type { ChangedPaths } from "./git.ts";
import type { Outcome } from "./outcome.ts";
import type { Candidate, RecordEdit } from "./records.ts";

import { findEditProblem } from "./frontmatter/edit.ts";
import {
  findFrontmatterProblem,
  getRecordState,
  isGeneratedAhead,
  isVerifiedAhead,
  readRecordSummary,
} from "./frontmatter/read.ts";
import {
  listChangedPaths,
  listIgnoredFolders,
  listIndexPaths,
  toPathKey,
} from "./git.ts";
import { describeError } from "./output.ts";

/** A path read as a record: the record, or why it isn't one. */
export type LoadedRecord =
  | {
      /**
       * The record, judged against the signer's sign-off.
       *
       * @example `{ filePath: "docs/decisions/a.md", state: "changed", … }`
       */
      candidate: Candidate;

      /**
       * What the path turned out to be; a record here.
       *
       * @example "record"
       */
      kind: "record";
    }
  | {
      /**
       * What the path turned out to be: a file whose frontmatter block is a
       * near miss, isn't valid YAML, or can't be signed off as it stands, one
       * reached through a symlink, one with no frontmatter block, or one that
       * can't be read.
       *
       * @example "unreadable"
       */
      kind: "invalid" | "linked" | "notRecord" | "unreadable";

      /**
       * Why it isn't a record, naming the path.
       *
       * @example "docs/decisions/a.md can't be read: EACCES: permission denied"
       */
      reason: string;
    };

/**
 * git's index as a tree, for spelling a path as the index does: every path
 * it holds, folders included, and each folder's entries.
 */
type GitIndex = {
  /**
   * Each folder's entries, as paths from the repo root, by the folder's path;
   * the root is `.`.
   *
   * @example `new Map([[".", ["docs"]], ["docs", ["docs/a.md"]]])`
   */
  entries: Map<string, string[]>;

  /**
   * Every file the index holds, and every folder above one.
   *
   * @example `new Set(["docs", "docs/a.md"])`
   */
  paths: Set<string>;
};

/** Why a file is edited only at its own path. */
const LINK_EXPLANATION =
  "Records are edited only at their own path, since git commits a symlink, not the file it points to.";

/** The records read from a set of paths, and the ones left out. */
export type LoadedRecords = {
  /**
   * The records, in the order their paths were given.
   *
   * @example `[{ filePath: "docs/decisions/a.md", state: "unverified", … }]`
   */
  candidates: Candidate[];

  /**
   * The records left out because they can't be read, have a near-miss
   * frontmatter block, aren't valid YAML, have a layout the edits refuse, or
   * were generated ahead of the clock.
   *
   * @example `[{ filePath: "docs/decisions/b.md", reason: "…" }]`
   */
  skipped: SkippedRecord[];
};

/** A record left out of the list, and why. */
export type SkippedRecord = {
  /**
   * The record's path from the repo root.
   *
   * @example "docs/decisions/b.md"
   */
  filePath: string;

  /**
   * Why it was left out, naming the path.
   *
   * @example "docs/decisions/b.md can't be read: EACCES: permission denied"
   */
  reason: string;
};

/**
 * The file names OKF reserves in a bundle, which are never records: the
 * listing and the update history.
 */
const RESERVED_FILES: ReadonlySet<string> = new Set(["index.md", "log.md"]);

/**
 * How a record is opened for writing: never through a symlink at its own
 * name, so one swapped in after the re-read fails the write instead.
 */
const WRITE_FLAGS =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_TRUNC |
  constants.O_NOFOLLOW;

/**
 * Find the first bundle that holds a path from the repo root, at any depth.
 *
 * @returns the bundle, or `undefined` when none holds it.
 */
export function findBundleDir(params: {
  bundleDirs: readonly string[];
  filePath: string;
}): string | undefined {
  const { bundleDirs, filePath } = params;
  const key = toPathKey(filePath);

  return bundleDirs.find((bundleDir) => isInsideBundle({ bundleDir, key }));
}

/**
 * Find the bundle a path from the repo root belongs to: the deepest one that
 * holds it, so a bundle inside another owns its own files.
 *
 * @returns the bundle, or `undefined` when none holds it.
 */
export function findOwningBundle(params: {
  bundleDirs: readonly string[];
  filePath: string;
}): string | undefined {
  const { bundleDirs, filePath } = params;
  const key = toPathKey(filePath);

  return bundleDirs
    .filter((bundleDir) => isInsideBundle({ bundleDir, key }))
    .sort((left, right) => toDepth(right) - toDepth(left))[0];
}

/**
 * Whether a record's bytes on disk are still the text it was listed with.
 *
 * - Bytes are compared, since `readRecordText` decodes only valid UTF-8,
 *   which re-encodes exactly: a record saved since in another encoding
 *   differs.
 *
 * - A record replaced since by a symlink differs too, even to the same
 *   bytes, since the write would go through it.
 *
 * - A record that can't be read any more, such as one deleted since,
 *   throws, for `applyVerification` to report.
 */
export function isRecordUnchanged(params: {
  filePath: string;
  repoRoot: string;
  text: string;
}): boolean {
  const { filePath, repoRoot, text } = params;

  return (
    findLinkedPath({ filePath, repoRoot }) === undefined &&
    readFileSync(path.join(repoRoot, filePath)).equals(Buffer.from(text))
  );
}

/**
 * List the changed files under the bundles, from the branch diff and the
 * working tree, each spelled as git's index spells it (see `spellForGit`).
 *
 * - `git status` matches a pathspec byte for byte, and prints a file it
 *   doesn't track as the disk spells it, so each bundle is also asked for as
 *   the disk spells it, which differs only after a rename of a folder in
 *   case or Unicode form that git wasn't told about.
 *
 * - Fails when a bundle can't be listed any more, since then its disk spelling
 *   is unknown.
 */
export function listBundleChanges(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
}): Outcome<ChangedPaths> {
  const { bundleDirs, repoRoot } = params;
  const pathspecs = new Set(bundleDirs);

  for (const bundleDir of bundleDirs) {
    try {
      pathspecs.add(readDiskSpelling({ filePath: bundleDir, repoRoot }));
    } catch (error) {
      return {
        isOk: false,
        reason: `${bundleDir} can't be listed: ${describeError(error)}`,
      };
    }
  }

  const changes = listChangedPaths({ bundleDirs: [...pathspecs], repoRoot });

  if (!changes.isOk) {
    return changes;
  }

  const index = readGitIndex(repoRoot);

  // Name by name, so a record in a folder renamed only in case matches the
  // path `loadCandidates` and `resolveRecordPaths` give it.
  const spell = (filePath: string): string =>
    spellListedPath({ filePath, index, repoRoot });

  return {
    isOk: true,
    value: {
      ...changes.value,
      paths: new Set([...changes.value.paths].map(spell)),
      statusPaths: new Set(
        [...changes.value.statusPaths].map((key) => toPathKey(spell(key)))
      ),
    },
  };
}

/**
 * Read a record from disk, judged against `verifiedBy`'s sign-off.
 *
 * - A sign-off whose `verified.at` is ahead of the clock counts as `changed`,
 *   so the record is offered again and a fresh sign-off renews it.
 *
 * - `isReadOnly` reads it for a report, which never edits it: a layout the
 *   edits refuse, and a `generated.at` ahead of the clock, don't refuse it.
 *
 * @returns the candidate, or why it isn't one: it can't be read, it's
 * reached through a symlink, its frontmatter block is a near miss, such as
 * one with no closing fence, its frontmatter isn't valid YAML or is in a
 * layout the edits refuse, its `generated.at` is ahead of the clock, or it
 * has no frontmatter.
 */
export function loadCandidate(params: {
  filePath: string;
  isReadOnly?: boolean | undefined;
  repoRoot: string;
  verifiedBy: string;
}): LoadedRecord {
  const { filePath, isReadOnly = false, repoRoot, verifiedBy } = params;
  let text: string;

  try {
    const realPath = findLinkedPath({ filePath, repoRoot });

    if (realPath !== undefined) {
      return {
        kind: "linked",
        reason: `${filePath} is a symlink, or inside one, to ${realPath}. ${LINK_EXPLANATION}`,
      };
    }

    text = readRecordText({ filePath, repoRoot });
  } catch (error) {
    return {
      kind: "unreadable",
      reason: `${filePath} can't be read: ${describeError(error)}`,
    };
  }

  const problem = findFrontmatterProblem(text);

  if (problem !== undefined) {
    return { kind: "invalid", reason: `${filePath}: ${problem}` };
  }

  const summary = readRecordSummary({ text, verifiedBy });

  if (summary === undefined) {
    return {
      kind: "notRecord",
      reason: `${filePath} has no frontmatter block.`,
    };
  }

  const candidate: Candidate = {
    filePath,
    state: readListedState(summary),
    summary,
    text,
  };

  // A report only reads the record, so what would stop an edit doesn't
  // matter to it.
  if (isReadOnly) {
    return { candidate, kind: "record" };
  }

  // A layout the edits refuse is reported now, since choosing it would stop
  // the records chosen with it from being written too.
  const editProblem = findEditProblem({ text, verifiedBy });

  if (editProblem !== undefined) {
    return { kind: "invalid", reason: `${filePath}: ${editProblem}` };
  }

  // No sign-off made now can follow a generation time still to come, and an
  // older one would hide the regeneration, so its time zone is fixed first.
  return isGeneratedAhead(summary)
    ? {
        kind: "invalid",
        reason: `${filePath}: generated.at is ahead of the clock; fix its time zone`,
      }
    : { candidate, kind: "record" };
}

/**
 * Read every record in the bundles, at any depth, in the order
 * `orderRecordPaths` gives.
 *
 * - Only files count: `index.md` and `log.md` at any level, a folder named
 *   `*.md`, files without frontmatter, and anything `excludeGlobs` matches
 *   aren't records, so they're left out.
 *
 * - An excluded folder isn't read at all, and neither is a symlink to one,
 *   which can't hold a record git commits.
 *
 * - Neither is a folder git ignores, such as `node_modules`, or an untracked
 *   one holding only ignored files, nor `.git` or a folder holding one, a submodule or another clone, whose files this repo
 *   can't commit; a file git ignores is still read, as a named one is.
 *
 * - A record that can't be read, is reached through a symlink, has a
 *   near-miss frontmatter block, isn't valid YAML, has a layout the edits
 *   refuse, or was generated ahead of the clock is left out too, but
 *   reported, so the caller can say so rather than skip it unseen.
 *
 * - A bundle, or a folder in one, that can't be listed fails the whole load,
 *   naming the bundle, since its records can't even be counted as skipped.
 *
 * - `isReadOnly` loads them for a report, as `loadCandidate` says.
 */
export function loadCandidates(params: {
  bundleDirs: readonly string[];
  excludeGlobs: readonly string[];
  isReadOnly?: boolean | undefined;
  repoRoot: string;
  verifiedBy: string;
}): Outcome<LoadedRecords> {
  const { bundleDirs, excludeGlobs, repoRoot } = params;
  const isExcluded = matchExcluded(excludeGlobs);
  const filePaths: string[] = [];
  const index = readGitIndex(repoRoot);

  for (const bundleDir of bundleDirs) {
    const ignored = listIgnoredFolders({ bundleDir, repoRoot });

    if (!ignored.isOk) {
      return ignored;
    }

    const ignoredFolders = ignored.value;

    try {
      const listedPaths = listFiles({
        folder: bundleDir,
        isExcluded,
        isSkipped: (folder) =>
          ignoredFolders.has(toPathKey(folder)) ||
          existsSync(path.join(repoRoot, folder, ".git")),
        repoRoot,
      });

      // As git's index spells them, so a record renamed only in case matches
      // the name git prints.
      filePaths.push(
        ...listedPaths.map((filePath) =>
          spellListedPath({ filePath, index, repoRoot })
        )
      );
    } catch (error) {
      return {
        isOk: false,
        reason: `${bundleDir} can't be listed: ${describeError(error)}`,
      };
    }
  }

  return {
    isOk: true,
    value: loadCandidatesAt({
      ...params,
      filePaths: orderRecordPaths({ bundleDirs, filePaths }),
    }),
  };
}

/**
 * Read the records among the given paths, in the given order.
 *
 * - Keeps only `.md` files at any depth inside a bundle, other than
 *   `index.md`, `log.md`, and what `excludeGlobs` matches, that have a
 *   frontmatter block; anything else is skipped.
 *
 * - A record that can't be read, is reached through a symlink, has a
 *   near-miss frontmatter block, isn't valid YAML, has a layout the edits
 *   refuse, or was generated ahead of the clock is reported in `skipped`
 *   instead; under `isReadOnly`, only the first four are.
 */
export function loadCandidatesAt(params: {
  bundleDirs: readonly string[];
  excludeGlobs: readonly string[];
  filePaths: readonly string[];
  isReadOnly?: boolean | undefined;
  repoRoot: string;
  verifiedBy: string;
}): LoadedRecords {
  const {
    bundleDirs,
    excludeGlobs,
    filePaths,
    isReadOnly,
    repoRoot,
    verifiedBy,
  } = params;
  const isExcluded = matchExcluded(excludeGlobs);
  const loaded: LoadedRecords = { candidates: [], skipped: [] };

  for (const filePath of filePaths) {
    if (!isRecordPath({ bundleDirs, filePath, isExcluded, repoRoot })) {
      continue;
    }

    const record = loadCandidate({
      filePath,
      isReadOnly,
      repoRoot,
      verifiedBy,
    });

    if (record.kind === "record") {
      loaded.candidates.push(record.candidate);
    } else if (record.kind !== "notRecord") {
      loaded.skipped.push({ filePath, reason: record.reason });
    }
  }

  return loaded;
}

/**
 * Build a test of whether a path from the repo root is excluded: it, or a
 * folder above it, matches one of the globs.
 *
 * - Matching a folder excludes everything in it, so `docs/drafts` needs no
 *   `/**`.
 *
 * - Globs match dot files too, and compare by `toPathKey`, since git's
 *   spelling of a name can differ from the disk's in Unicode form.
 */
export function matchExcluded(
  excludeGlobs: readonly string[]
): (filePath: string) => boolean {
  const isMatch = picomatch(excludeGlobs.map(toPathKey), { dot: true });

  return (filePath) => {
    const segments = toPathKey(filePath).split("/");

    return segments.some((_, index) =>
      isMatch(segments.slice(0, index + 1).join("/"))
    );
  };
}

/**
 * Order paths from the repo root as records are listed: by the first bundle
 * that holds each, in bundle order, then by path in code-unit order.
 *
 * - A path held by two bundles, one inside the other, is listed once.
 *
 * - Paths in no bundle are left out.
 *
 * - Paths are compared by `toPathKey`, since git's spelling of a name can
 *   differ from the disk's in Unicode form.
 */
export function orderRecordPaths(params: {
  bundleDirs: readonly string[];
  filePaths: Iterable<string>;
}): string[] {
  const { bundleDirs, filePaths } = params;
  const remaining = new Map<string, string>();

  for (const filePath of filePaths) {
    remaining.set(toPathKey(filePath), filePath);
  }

  return bundleDirs.flatMap((bundleDir) => {
    const held = [...remaining]
      .filter(([key]) => isInsideBundle({ bundleDir, key }))
      .map(([key, filePath]) => {
        remaining.delete(key);

        return filePath;
      });

    return held.sort();
  });
}

/**
 * Read a record's text as it is on disk now.
 *
 * - Throws when the file can't be read, or when it isn't valid UTF-8, which
 *   the OKF spec requires: a lossy decode would write replacement characters
 *   over the bytes it couldn't read.
 *
 * - Node keeps a byte order mark when decoding, so the text re-encodes to
 *   exactly the bytes read.
 */
export function readRecordText(params: {
  filePath: string;
  repoRoot: string;
}): string {
  const { filePath, repoRoot } = params;
  const bytes = readFileSync(path.join(repoRoot, filePath));

  if (!isUtf8(bytes)) {
    throw new Error("it isn't valid UTF-8.");
  }

  return bytes.toString("utf8");
}

/**
 * Turn absolute bundle directories into paths from the repo root.
 *
 * - Each is spelled as git will match it (see `spellForGit`), so a bundle
 *   configured in another case or Unicode form, on a disk that accepts it,
 *   is the folder git knows.
 *
 * - The same directory given twice is kept once.
 *
 * - Fails on the first directory that is missing, outside the repo, or
 *   reached through a symlink, since git won't commit a path beyond one.
 */
export function resolveBundleDirs(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
}): Outcome<string[]> {
  const { bundleDirs, repoRoot } = params;
  const resolved: string[] = [];
  const index = readGitIndex(repoRoot);

  for (const absoluteDir of bundleDirs) {
    const relativeDir = toRepoPath({ absolutePath: absoluteDir, repoRoot });

    if (relativeDir === undefined) {
      return {
        isOk: false,
        reason: `${absoluteDir} is outside the repo at ${repoRoot}.`,
      };
    }

    if (!isDirectory(absoluteDir)) {
      return { isOk: false, reason: `No bundle directory at ${absoluteDir}.` };
    }

    const realPath = findLinkedPath({ filePath: relativeDir, repoRoot });

    if (realPath !== undefined) {
      return {
        isOk: false,
        reason: `The bundle ${absoluteDir} is a symlink, or inside one, to ${realPath}. ${LINK_EXPLANATION}`,
      };
    }

    const bundleDir = spellForGit({
      filePath: relativeDir,
      index,
      readName: (givenPath) => readRealName({ filePath: givenPath, repoRoot }),
      repoRoot,
    });

    if (!includesPath({ filePath: bundleDir, filePaths: resolved })) {
      resolved.push(bundleDir);
    }
  }

  return { isOk: true, value: resolved };
}

/**
 * Turn record paths from the command line into paths from the repo root.
 *
 * - Each must be an existing `.md` file at any depth inside one of the
 *   bundles, and not an `index.md` or `log.md`, or a path `excludeGlobs`
 *   matches.
 *
 * - Each is spelled as git will match it (see `spellForGit`), so a record
 *   named in another case or Unicode form, on a disk that accepts it, is the
 *   record git knows; one reached through a symlink keeps its spelling, for
 *   `loadCandidate` to refuse.
 *
 * - The same file named twice is kept once.
 */
export function resolveRecordPaths(params: {
  bundleDirs: readonly string[];
  cwd: string;
  excludeGlobs: readonly string[];
  recordPaths: readonly string[];
  repoRoot: string;
}): Outcome<string[]> {
  const { bundleDirs, cwd, excludeGlobs, recordPaths, repoRoot } = params;
  const isExcluded = matchExcluded(excludeGlobs);
  const resolved: string[] = [];
  const index = readGitIndex(repoRoot);

  for (const recordPath of recordPaths) {
    const absolutePath = path.resolve(cwd, recordPath);
    const typedPath = toRepoPath({ absolutePath, repoRoot });
    const filePath =
      typedPath !== undefined &&
      isFile(absolutePath) &&
      findLinkedPath({ filePath: typedPath, repoRoot }) === undefined
        ? spellForGit({
            filePath: typedPath,
            index,
            readName: (givenPath) =>
              readRealName({ filePath: givenPath, repoRoot }),
            repoRoot,
          })
        : typedPath;

    if (filePath === undefined || !isRecordName({ bundleDirs, filePath })) {
      return {
        isOk: false,
        reason: `${recordPath} isn't a record in ${bundleDirs.join(", ")}.`,
      };
    }

    if (isExcluded(filePath)) {
      return {
        isOk: false,
        reason: `${recordPath} is excluded by \`okf.exclude\`.`,
      };
    }

    if (!isFile(absolutePath)) {
      return { isOk: false, reason: `No record at ${recordPath}.` };
    }

    if (!includesPath({ filePath, filePaths: resolved })) {
      resolved.push(filePath);
    }
  }

  return { isOk: true, value: resolved };
}

/**
 * Write each record's new text to disk, all or nothing.
 *
 * - When a write fails partway, the records already written get their
 *   original text back, so no record is left half-verified. That text was
 *   read as strict UTF-8, so it re-encodes to the original bytes.
 *
 * - A record that has become a symlink since it was read fails its write,
 *   rather than edit the file the link points to.
 *
 * - That rollback is best effort, and covers the record whose write failed
 *   too, since a failed write can leave it truncated: a record it can't
 *   restore is named, so the person knows which are left changed.
 */
export function writeRecords(params: {
  edits: readonly RecordEdit[];
  repoRoot: string;
}): Outcome<undefined> {
  const { edits, repoRoot } = params;
  const written: RecordEdit[] = [];

  for (const edit of edits) {
    try {
      writeRecordFile({
        filePath: path.join(repoRoot, edit.filePath),
        text: edit.text,
      });
    } catch (error) {
      const unrestored = restoreRecords({
        edits: [...written, edit],
        repoRoot,
      });

      return {
        isOk: false,
        reason: [
          `Couldn't write ${edit.filePath}: ${describeError(error)}`,
          unrestored.length === 0
            ? "No files changed."
            : `These are left changed, since restoring them failed:\n${unrestored.join("\n")}`,
        ].join("\n"),
      };
    }

    written.push(edit);
  }

  return { isOk: true, value: undefined };
}

/**
 * Find how git's index spells a path from the repo root, when the disk
 * resolves that spelling to the same file.
 *
 * - The path as given, when the index holds that spelling.
 *
 * - Otherwise an entry in the same folder that differs from it only in case
 *   or Unicode form and that the disk resolves to it (see `isDiskSpelling`),
 *   as after a rename only in case that git wasn't told about. Case only
 *   narrows the search; the disk decides, so a case-sensitive disk keeps two
 *   such names apart.
 *
 * @returns the index's spelling, or `undefined` when it holds none.
 */
function findIndexSpelling(params: {
  filePath: string;
  index: GitIndex;
  repoRoot: string;
}): string | undefined {
  const { filePath, index, repoRoot } = params;

  if (index.paths.has(filePath)) {
    return filePath;
  }

  const key = toFoldKey(filePath);
  const entries = index.entries.get(path.posix.dirname(filePath)) ?? [];

  return entries.find(
    (entry) =>
      toFoldKey(entry) === key &&
      isDiskSpelling({ filePath, indexPath: entry, repoRoot })
  );
}

/**
 * Find where a path from the repo root really leads, when a symlink in the
 * repo, at the path or any folder above it, sends it elsewhere.
 *
 * @returns the real path, or `undefined` when it's the path itself.
 */
function findLinkedPath(params: {
  filePath: string;
  repoRoot: string;
}): string | undefined {
  const { filePath, repoRoot } = params;
  const realPath = realpathSync(path.join(repoRoot, filePath));

  return realPath === path.join(realpathSync(repoRoot), filePath)
    ? undefined
    : realPath;
}

/**
 * Whether a record needs no restoring: it's a symlink, which no write went
 * through, or it can be read and holds the given text.
 */
function holdsText(params: {
  filePath: string;
  originalText: string;
}): boolean {
  const { filePath, originalText } = params;

  try {
    return (
      lstatSync(filePath).isSymbolicLink() ||
      readFileSync(filePath, "utf8") === originalText
    );
  } catch {
    return false;
  }
}

/**
 * Whether `filePaths` holds `filePath` in any Unicode form, since git on
 * macOS takes both forms for one file.
 */
function includesPath(params: {
  filePath: string;
  filePaths: readonly string[];
}): boolean {
  const { filePath, filePaths } = params;
  const key = toPathKey(filePath);

  return filePaths.some((resolvedPath) => toPathKey(resolvedPath) === key);
}

/** Whether a path exists and is a directory. */
function isDirectory(directory: string): boolean {
  return existsSync(directory) && statSync(directory).isDirectory();
}

/**
 * Whether the disk resolves an index entry's spelling to the file at
 * `filePath`, both paths from the repo root, without listing that spelling as
 * a name of its own, as a case- or normalization-insensitive disk does.
 *
 * - Not following a symlink at either, and false when either can't be read.
 *
 * - A name of its own in the folder is a separate path to git, even a hard
 *   link to the same file, or one on a mount whose inode numbers are all
 *   alike.
 */
function isDiskSpelling(params: {
  filePath: string;
  indexPath: string;
  repoRoot: string;
}): boolean {
  const { filePath, indexPath, repoRoot } = params;

  try {
    const fileStats = lstatSync(path.join(repoRoot, filePath), {
      bigint: true,
    });
    const indexStats = lstatSync(path.join(repoRoot, indexPath), {
      bigint: true,
    });

    return (
      fileStats.dev === indexStats.dev &&
      fileStats.ino === indexStats.ino &&
      !readdirSync(path.join(repoRoot, path.posix.dirname(indexPath))).includes(
        path.posix.basename(indexPath)
      )
    );
  } catch {
    return false;
  }
}

/** Whether a path exists and is a file. */
function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}

/**
 * Whether a path key is inside a bundle, at any depth; the repo root, `.`,
 * holds every path.
 */
function isInsideBundle(params: { bundleDir: string; key: string }): boolean {
  const { bundleDir, key } = params;

  return bundleDir === "." || key.startsWith(`${toPathKey(bundleDir)}/`);
}

/**
 * Whether a path from the repo root is named like a record: an `.md` at any
 * depth inside a bundle, other than `index.md` and `log.md`, which OKF
 * reserves at every level.
 */
function isRecordName(params: {
  bundleDirs: readonly string[];
  filePath: string;
}): boolean {
  const { bundleDirs, filePath } = params;

  // A name git printed can differ from the disk's in Unicode form.
  const key = toPathKey(filePath);

  return (
    bundleDirs.some((bundleDir) => isInsideBundle({ bundleDir, key })) &&
    filePath.endsWith(".md") &&
    !RESERVED_FILES.has(path.posix.basename(filePath))
  );
}

/**
 * Whether a path from the repo root names a record, isn't excluded, and is a
 * file on disk.
 */
function isRecordPath(params: {
  bundleDirs: readonly string[];
  filePath: string;
  isExcluded: (filePath: string) => boolean;
  repoRoot: string;
}): boolean {
  const { filePath, isExcluded, repoRoot } = params;

  return (
    isRecordName(params) &&
    !isExcluded(filePath) &&
    isFile(path.join(repoRoot, filePath))
  );
}

/**
 * List the files in a folder from the repo root, at any depth, with `/`
 * separators, leaving out what `isExcluded` matches, `.git`, and the
 * subfolders `isSkipped` names.
 *
 * - A symlink is listed as a file, never followed, so a link to a folder
 *   can't loop or leave the bundle; `loadCandidate` refuses one that reaches
 *   a record.
 *
 * - Throws when a folder can't be listed.
 */
function listFiles(params: {
  folder: string;
  isExcluded: (filePath: string) => boolean;
  isSkipped: (folder: string) => boolean;
  repoRoot: string;
}): string[] {
  const { folder, isExcluded, isSkipped, repoRoot } = params;

  return readdirSync(path.join(repoRoot, folder), { withFileTypes: true })
    .filter((entry) => entry.name !== ".git")
    .map((entry) => ({ entry, filePath: path.posix.join(folder, entry.name) }))
    .filter(({ filePath }) => !isExcluded(filePath))
    .flatMap(({ entry, filePath }) => {
      if (!entry.isDirectory()) {
        return [filePath];
      }

      return isSkipped(filePath)
        ? []
        : listFiles({ ...params, folder: filePath });
    });
}

/**
 * Read the disk's spelling of a path from the repo root, every name in it, in
 * case and Unicode form, resolving it through the disk from the repo root's
 * real path.
 *
 * - Throws when the path is gone.
 */
function readDiskSpelling(params: {
  filePath: string;
  repoRoot: string;
}): string {
  const { filePath, repoRoot } = params;
  const realRoot = realpathSync.native(repoRoot);

  return toPosixPath(
    path.relative(realRoot, realpathSync.native(path.join(realRoot, filePath)))
  );
}

/**
 * Read git's index as a tree, in one `git ls-files` call; empty when git
 * can't be asked, so every path is spelled as the disk spells it.
 */
function readGitIndex(repoRoot: string): GitIndex {
  const entries = new Map<string, string[]>();
  const paths = new Set<string>();

  for (const indexPath of listIndexPaths(repoRoot)) {
    // Each folder is added with its first file, so it's listed once.
    for (
      let entry = indexPath;
      entry !== "." && !paths.has(entry);
      entry = path.posix.dirname(entry)
    ) {
      const folder = path.posix.dirname(entry);
      const folderEntries = entries.get(folder) ?? [];

      paths.add(entry);
      folderEntries.push(entry);
      entries.set(folder, folderEntries);
    }
  }

  return { entries, paths };
}

/**
 * Judge a listed record's state, reading the clock as `getRecordState` never
 * does.
 *
 * - A sign-off still to come would hide every regeneration until the clock
 *   passed it, so it counts as `changed`, whatever the generation time.
 */
function readListedState(summary: RecordTimes): RecordState {
  return isVerifiedAhead(summary) ? "changed" : getRecordState(summary);
}

/**
 * Read the disk's spelling of a path's last name, in case and Unicode form,
 * resolving it through the disk.
 */
function readRealName(params: { filePath: string; repoRoot: string }): string {
  const { filePath, repoRoot } = params;

  return path.basename(realpathSync.native(path.join(repoRoot, filePath)));
}

/**
 * Write each record's original text back, unless it already holds it.
 *
 * - A record already holding its original text is left alone, so one whose
 *   write was refused before it opened isn't reported as unrestored; so is
 *   a symlink, whose write `O_NOFOLLOW` refused.
 *
 * @returns why each record that couldn't be restored wasn't, naming it.
 */
function restoreRecords(params: {
  edits: readonly RecordEdit[];
  repoRoot: string;
}): string[] {
  const { edits, repoRoot } = params;
  const unrestored: string[] = [];

  for (const { filePath, originalText } of edits) {
    if (holdsText({ filePath: path.join(repoRoot, filePath), originalText })) {
      continue;
    }

    try {
      writeRecordFile({
        filePath: path.join(repoRoot, filePath),
        text: originalText,
      });
    } catch (error) {
      unrestored.push(`${filePath}: ${describeError(error)}`);
    }
  }

  return unrestored;
}

/**
 * Spell a path from the repo root as git will match it, since git compares
 * paths byte for byte: each name in it, folders first, as git's index spells
 * it when the disk resolves that spelling to the same file (see
 * `findIndexSpelling`), else as the disk spells it, in case and Unicode form.
 *
 * - The index wins, since after a rename only in case it can differ from the
 *   disk, and git matches the index.
 *
 * - Name by name, so a record git doesn't know yet, in a folder renamed only
 *   in case on disk, takes the index's spelling of the folder.
 *
 * - `readName` gives the disk's spelling of a name the index doesn't hold:
 *   `readRealName` for a path typed by hand, which must exist and must not
 *   be reached through a symlink, so resolving it changes only its spelling;
 *   the name as given for one listed from the disk or printed by git (see
 *   `spellListedPath`), which may be gone, as a deleted file is.
 */
function spellForGit(params: {
  filePath: string;
  index: GitIndex;
  readName: (givenPath: string) => string;
  repoRoot: string;
}): string {
  const { filePath, index, readName, repoRoot } = params;
  let spelled = ".";

  // The repo root, `.`, has no names to spell.
  for (const name of filePath.split("/").filter((part) => part !== ".")) {
    const givenPath = path.posix.join(spelled, name);

    spelled =
      findIndexSpelling({ filePath: givenPath, index, repoRoot }) ??
      path.posix.join(spelled, readName(givenPath));
  }

  return spelled;
}

/**
 * Spell a path listed from the disk or printed by git as git will match it
 * (see `spellForGit`), keeping as given each name the index doesn't hold.
 */
function spellListedPath(params: {
  filePath: string;
  index: GitIndex;
  repoRoot: string;
}): string {
  return spellForGit({
    ...params,
    readName: (givenPath) => path.posix.basename(givenPath),
  });
}

/**
 * Count a bundle folder's depth, with the root bundle `.` at `0`, so a
 * folder one level down always counts deeper than it.
 */
function toDepth(bundleDir: string): number {
  return bundleDir === "." ? 0 : bundleDir.split("/").length;
}

/**
 * The key two spellings of a name share when they differ only in case or
 * Unicode form, for narrowing which index entries to compare on disk.
 *
 * - Upper case first, so a final sigma and a medial one share a key.
 */
function toFoldKey(filePath: string): string {
  return toPathKey(filePath).toUpperCase().toLowerCase();
}

/**
 * Express a relative path with `/` separators; the repo root itself is `.`,
 * which git and `path.posix` both read as is.
 */
function toPosixPath(relativePath: string): string {
  return relativePath === ""
    ? "."
    : relativePath.split(path.sep).join(path.posix.sep);
}

/**
 * Express an absolute path from the repo root, with `/` separators.
 *
 * @returns the path, or `undefined` when it's outside the repo.
 */
function toRepoPath(params: {
  absolutePath: string;
  repoRoot: string;
}): string | undefined {
  const { absolutePath, repoRoot } = params;
  const relativePath = path.relative(repoRoot, absolutePath);

  const isOutside =
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);

  if (isOutside) {
    return undefined;
  }

  return toPosixPath(relativePath);
}

/**
 * Write a record's text in place, refusing a symlink at its name, which
 * fails with `ELOOP` rather than edit the file the link points to.
 */
function writeRecordFile(params: { filePath: string; text: string }): void {
  const { filePath, text } = params;
  const descriptor = openSync(filePath, WRITE_FLAGS);

  try {
    writeFileSync(descriptor, text);
  } finally {
    closeSync(descriptor);
  }
}

/** How a new record is opened: created, never over a file or a symlink. */
const CREATE_FLAGS =
  constants.O_WRONLY |
  constants.O_CREAT |
  constants.O_EXCL |
  constants.O_NOFOLLOW;

/**
 * Write a new record's text at a path from the repo root, failing when
 * anything is there already, a symlink included.
 *
 * - A file it created but couldn't fill is removed again, so a failed write
 *   leaves nothing behind.
 */
export function createRecordFile(params: {
  filePath: string;
  repoRoot: string;
  text: string;
}): Outcome<undefined> {
  const { filePath, repoRoot, text } = params;
  let descriptor: number;

  try {
    descriptor = openSync(path.join(repoRoot, filePath), CREATE_FLAGS);
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't write ${filePath}: ${describeError(error)}`,
    };
  }

  try {
    writeFileSync(descriptor, text);

    return { isOk: true, value: undefined };
  } catch (error) {
    const unremoved = removeRecordFile({ filePath, repoRoot });

    return {
      isOk: false,
      reason: [
        `Couldn't write ${filePath}: ${describeError(error)}`,
        unremoved === undefined
          ? "No files changed."
          : `It's left behind, since removing it failed: ${unremoved}`,
      ].join("\n"),
    };
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Remove a record this run created, when a later write failed.
 *
 * @returns why it couldn't be removed, or `undefined` once it's gone.
 */
export function removeRecordFile(params: {
  filePath: string;
  repoRoot: string;
}): string | undefined {
  const { filePath, repoRoot } = params;

  try {
    rmSync(path.join(repoRoot, filePath));

    return undefined;
  } catch (error) {
    return describeError(error);
  }
}

/**
 * Turn a new record's path from the command line into a path from the repo
 * root.
 *
 * - It must be named like a record, an `.md` at any depth inside a bundle
 *   other than `index.md` and `log.md`, and not be a path `excludeGlobs`
 *   matches.
 *
 * - Nothing may be at the path yet, not even a broken symlink, and its folder
 *   must already exist at its own path, not through a symlink, since git
 *   commits the link, not the file it points to.
 *
 * - The folder is spelled as git will match it (see `spellForGit`); the file
 *   name is kept as typed.
 */
export function resolveNewRecordPath(params: {
  bundleDirs: readonly string[];
  cwd: string;
  excludeGlobs: readonly string[];
  recordPath: string;
  repoRoot: string;
}): Outcome<string> {
  const { bundleDirs, cwd, excludeGlobs, recordPath, repoRoot } = params;
  const absolutePath = path.resolve(cwd, recordPath);
  const typedPath = toRepoPath({ absolutePath, repoRoot });
  const typedFolder =
    typedPath === undefined ? undefined : path.posix.dirname(typedPath);
  const isFolderOwn =
    typedFolder !== undefined &&
    isDirectory(path.dirname(absolutePath)) &&
    findLinkedPath({ filePath: typedFolder, repoRoot }) === undefined;

  // The folder as git spells it, before any check, so a folder typed in
  // another case is judged, excluded, and indexed as its neighbors are.
  const filePath =
    typedPath !== undefined && typedFolder !== undefined && isFolderOwn
      ? path.posix.join(
          spellForGit({
            filePath: typedFolder,
            index: readGitIndex(repoRoot),
            readName: (givenPath) =>
              readRealName({ filePath: givenPath, repoRoot }),
            repoRoot,
          }),
          path.posix.basename(typedPath)
        )
      : typedPath;

  if (filePath === undefined || !isRecordName({ bundleDirs, filePath })) {
    return {
      isOk: false,
      reason: `${recordPath} isn't a record path in ${bundleDirs.join(", ")}.`,
    };
  }

  if (matchExcluded(excludeGlobs)(filePath)) {
    return {
      isOk: false,
      reason: `${recordPath} is excluded by \`okf.exclude\`.`,
    };
  }

  if (doesPathExist(absolutePath)) {
    return { isOk: false, reason: `${recordPath} already exists.` };
  }

  const folder = path.posix.dirname(filePath);

  if (!isDirectory(path.dirname(absolutePath))) {
    return {
      isOk: false,
      reason: `No folder at ${folder}; make it before writing a record there.`,
    };
  }

  return isFolderOwn
    ? { isOk: true, value: filePath }
    : {
        isOk: false,
        reason: `The folder ${folder} is a symlink, or inside one, to ${realpathSync(path.dirname(absolutePath))}. ${LINK_EXPLANATION}`,
      };
}

/** Whether anything is at a path, a broken symlink included. */
function doesPathExist(absolutePath: string): boolean {
  try {
    lstatSync(absolutePath);

    return true;
  } catch {
    return false;
  }
}
