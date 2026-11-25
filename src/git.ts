/*
 * Every git call the CLI makes, always relative to the repo root.
 *
 * - Every git call ignores stdin, since the prompts own the terminal, and
 *   pipes stdout and stderr, so git's messages never print over the prompts
 *   and a failure carries them on its error.
 */
import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

import { execFileSync } from "node:child_process";

import type { Outcome } from "./outcome.ts";

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
   * The working tree's share of `paths` that `HEAD` already has: what
   * `git status` reported, files new to the repo left out, each as its
   * `toPathKey`.
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

/**
 * The states in which git refuses a commit of only some files, by the ref
 * each one leaves.
 */
const PARTIAL_COMMIT_BLOCKERS = [
  { name: "A merge", ref: "MERGE_HEAD" },
  { name: "A cherry-pick", ref: "CHERRY_PICK_HEAD" },
] as const;

/** The branch a record counts as changed against when `origin/HEAD` is unset. */
const FALLBACK_BASE_REF = "main";

/** The options every git call shares. */
const GIT_EXEC_OPTIONS = {
  encoding: "utf8",

  // Unbounded, since Node's 1 MiB default fails a listing of a large repo.
  maxBuffer: Infinity,
  stdio: ["ignore", "pipe", "pipe"],
} satisfies ExecFileSyncOptionsWithStringEncoding;

/** The remote default branch tried when `origin/HEAD` isn't set. */
const REMOTE_MAIN = "origin/main";

/** A porcelain status entry marked as a rename or copy, in either column. */
const RENAME_OR_COPY = /^(?:[CR].|.[CR])/u;

/**
 * A `git status --porcelain` entry for a file `HEAD` doesn't have: untracked,
 * added to the index, or added with intent to add.
 */
const NEW_FILE = /^(?:\?\?|A.|.A)/u;

/** The hash a commit reports when git can't read it back. */
const UNKNOWN_HASH = "(hash unknown)";

/**
 * Say why git would refuse to commit just these files, before they're
 * written, so a refusal leaves them as they were.
 *
 * - A merge or cherry-pick in progress refuses a commit of only some files.
 *
 * - `git add --dry-run` refuses an ignored path, or one beyond a symlink,
 *   without staging anything.
 */
export function checkCommittable(params: {
  filePaths: readonly string[];
  repoRoot: string;
}): Outcome<undefined> {
  const { filePaths, repoRoot } = params;

  const blocker = PARTIAL_COMMIT_BLOCKERS.find(
    ({ ref }) =>
      tryGit({ args: ["rev-parse", "--quiet", "--verify", ref], repoRoot }) !==
      undefined
  );

  if (blocker !== undefined) {
    return {
      isOk: false,
      reason: `${blocker.name} is in progress, and git won't commit only some files during one; finish or abort it first.`,
    };
  }

  try {
    runGit({ args: ["add", "--dry-run", "--", ...filePaths], repoRoot });
  } catch (error) {
    return {
      isOk: false,
      reason: `git won't stage ${filePaths.join(", ")}: ${describeGitFailure(error)}`,
    };
  }

  return { isOk: true, value: undefined };
}

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

  // The commit is made by now, so a hash git can't read isn't a failure.
  return {
    hash:
      tryGit({ args: ["rev-parse", "--short", "HEAD"], repoRoot }) ??
      UNKNOWN_HASH,
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

/**
 * List the changed files under the bundles, from the branch diff and the
 * working tree.
 *
 * - A branch diff that fails only narrows the list; a `git status` that
 *   fails is an error, since the working tree is what most runs sign.
 */
export function listChangedPaths(params: {
  bundleDirs: readonly string[];
  repoRoot: string;
}): Outcome<ChangedPaths> {
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

  const status = readStatusPaths({ pathspecs: bundleDirs, repoRoot });

  if (!status.isOk) {
    return status;
  }

  status.value.forEach(({ filePath }) => paths.add(filePath));

  const statusPaths = new Set(
    status.value
      .filter(({ isNew }) => !isNew)
      .map(({ filePath }) => toPathKey(filePath))
  );

  return { isOk: true, value: { hasBranchDiff, paths, statusPaths } };
}

/**
 * List which of the files git sees uncommitted changes to, in one `git status`
 * call.
 *
 * - Each is returned as the caller spelled it, matched to git's spelling by
 *   `toPathKey`.
 *
 * - `shouldSkipNew` leaves out files `HEAD` doesn't have, whose every line is
 *   new, for a warning about changes besides the sign-off.
 */
export function listDirtyPaths(params: {
  filePaths: readonly string[];
  repoRoot: string;
  shouldSkipNew?: boolean;
}): Outcome<string[]> {
  const { filePaths, repoRoot, shouldSkipNew = false } = params;
  const status = readStatusPaths({ pathspecs: filePaths, repoRoot });

  if (!status.isOk) {
    return status;
  }

  const dirtyPaths = new Set(
    status.value
      .filter(({ isNew }) => !shouldSkipNew || !isNew)
      .map(({ filePath }) => toPathKey(filePath))
  );

  return {
    isOk: true,
    value: filePaths.filter((filePath) => dirtyPaths.has(toPathKey(filePath))),
  };
}

/**
 * List the folders under a bundle that git ignores, each as its `toPathKey`,
 * without a trailing `/`.
 *
 * - Only whole folders, such as `node_modules`, or an untracked one holding
 *   only ignored files, so a walk can skip them; a file git ignores in a
 *   folder it doesn't isn't listed.
 */
export function listIgnoredFolders(params: {
  bundleDir: string;
  repoRoot: string;
}): Outcome<Set<string>> {
  const { bundleDir, repoRoot } = params;
  let output: string;

  try {
    output = runGit({
      args: [
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "--",
        bundleDir,
      ],
      repoRoot,
    });
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't list the folders git ignores in ${bundleDir}: ${describeGitFailure(error)}`,
    };
  }

  return {
    isOk: true,
    value: new Set(
      output
        .split("\0")
        .filter((ignoredPath) => ignoredPath.endsWith("/"))
        .map((ignoredPath) => toPathKey(ignoredPath.slice(0, -1)))
    ),
  };
}

