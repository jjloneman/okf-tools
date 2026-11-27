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
   * Paths from the repo root, as git prints them, or as git's index spells
   * them when `listBundleChanges` returns them: the branch diff and the
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

/** A commit that changed a file. */
export type FileCommit = {
  /**
   * The commit's full hash.
   *
   * @example "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
   */
  hash: string;

  /**
   * The full hashes of the commit's parents, as committed, not as the path's
   * history simplifies them; empty for a root commit.
   *
   * @example `["0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6"]`
   */
  parents: string[];

  /**
   * The commit's hash as git abbreviates it.
   *
   * @example "1a2b3c4"
   */
  shortHash: string;
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

/** The changes git knows to a path, as `listPathChanges` reads them. */
export type PathChanges = {
  /**
   * The commits that changed the path or anything under it, newest first.
   *
   * @example `[{ committedAt: 1790000000, hash: "1a2b3c4d…", shortHash: "1a2b3c4" }]`
   */
  commits: PathCommit[];

  /**
   * Whether it has uncommitted changes, untracked files included.
   *
   * @example true
   */
  isDirty: boolean;
};

/**
 * The changes git knows to several paths, as `listPathChangesTogether` reads
 * them from one history with no merge.
 */
export type PathChangesTogether = {
  /**
   * The full hash of every commit that changed any of the paths, newest
   * first, which with no merge is also each one's place in the history: a
   * commit is an ancestor of every commit before it.
   *
   * @example `["1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"]`
   */
  order: string[];

  /**
   * Each path's changes, in the order given.
   *
   * @example `[{ changes: { commits: [], isDirty: true }, filePath: "a.md" }]`
   */
  paths: {
    /** The path's changes. @example `{ commits: [], isDirty: true }` */
    changes: PathChanges;

    /** The path, as given. @example "a.md" */
    filePath: string;
  }[];
};

/** A commit that changed a path, with when it was committed. */
export type PathCommit = {
  /**
   * When it was committed, in whole seconds since the epoch, which a rebase,
   * a cherry-pick, or an amend resets to when it ran, so a commit that
   * landed late reads as late.
   *
   * @example 1790000000
   */
  committedAt: number;

  /**
   * The commit's full hash.
   *
   * @example "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
   */
  hash: string;

  /**
   * The full hashes of the commit's parents, as committed; empty for a root
   * commit.
   *
   * @example `["0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6"]`
   */
  parents: string[];

  /**
   * The commit's hash as git abbreviates it.
   *
   * @example "1a2b3c4"
   */
  shortHash: string;
};

/** A path `git status` reports, as `readStatusPaths` reads it. */
type StatusPath = {
  /**
   * The path from the repo root, as git prints it.
   *
   * @example "docs/decisions/package-promise.md"
   */
  filePath: string;

  /**
   * Whether `HEAD` doesn't have it: untracked, or added.
   *
   * @example false
   */
  isNew: boolean;

  /**
   * The path a rename or copy came from, or `undefined` for anything else.
   *
   * @example "docs/decisions/old-name.md"
   */
  originPath: string | undefined;
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
 * Diff a file from a commit to the working tree, as plain text: no color, no
 * external diff driver, no text conversion, and never a "binary files differ"
 * line, whatever the config and `.gitattributes` say.
 */
export function diffSince(params: {
  commit: string;
  filePath: string;
  repoRoot: string;
}): Outcome<string> {
  const { commit, filePath, repoRoot } = params;

  try {
    return {
      isOk: true,
      value: runGit({
        args: [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "--text",
          commit,
          "--",
          filePath,
        ],
        repoRoot,
      }),
    };
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't diff ${filePath} since ${commit}: ${describeGitFailure(error)}`,
    };
  }
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
 * Whether the repo is a shallow clone, whose oldest commits are listed without
 * their parents; `false` when git can't say.
 */
export function isShallowRepo(repoRoot: string): boolean {
  return (
    tryGit({ args: ["rev-parse", "--is-shallow-repository"], repoRoot }) ===
    "true"
  );
}

/**
 * List the full hashes of the commits `HEAD` has that a base commit doesn't,
 * or none when git can't say.
 */
export function listBranchCommits(params: {
  base: string;
  repoRoot: string;
}): string[] {
  const { base, repoRoot } = params;

  return (tryGit({ args: ["rev-list", `${base}..HEAD`], repoRoot }) ?? "")
    .split("\n")
    .filter(Boolean);
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
 * List the commits that changed a file, newest first, under the name it has
 * now, each with its parents.
 *
 * - History from before a rename isn't followed, even under `log.follow`.
 *
 * - `--no-show-signature` keeps `log.showSignature`'s gpg lines out of the
 *   listing, which would read as hashes.
 */
export function listFileCommits(params: {
  filePath: string;
  repoRoot: string;
}): Outcome<FileCommit[]> {
  const { filePath, repoRoot } = params;
  let output: string;

  try {
    output = runGit({
      args: [
        "log",
        "--no-follow",
        "--no-show-signature",
        "--format=%H %h %P",
        "--",
        filePath,
      ],
      repoRoot,
    });
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read the history of ${filePath}: ${describeGitFailure(error)}`,
    };
  }

  return {
    isOk: true,
    value: output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        // `%P` is empty for a root commit, but the space before it stays.
        const hashEnd = line.indexOf(" ");
        const shortHashEnd = line.indexOf(" ", hashEnd + 1);

        return {
          hash: line.slice(0, hashEnd),
          parents: line
            .slice(shortHashEnd + 1)
            .split(" ")
            .filter(Boolean),
          shortHash: line.slice(hashEnd + 1, shortHashEnd),
        };
      }),
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
 * List the changes git knows to a file or anything in a folder: its commits,
 * newest first, each with when it was committed, and whether it has
 * uncommitted changes, untracked files included.
 *
 * - `--no-follow`, since `log.follow` would refuse a folder, and
 *   `--no-show-signature`, as `listFileCommits` says.
 *
 * - Without `hasHead`, the branch has no commits for `git log` to read.
 */
export function listPathChanges(params: {
  filePath: string;
  hasHead: boolean;
  repoRoot: string;
}): Outcome<PathChanges> {
  const { filePath, hasHead, repoRoot } = params;
  const status = readStatusPaths({ pathspecs: [filePath], repoRoot });

  if (!status.isOk) {
    return status;
  }

  let output = "";

  try {
    if (hasHead) {
      output = runGit({
        args: [
          "log",
          "--no-follow",
          "--no-show-signature",
          "--format=%H %h %ct %P",
          "--",
          filePath,
        ],
        repoRoot,
      });
    }
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read the history of ${filePath}: ${describeGitFailure(error)}`,
    };
  }

  return {
    isOk: true,
    value: {
      commits: output.split("\n").filter(Boolean).map(readPathCommit),
      isDirty: status.value.length > 0,
    },
  };
}

/**
 * List the changes git knows to each of several paths, as `listPathChanges`
 * would for each one, in one `git status` and one `git log` over them all.
 *
 * - A commit counts for a path when `--name-only` names the path or a file
 *   under it: `--no-renames`, so a rename names the path it left too, and
 *   `--root`, so the first commit names its files whatever `log.showRoot`
 *   says.
 *
 * - A rename's or copy's origin counts as uncommitted, since `git status`
 *   asked about that path alone reports it deleted, or modified for a copy,
 *   whose origin git finds only among modified files.
 *
 * - A history with a merge fails, since git simplifies history at a merge by
 *   all the pathspecs at once, so it may follow a parent that one path's own
 *   `git log` wouldn't.
 *
 * - Names are compared by `toPathKey`, since git on macOS composes the
 *   pathspecs and the names it prints alike; elsewhere a spelling git doesn't
 *   match names no file on disk, so the source rules skip it.
 *
 * @returns each path's changes, in the order given, and the commits'
 *   order.
 */
export function listPathChangesTogether(params: {
  filePaths: readonly string[];
  hasHead: boolean;
  repoRoot: string;
}): Outcome<PathChangesTogether> {
  const { filePaths, hasHead, repoRoot } = params;

  if (
    hasHead &&
    tryGit({
      args: ["rev-list", "--merges", "--max-count=1", "HEAD"],
      repoRoot,
    }) !== ""
  ) {
    return {
      isOk: false,
      reason: "Couldn't rule out a merge in the history.",
    };
  }

  const status = readStatusPaths({ pathspecs: filePaths, repoRoot });

  if (!status.isOk) {
    return status;
  }

  let output = "";

  try {
    if (hasHead) {
      output = runGit({
        args: [
          "log",
          "--no-follow",
          "--no-renames",
          "--no-show-signature",
          "--root",
          "--name-only",
          "-z",
          "--format=%x00%H %h %ct %P",
          "--",
          ...filePaths,
        ],
        repoRoot,
      });
    }
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read the history of ${filePaths.join(", ")}: ${describeGitFailure(error)}`,
    };
  }

  const commits = readNamedCommits(output);
  const dirtyKeys = status.value
    .flatMap(({ filePath, originPath }) =>
      originPath === undefined ? [filePath] : [filePath, originPath]
    )
    .map(toPathKey);

  return {
    isOk: true,
    value: {
      order: commits.map(({ commit }) => commit.hash),
      paths: filePaths.map((filePath) => {
        const key = toPathKey(filePath);
        const isUnder = (changedKey: string): boolean =>
          changedKey === key || changedKey.startsWith(`${key}/`);

        return {
          changes: {
            commits: commits
              .filter(({ pathKeys }) => pathKeys.some(isUnder))
              .map(({ commit }) => commit),
            isDirty: dirtyKeys.some(isUnder),
          },
          filePath,
        };
      }),
    },
  };
}

/**
 * List which of some commits aren't in the history of any of others, being
 * neither one of them nor an ancestor of one, in one `git rev-list`.
 *
 * - The hashes go in on stdin, so no list of them outgrows a command line.
 *
 * - Git walks only what the commits reach and the others don't, so it reads
 *   about as many commits as landed since the others.
 *
 * @returns the commits given that none of the others reach, by full hash.
 */
export function listUnreachedCommits(params: {
  /** The full hashes of the commits to sort out. @example `["1a2b3c4d…"]` */
  commits: readonly string[];

  /** The full hashes to reach them from. @example `["5e6f7a8b…"]` */
  from: readonly string[];

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;
}): Outcome<Set<string>> {
  const { commits, from, repoRoot } = params;
  const wanted = new Set(commits);

  try {
    const output = runGit({
      args: ["rev-list", "--stdin"],
      input: [...commits, ...from.map((hash) => `^${hash}`), ""].join("\n"),
      repoRoot,
    });

    return {
      isOk: true,
      value: new Set(output.split("\n").filter((hash) => wanted.has(hash))),
    };
  } catch (error) {
    return { isOk: false, reason: describeGitFailure(error) };
  }
}

/**
 * List every path in the working tree git would track: those in its index,
 * and untracked ones it doesn't ignore, in one `git ls-files` call; empty when
 * git can't be asked.
 *
 * - Not trimmed, since a file name may start with a space.
 */
export function listWorkingPaths(repoRoot: string): string[] {
  const listed = readWorkingPaths(repoRoot);

  return listed.isOk ? listed.value : [];
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
 * - A record never committed reads as `undefined`, not as a failure (see
 *   `readTextAt`).
 */
export function readCommittedText(params: {
  filePath: string;
  repoRoot: string;
}): Outcome<string | undefined> {
  return readTextAt({ ...params, ref: "HEAD" });
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
 * Read the commit a branch's changes are judged against: where `HEAD` left
 * the base ref, else `HEAD` itself.
 *
 * - `HEAD`, when the base can't be read, such as in a shallow clone or a
 *   repo with no remote, so uncommitted changes are still judged.
 *
 * @returns the commit and whether it's the branch's base, or `undefined` in
 * a repo with no commits.
 */
export function readMergeBase(
  repoRoot: string
): { commit: string; isBranchBase: boolean } | undefined {
  const mergeBase = tryGit({
    args: ["merge-base", readBaseRef(repoRoot), "HEAD"],
    repoRoot,
  });

  if (mergeBase !== undefined) {
    return { commit: mergeBase, isBranchBase: true };
  }

  const head = tryGit({
    args: ["rev-parse", "--verify", "--quiet", "HEAD"],
    repoRoot,
  });

  return head === undefined ? undefined : { commit: head, isBranchBase: false };
}

/**
 * Read a file as a commit holds it.
 *
 * - `git ls-tree` prints nothing for a path the commit doesn't have, so a
 *   file missing there reads as `undefined`, not as a failure.
 */
export function readTextAt(params: {
  filePath: string;
  ref: string;
  repoRoot: string;
}): Outcome<string | undefined> {
  const { filePath, ref, repoRoot } = params;

  try {
    const entry = runGit({
      args: ["ls-tree", "-z", ref, "--", filePath],
      repoRoot,
    });

    return {
      isOk: true,
      value:
        entry === ""
          ? undefined
          : runGit({ args: ["show", `${ref}:${filePath}`], repoRoot }),
    };
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't read ${filePath} at ${ref}: ${describeGitFailure(error)}`,
    };
  }
}

/**
 * Read several files as commits hold them, each named `<commit>:<path>`, in
 * one `git cat-file --batch`.
 *
 * - The names go in on stdin, one a line, so a path with a line break can't
 *   be named, and fails.
 *
 * - A file the commit doesn't have, or a commit that doesn't exist, such as
 *   the parent of a root commit, reads as `undefined`.
 *
 * - The output is read as bytes, since git gives each file's size in bytes.
 *
 * @returns each file's text, by its name.
 */
export function readTextsAt(params: {
  /**
   * The files to read, each as `<commit>:<path>`, the path from the repo
   * root.
   *
   * @example `["1a2b3c4d…:kb/a.md"]`
   */
  names: readonly string[];

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;
}): Outcome<Map<string, string | undefined>> {
  const { names, repoRoot } = params;

  if (names.some((name) => name.includes("\n"))) {
    return {
      isOk: false,
      reason: "git cat-file can't read a path with a line break",
    };
  }

  let output: Buffer;

  try {
    output = execFileSync("git", ["cat-file", "--batch"], {
      cwd: repoRoot,
      input: names.map((name) => `${name}\n`).join(""),
      maxBuffer: Infinity,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return { isOk: false, reason: describeGitFailure(error) };
  }

  const texts = new Map<string, string | undefined>();
  let position = 0;

  // Each answer is a header line, then, unless it says the file is missing,
  // the file's bytes and a line break.
  for (const name of names) {
    const headerEnd = output.indexOf("\n", position);
    const header = output.toString("utf8", position, headerEnd);

    position = headerEnd + 1;

    if (header.endsWith(" missing")) {
      texts.set(name, undefined);

      continue;
    }

    const size = Number(header.slice(header.lastIndexOf(" ") + 1));

    texts.set(name, output.toString("utf8", position, position + size));
    position += size + 1;
  }

  return { isOk: true, value: texts };
}

/**
 * List every path in the working tree git would track, as `listWorkingPaths`
 * does, each once, or say why git couldn't be asked.
 *
 * - Each once, since git lists a conflicted path once per stage.
 */
export function readWorkingPaths(repoRoot: string): Outcome<string[]> {
  try {
    const output = runGit({
      args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      repoRoot,
    });

    return {
      isOk: true,
      value: [...new Set(output.split("\0"))].filter(Boolean),
    };
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't list the files git tracks: ${describeGitFailure(error)}`,
    };
  }
}

/**
 * Run a git command from the repo root.
 *
 * @returns its standard output.
 */
export function runGit(params: {
  args: readonly string[];

  /** What to write to its stdin, closed without it. @example "1a2b3c4d…" */
  input?: string | undefined;
  repoRoot: string;
}): string {
  const { args, input, repoRoot } = params;

  // Literal, so a record named `[ab].md` names only itself, never `a.md`.
  return execFileSync("git", ["--literal-pathspecs", ...args], {
    ...GIT_EXEC_OPTIONS,
    cwd: repoRoot,
    ...(input === undefined
      ? {}
      : { input, stdio: ["pipe", "pipe", "pipe"] as const }),
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
 * Read `git log -z --name-only --format=%x00%H %h %ct %P` into each commit and
 * the keys of the paths it changed.
 *
 * - Each commit's line follows an empty field, and its first path follows a
 *   newline, which a name of its own may also start with.
 */
function readNamedCommits(
  output: string
): { commit: PathCommit; pathKeys: string[] }[] {
  const commits: { commit: PathCommit; pathKeys: string[] }[] = [];
  let isCommitLine = false;
  let isFirstPath = false;
  let pathKeys: string[] = [];

  for (const field of output.split("\0")) {
    if (field === "") {
      isCommitLine = true;
    } else if (isCommitLine) {
      pathKeys = [];
      commits.push({ commit: readPathCommit(field), pathKeys });
      isCommitLine = false;
      isFirstPath = true;
    } else {
      pathKeys.push(toPathKey(isFirstPath ? field.slice(1) : field));
      isFirstPath = false;
    }
  }

  return commits;
}

/**
 * Read a commit's `%H %h %ct %P` line, as `listPathChanges` and
 * `listPathChangesTogether` ask `git log` for it.
 */
function readPathCommit(line: string): PathCommit {
  const hashEnd = line.indexOf(" ");
  const shortHashEnd = line.indexOf(" ", hashEnd + 1);

  // `%P` is empty for a root commit, but the space before it stays.
  const timeEnd = line.indexOf(" ", shortHashEnd + 1);

  return {
    committedAt: Number(line.slice(shortHashEnd + 1, timeEnd)),
    hash: line.slice(0, hashEnd),
    parents: line
      .slice(timeEnd + 1)
      .split(" ")
      .filter(Boolean),
    shortHash: line.slice(hashEnd + 1, shortHashEnd),
  };
}

/**
 * List the paths `git status` reports under the pathspecs, untracked files
 * included, each marked when `HEAD` doesn't have it.
 *
 * - A rename or copy, marked in either status column, is followed by an extra
 *   entry holding its origin path, kept as the entry's `originPath`.
 *
 * - A failure names the pathspecs, so the person knows which files it was
 *   reading.
 */
function readStatusPaths(params: {
  pathspecs: readonly string[];
  repoRoot: string;
}): Outcome<StatusPath[]> {
  const { pathspecs, repoRoot } = params;
  const statusPaths: StatusPath[] = [];
  let output: string;
  let renamed: StatusPath | undefined;

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
      if (renamed !== undefined) {
        renamed.originPath = entry;
        renamed = undefined;

        return;
      }

      const statusPath: StatusPath = {
        filePath: entry.slice(3),
        isNew: NEW_FILE.test(entry),
        originPath: undefined,
      };

      statusPaths.push(statusPath);
      renamed = RENAME_OR_COPY.test(entry) ? statusPath : undefined;
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
