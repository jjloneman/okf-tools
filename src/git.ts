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

/** The branch a record counts as changed against when `origin/HEAD` is unset. */
const FALLBACK_BASE_REF = "main";

/** The options every git call shares. */
const GIT_EXEC_OPTIONS = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
} satisfies ExecFileSyncOptionsWithStringEncoding;

/** The remote default branch tried when `origin/HEAD` isn't set. */
const REMOTE_MAIN = "origin/main";

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