/**
 * List every path git's index holds, spelled as the index does, in one
 * `git ls-files` call; empty when git can't be asked.
 *
 * - Not trimmed, since a file name may start with a space.
 */
export function listIndexPaths(repoRoot: string): string[] {
  try {
    return runGit({ args: ["ls-files", "-z"], repoRoot })
      .split("\0")
      .filter(Boolean);
  } catch {
    return [];
  }
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
 * Read a file as `HEAD` holds it.
 *
 * - `git ls-tree` prints nothing for a path `HEAD` doesn't have, so a record
 *   never committed reads as `undefined`, not as a failure.
 */
export function readCommittedText(params: {
  filePath: string;
  repoRoot: string;
}): Outcome<string | undefined> {
  const { filePath, repoRoot } = params;

  try {
    const entry = runGit({
      args: ["ls-tree", "-z", "HEAD", "--", filePath],
      repoRoot,
    });

    return {
      isOk: true,
      value:
        entry === ""
          ? undefined
          : runGit({ args: ["show", `HEAD:${filePath}`], repoRoot }),
    };
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read ${filePath} at HEAD: ${describeGitFailure(error)}`,
    };
  }
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
 * The key two spellings of one path from the repo root share, for comparing
 * a name from the disk with one git printed.
 *
 * - NFC, since git on macOS composes the names it prints
 *   (`core.precomposeUnicode`), while the disk keeps the form the file was
 *   created with, which some tools write decomposed.
 */
export function toPathKey(filePath: string): string {
  return filePath.normalize("NFC");
}

/** Say why a git call failed: what it printed to stderr, else its error. */
function describeGitFailure(error: unknown): string {
  const stderr = readGitFailure(error).stderr?.trim();

  return stderr === undefined || stderr === "" ? describeError(error) : stderr;
}

/**
 * List the paths `git status` reports under the pathspecs, untracked files
 * included, each marked when `HEAD` doesn't have it.
 *
 * - A rename or copy, marked in either status column, is followed by an extra
 *   entry holding its origin path, which is skipped.
 *
 * - A failure names the pathspecs, so the person knows which files it was
 *   reading.
 */
function readStatusPaths(params: {
  pathspecs: readonly string[];
  repoRoot: string;
}): Outcome<{ filePath: string; isNew: boolean }[]> {
  const { pathspecs, repoRoot } = params;
  const statusPaths: { filePath: string; isNew: boolean }[] = [];
  let output: string;
  let isOriginPath = false;

  try {
    output = runGit({
      args: ["status", "--porcelain", "-z", "-uall", "--", ...pathspecs],
      repoRoot,
    });
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read git status for ${pathspecs.join(", ")}: ${describeGitFailure(error)}`,
    };
  }

  output
    .split("\0")
    .filter(Boolean)
    .forEach((entry) => {
      if (isOriginPath) {
        isOriginPath = false;

        return;
      }

      statusPaths.push({
        filePath: entry.slice(3),
        isNew: NEW_FILE.test(entry),
      });
      isOriginPath = RENAME_OR_COPY.test(entry);
    });

  return { isOk: true, value: statusPaths };
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
