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
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { RecordState, RecordTimes } from "./frontmatter/read.ts";
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
import { isKnownToGit, toPathKey } from "./git.ts";
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

/** Why okf-verify edits a file only at its own path. */
const LINK_EXPLANATION =
  "okf-verify edits records only at their own path, since git commits a symlink, not the file it points to.";

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
 * Read a record from disk, judged against `verifiedBy`'s sign-off.
 *
 * - A sign-off whose `verified.at` is ahead of the clock counts as `changed`,
 *   so the record is offered again and a fresh sign-off renews it.
 *
 * @returns the candidate, or why it isn't one: it can't be read, it's
 * reached through a symlink, its frontmatter block is a near miss, such as
 * one with no closing fence, its frontmatter isn't valid YAML or is in a
 * layout the edits refuse, its `generated.at` is ahead of the clock, or it
 * has no frontmatter.
 */
export function loadCandidate(params: {
  filePath: string;
  repoRoot: string;
  verifiedBy: string;
}): LoadedRecord {
  const { filePath, repoRoot, verifiedBy } = params;
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
    : {
        candidate: {
          filePath,
          state: readListedState(summary),
          summary,
          text,
        },
        kind: "record",
      };
}

/**
 * Read every record directly inside the bundles, in bundle order, then by
 * file name.
 *
 * - Only files count: `index.md`, `log.md`, a folder named `*.md`, and files
 *   without frontmatter aren't records, so they're left out.
 *
 * - A record that can't be read, is reached through a symlink, has a
 *   near-miss frontmatter block, isn't valid YAML, has a layout the edits
 *   refuse, or was generated ahead of the clock is left out too, but
 *   reported, so the caller can say so rather than skip it unseen.
 *
 * - A bundle that can't be listed fails the whole load, naming the bundle,
 *   since its records can't even be counted as skipped.
 */
export function loadCandidates(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
  verifiedBy: string;
}): Outcome<LoadedRecords> {
  const { bundleDirs, repoRoot } = params;
  const filePaths: string[] = [];

  for (const bundleDir of bundleDirs) {
    let names: string[];

    try {
      names = readdirSync(path.join(repoRoot, bundleDir));
    } catch (error) {
      return {
        isOk: false,
        reason: `${bundleDir} can't be listed: ${describeError(error)}`,
      };
    }

    filePaths.push(
      ...names.sort().map((name) => path.posix.join(bundleDir, name))
    );
  }

  return { isOk: true, value: loadCandidatesAt({ ...params, filePaths }) };
}

/**
 * Read the records among the given paths, in the given order.
 *
 * - Keeps only `.md` files directly inside a bundle, other than `index.md`
 *   and `log.md`, that have a frontmatter block; anything else is skipped.
 *
 * - A record that can't be read, is reached through a symlink, has a
 *   near-miss frontmatter block, isn't valid YAML, has a layout the edits
 *   refuse, or was generated ahead of the clock is reported in `skipped`
 *   instead.
 */
export function loadCandidatesAt(params: {
  bundleDirs: readonly string[];
  filePaths: readonly string[];
  repoRoot: string;
  verifiedBy: string;
}): LoadedRecords {
  const { bundleDirs, filePaths, repoRoot, verifiedBy } = params;
  const loaded: LoadedRecords = { candidates: [], skipped: [] };

  for (const filePath of filePaths) {
    if (!isRecordPath({ bundleDirs, filePath, repoRoot })) {
      continue;
    }

    const record = loadCandidate({ filePath, repoRoot, verifiedBy });

    if (record.kind === "record") {
      loaded.candidates.push(record.candidate);
    } else if (record.kind !== "notRecord") {
      loaded.skipped.push({ filePath, reason: record.reason });
    }
  }

  return loaded;
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

    const bundleDir = spellForGit({ filePath: relativeDir, repoRoot });

    if (!includesPath({ filePath: bundleDir, filePaths: resolved })) {
      resolved.push(bundleDir);
    }
  }

  return { isOk: true, value: resolved };
}

/**
 * Turn record paths from the command line into paths from the repo root.
 *
 * - Each must be an existing `.md` file directly inside one of the bundles,
 *   and not its `index.md` or `log.md`.
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
  recordPaths: readonly string[];
  repoRoot: string;
}): Outcome<string[]> {
  const { bundleDirs, cwd, recordPaths, repoRoot } = params;
  const resolved: string[] = [];

  for (const recordPath of recordPaths) {
    const absolutePath = path.resolve(cwd, recordPath);
    const typedPath = toRepoPath({ absolutePath, repoRoot });
    const filePath =
      typedPath !== undefined &&
      isFile(absolutePath) &&
      findLinkedPath({ filePath: typedPath, repoRoot }) === undefined
        ? spellForGit({ filePath: typedPath, repoRoot })
        : typedPath;

    if (filePath === undefined || !isRecordName({ bundleDirs, filePath })) {
      return {
        isOk: false,
        reason: `${recordPath} isn't a record in ${bundleDirs.join(", ")}.`,
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

/** Whether a path exists and is a file. */
function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}

/**
 * Whether a path from the repo root names a record: an `.md` directly inside
 * a bundle, other than `index.md` and `log.md`.
 */
function isRecordName(params: {
  bundleDirs: readonly string[];
  filePath: string;
}): boolean {
  const { bundleDirs, filePath } = params;

  const folderKey = toPathKey(path.posix.dirname(filePath));

  // A name git printed can differ from the disk's in Unicode form.
  return (
    bundleDirs.some((bundleDir) => toPathKey(bundleDir) === folderKey) &&
    filePath.endsWith(".md") &&
    !RESERVED_FILES.has(path.posix.basename(filePath))
  );
}

/** Whether a path from the repo root names a record, and it's a file on disk. */
function isRecordPath(params: {
  bundleDirs: readonly string[];
  filePath: string;
  repoRoot: string;
}): boolean {
  const { filePath, repoRoot } = params;

  return isRecordName(params) && isFile(path.join(repoRoot, filePath));
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
 * paths byte for byte: as given when git's index holds that spelling, else as
 * the disk spells it, in case and Unicode form.
 *
 * - The index wins, since after a rename only in case it can differ from the
 *   disk, and git matches the index.
 *
 * - The path must exist and not be reached through a symlink, so resolving
 *   it changes only its spelling, never the file it names.
 */
function spellForGit(params: { filePath: string; repoRoot: string }): string {
  const { filePath, repoRoot } = params;

  if (isKnownToGit({ filePath, repoRoot })) {
    return filePath;
  }

  return toPosixPath(
    path.relative(
      realpathSync.native(repoRoot),
      realpathSync.native(path.join(repoRoot, filePath))
    )
  );
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
