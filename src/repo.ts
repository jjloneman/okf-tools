/*
 * The CLI's file-system work on records, always relative to the repo root:
 * resolving bundles and paths, loading candidates, and reading and writing
 * records.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Outcome } from "./outcome.ts";
import type { Candidate, RecordEdit } from "./records.ts";

import { findEditProblem } from "./frontmatter/edit.ts";
import {
  findFrontmatterProblem,
  getRecordState,
  readRecordSummary,
} from "./frontmatter/read.ts";
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
       * What the path turned out to be: a file whose frontmatter isn't valid
       * YAML, one with no frontmatter block, or one that can't be read.
       *
       * @example "unreadable"
       */
      kind: "invalid" | "notRecord" | "unreadable";

      /**
       * Why it isn't a record, naming the path.
       *
       * @example "docs/decisions/a.md can't be read: EACCES: permission denied"
       */
      reason: string;
    };

/** The records read from a set of paths, and the ones left out. */
export type LoadedRecords = {
  /**
   * The records, in the order their paths were given.
   *
   * @example `[{ filePath: "docs/decisions/a.md", state: "unverified", … }]`
   */
  candidates: Candidate[];

  /**
   * The records left out because they can't be read, aren't valid YAML, or
   * have a layout the edits refuse.
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

/** The file every bundle may hold that isn't a record. */
const INDEX_FILE = "index.md";

/**
 * Read a record from disk, judged against `verifiedBy`'s sign-off.
 *
 * @returns the candidate, or why it isn't one: it can't be read, its
 * frontmatter isn't valid YAML or is in a layout the edits refuse, or it has
 * none.
 */
export function loadCandidate(params: {
  filePath: string;
  repoRoot: string;
  verifiedBy: string;
}): LoadedRecord {
  const { filePath, repoRoot, verifiedBy } = params;
  let text: string;

  try {
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

  return editProblem !== undefined
    ? { kind: "invalid", reason: `${filePath}: ${editProblem}` }
    : {
        candidate: {
          filePath,
          state: getRecordState(summary),
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
 * - Only files count: `index.md`, a folder named `*.md`, and files without
 *   frontmatter aren't records, so they're left out.
 *
 * - A record that can't be read, isn't valid YAML, or has a layout the edits
 *   refuse is left out too, but reported, so the caller can say so rather
 *   than skip it unseen.
 */
export function loadCandidates(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
  verifiedBy: string;
}): LoadedRecords {
  const { bundleDirs, repoRoot } = params;

  const filePaths = bundleDirs.flatMap((bundleDir) =>
    readdirSync(path.join(repoRoot, bundleDir))
      .sort()
      .map((name) => path.posix.join(bundleDir, name))
  );

  return loadCandidatesAt({ ...params, filePaths });
}

/**
 * Read the records among the given paths, in the given order.
 *
 * - Keeps only `.md` files directly inside a bundle, other than `index.md`,
 *   that have a frontmatter block; anything else is skipped.
 *
 * - A record that can't be read, isn't valid YAML, or has a layout the edits
 *   refuse is reported in `skipped` instead.
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

/** Read a record's text as it is on disk now. */
export function readRecordText(params: {
  filePath: string;
  repoRoot: string;
}): string {
  const { filePath, repoRoot } = params;

  return readFileSync(path.join(repoRoot, filePath), "utf8");
}

/**
 * Turn absolute bundle directories into paths from the repo root.
 *
 * - The same directory given twice is kept once.
 *
 * - Fails on the first directory that is missing or outside the repo.
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

    if (!resolved.includes(relativeDir)) {
      resolved.push(relativeDir);
    }
  }

  return { isOk: true, value: resolved };
}

/**
 * Turn record paths from the command line into paths from the repo root.
 *
 * - Each must be an existing `.md` file directly inside one of the bundles,
 *   and not its `index.md`.
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
    const filePath = toRepoPath({ absolutePath, repoRoot });

    if (filePath === undefined || !isRecordName({ bundleDirs, filePath })) {
      return {
        isOk: false,
        reason: `${recordPath} isn't a record in ${bundleDirs.join(", ")}.`,
      };
    }

    if (!isFile(absolutePath)) {
      return { isOk: false, reason: `No record at ${recordPath}.` };
    }

    if (!resolved.includes(filePath)) {
      resolved.push(filePath);
    }
  }

  return { isOk: true, value: resolved };
}

/**
 * Write each record's new text to disk, all or nothing.
 *
 * - When a write fails partway, the records already written get their
 *   original text back, so no record is left half-verified.
 */
export function writeRecords(params: {
  edits: readonly RecordEdit[];
  repoRoot: string;
}): Outcome<undefined> {
  const { edits, repoRoot } = params;
  const written: RecordEdit[] = [];

  for (const edit of edits) {
    try {
      writeFileSync(path.join(repoRoot, edit.filePath), edit.text);
    } catch (error) {
      written.forEach(({ filePath, originalText }) => {
        writeFileSync(path.join(repoRoot, filePath), originalText);
      });

      return {
        isOk: false,
        reason: `Couldn't write ${edit.filePath}: ${describeError(error)}\nNo files changed.`,
      };
    }

    written.push(edit);
  }

  return { isOk: true, value: undefined };
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
 * a bundle, other than `index.md`.
 */
function isRecordName(params: {
  bundleDirs: readonly string[];
  filePath: string;
}): boolean {
  const { bundleDirs, filePath } = params;

  return (
    bundleDirs.includes(path.posix.dirname(filePath)) &&
    filePath.endsWith(".md") &&
    path.posix.basename(filePath) !== INDEX_FILE
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

  // The repo root itself is `.`, which git and `path.posix` both read as is.
  return relativePath === ""
    ? "."
    : relativePath.split(path.sep).join(path.posix.sep);
}
