/*
 * The CLI's git and file-system work, always relative to the repo root.
 *
 * - Every git call ignores stdin, since the prompts own the terminal, and
 *   pipes stdout and stderr, so git's messages never print over the prompts
 *   and a failure carries them on its error.
 */
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Candidate, RecordEdit } from "./records.ts";

import { getRecordState, readRecordSummary } from "./okf-frontmatter.ts";
import { describeError } from "./output.ts";

/** The changed files under the bundles, and whether the branch diff worked. */
export type ChangedPaths = {
  /**
   * Whether the diff against the base branch could be read.
   *
   * @example true
   */
  hasBranchDiff: boolean;

  /**
   * Paths from the repo root, as git prints them: the branch diff and the
   * working tree together.
   *
   * @example `new Set(["docs/decisions/package-promise.md"])`
   */
  paths: Set<string>;

  /**
   * The working tree's share of `paths`: what `git status` reported.
   *
   * @example `new Set(["docs/decisions/package-promise.md"])`
   */
  statusPaths: Set<string>;
};

/** The outcome of a commit: its short hash, or why it failed. */
export type CommitResult =
  | {
      /**
       * The new commit's short hash.
       *
       * @example "1a2b3c4"
       */
      hash: string;

      /**
       * Whether the commit was made; `true` here.
       *
       * @example true
       */
      isOk: true;
    }
  | {
      /**
       * Whether the commit was made; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * What git and its hooks printed.
       *
       * @example "eslint found 1 problem"
       */
      reason: string;
    };

/**
 * The fields a failed `execFileSync` call attaches to its error.
 *
 * - Each is `undefined` when the error doesn't carry it as a string.
 */
export type GitFailure = {
  /**
   * The system error code, set when git couldn't be started at all.
   *
   * @example "ENOENT"
   */
  code: string | undefined;

  /**
   * What git printed to stderr before it failed.
   *
   * @example "fatal: not a git repository (or any of the parent directories): .git"
   */
  stderr: string | undefined;

  /**
   * What git printed to stdout before it failed, such as a hook's output.
   *
   * @example "eslint found 1 problem"
   */
  stdout: string | undefined;
};

/** A value, or why there isn't one. */
export type Outcome<T> =
  | {
      /**
       * Whether there is a value; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not.
       *
       * @example "No bundle directory at /repo/docs/decisions."
       */
      reason: string;
    }
  | {
      /**
       * Whether there is a value; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The value.
       *
       * @example "/repo"
       */
      value: T;
    };

/** The branch a record counts as changed against when `origin/HEAD` is unset. */
const FALLBACK_BASE_REF = "main";

/** The options every git call shares. */
const GIT_EXEC_OPTIONS = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
} satisfies ExecFileSyncOptionsWithStringEncoding;

/** The remote default branch tried when `origin/HEAD` isn't set. */
const REMOTE_MAIN = "origin/main";

/** The file every bundle may hold that isn't a record. */
const INDEX_FILE = "index.md";

/** A porcelain status entry marked as a rename or copy, in either column. */
const RENAME_OR_COPY = /^(?:[CR].|.[CR])/u;

/**
 * Commit just the given files, so nothing else staged rides along.
 *
 * - When the commit fails (a hook rejects it), the files are unstaged again,
 *   so staging done before the run for those same files is lost; their
 *   content isn't.
 */
export function commitFiles(params: {
  filePaths: readonly string[];
  message: string;
  repoRoot: string;
}): CommitResult {
  const { filePaths, message, repoRoot } = params;

  try {
    runGit({ args: ["add", "--", ...filePaths], repoRoot });
    runGit({ args: ["commit", "-m", message, "--", ...filePaths], repoRoot });
  } catch (error) {
    const { stderr, stdout } = readGitFailure(error);

    /*
     * Unstaged again, so the next unrelated commit doesn't pick them up; the
     * edits stay in the working tree.
     *
     * - Best effort: whatever broke the commit can break this too, and the
     *   commit's own output is what the person needs to see.
     */
    try {
      runGit({ args: ["reset", "--quiet", "--", ...filePaths], repoRoot });
    } catch {
      // The reason below already says the commit failed.
    }

    // `join` reads a missing stream as an empty string.
    return { isOk: false, reason: [stdout, stderr].join("") };
  }

  return {
    hash: runGit({ args: ["rev-parse", "--short", "HEAD"], repoRoot }).trim(),
    isOk: true,
  };
}

/**
 * Find the root of the repo `cwd` is in.
 *
 * - Says why git failed rather than guessing: a missing `git` binary and a
 *   directory outside any repo are different problems.
 */
export function findRepoRoot(cwd: string): Outcome<string> {
  try {
    const value = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      ...GIT_EXEC_OPTIONS,
      cwd,
    }).trim();

    return { isOk: true, value };
  } catch (error) {
    const { code, stderr } = readGitFailure(error);

    return {
      isOk: false,
      reason:
        code === "ENOENT"
          ? "git isn't installed, or isn't on PATH."
          : `Couldn't find the repo root: ${stderr?.trim() ?? "git failed"}`,
    };
  }
}

/** List the changed files under the bundles, from the branch diff and the working tree. */
export function listChangedPaths(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
}): ChangedPaths {
  const { bundleDirs, repoRoot } = params;
  const paths = new Set<string>();
  const baseRef = readBaseRef(repoRoot);
  let hasBranchDiff = true;

  try {
    runGit({
      args: [
        "diff",
        "--name-only",
        "-z",
        `${baseRef}...HEAD`,
        "--",
        ...bundleDirs,
      ],
      repoRoot,
    })
      .split("\0")
      .filter(Boolean)
      .forEach((changedPath) => paths.add(changedPath));
  } catch {
    hasBranchDiff = false;
  }

  const statusPaths = new Set(
    readStatusPaths({ pathspecs: bundleDirs, repoRoot })
  );

  statusPaths.forEach((changedPath) => paths.add(changedPath));

  return { hasBranchDiff, paths, statusPaths };
}

/**
 * List which of the files git sees uncommitted changes to, in one `git status`
 * call.
 */
export function listDirtyPaths(params: {
  filePaths: readonly string[];
  repoRoot: string;
}): string[] {
  const { filePaths, repoRoot } = params;
  const dirtyPaths = new Set(
    readStatusPaths({ pathspecs: filePaths, repoRoot })
  );

  return filePaths.filter((filePath) => dirtyPaths.has(filePath));
}

/**
 * Read a record from disk, judged against `verifiedBy`'s sign-off.
 *
 * @returns the candidate, or `undefined` when it has no frontmatter block.
 */
export function loadCandidate(params: {
  filePath: string;
  repoRoot: string;
  verifiedBy: string;
}): Candidate | undefined {
  const { filePath, repoRoot, verifiedBy } = params;
  const text = readRecordText({ filePath, repoRoot });
  const summary = readRecordSummary({ text, verifiedBy });

  return summary === undefined
    ? undefined
    : { filePath, state: getRecordState(summary), summary, text };
}

/**
 * Read every record directly inside the bundles, in bundle order, then by
 * file name.
 *
 * - Only files count: `index.md`, a folder named `*.md`, and files without
 *   frontmatter aren't records, so they're left out.
 */
export function loadCandidates(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
  verifiedBy: string;
}): Candidate[] {
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
 */
export function loadCandidatesAt(params: {
  bundleDirs: readonly string[];
  filePaths: readonly string[];
  repoRoot: string;
  verifiedBy: string;
}): Candidate[] {
  const { bundleDirs, filePaths, repoRoot, verifiedBy } = params;

  return filePaths
    .filter((filePath) => isRecordPath({ bundleDirs, filePath, repoRoot }))
    .map((filePath) => loadCandidate({ filePath, repoRoot, verifiedBy }))
    .filter((candidate) => candidate !== undefined);
}

/**
 * Read the ref a record counts as changed against: the remote's default
 * branch (`origin/HEAD`), else `origin/main`, else the local `main`.
 *
 * - A remote-tracking ref first, not a local branch of the same name, which a
 *   fresh clone may not have and which may be behind.
 *
 * - `origin/HEAD` is set by `git clone` but not by `git remote add`, so
 *   `origin/main` covers a repo that gained its remote later.
 */
export function readBaseRef(repoRoot: string): string {
  const remoteHead = tryGit({
    args: ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repoRoot,
  });

  if (remoteHead !== undefined) {
    return remoteHead;
  }

  const hasRemoteMain =
    tryGit({
      args: ["rev-parse", "--verify", "--quiet", `refs/remotes/${REMOTE_MAIN}`],
      repoRoot,
    }) !== undefined;

  return hasRemoteMain ? REMOTE_MAIN : FALLBACK_BASE_REF;
}

/**
 * Read what a failed `execFileSync` call attached to its error.
 *
 * - A `catch` binding is `unknown`, and Node documents these fields rather
 *   than typing them on the error, so each is checked rather than cast.
 */
export function readGitFailure(error: unknown): GitFailure {
  const readField = (key: keyof GitFailure): string | undefined => {
    const value: unknown =
      error instanceof Error ? Reflect.get(error, key) : undefined;

    return typeof value === "string" ? value : undefined;
  };

  return {
    code: readField("code"),
    stderr: readField("stderr"),
    stdout: readField("stdout"),
  };
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
 * Run a git command from the repo root.
 *
 * @returns its standard output.
 */
export function runGit(params: {
  args: readonly string[];
  repoRoot: string;
}): string {
  const { args, repoRoot } = params;

  // Literal, so a record named `[ab].md` names only itself, never `a.md`.
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    ...GIT_EXEC_OPTIONS,
    cwd: repoRoot,
  });
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
 * List the paths `git status` reports under the pathspecs, untracked files
 * included.
 *
 * - A rename or copy, marked in either status column, is followed by an extra
 *   entry holding its origin path, which is skipped.
 */
function readStatusPaths(params: {
  pathspecs: readonly string[];
  repoRoot: string;
}): string[] {
  const { pathspecs, repoRoot } = params;
  const statusPaths: string[] = [];
  let isOriginPath = false;

  runGit({
    args: ["status", "--porcelain", "-z", "-uall", "--", ...pathspecs],
    repoRoot,
  })
    .split("\0")
    .filter(Boolean)
    .forEach((entry) => {
      if (isOriginPath) {
        isOriginPath = false;

        return;
      }

      statusPaths.push(entry.slice(3));
      isOriginPath = RENAME_OR_COPY.test(entry);
    });

  return statusPaths;
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

/**
 * Run a git command that may fail.
 *
 * @returns its trimmed output, or `undefined` when it failed.
 */
function tryGit(params: Parameters<typeof runGit>[0]): string | undefined {
  try {
    return runGit(params).trim();
  } catch {
    return undefined;
  }
}
