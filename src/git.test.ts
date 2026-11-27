import { DateTime } from "luxon";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { DISK_SPELLING, useTestRepo } from "#test/repo";

import {
  checkCommittable,
  commitFiles,
  findRepoRoot,
  listBranchCommits,
  listChangedPaths,
  listDirtyPaths,
  listIndexPaths,
  listPathChanges,
  listPathChangesTogether,
  listUnreachedCommits,
  listWorkingPaths,
  readBaseRef,
  readCommittedText,
  readGitFailure,
  readWorkingPaths,
} from "./git.ts";

const { repo } = useTestRepo();

describe("checkCommittable", () => {
  test("accepts a tracked and an untracked file, staging neither", () => {
    // Given - a committed file changed, and a new one
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add a");
    repo.write("docs/a.md", "a2\n");
    repo.write("docs/b.md", "b\n");

    // When - asking whether both can be committed
    const result = checkCommittable({
      filePaths: ["docs/a.md", "docs/b.md"],
      repoRoot: repo.root,
    });

    // Then - they can, and nothing is staged
    expect(result).toStrictEqual({ isOk: true, value: undefined });
    expect(repo.git("diff", "--cached", "--name-only")).toBe("");
  });

  test.each([
    { description: "a merge", name: "A merge", ref: "MERGE_HEAD" },
    {
      description: "a cherry-pick",
      name: "A cherry-pick",
      ref: "CHERRY_PICK_HEAD",
    },
  ])("refuses during $description", ({ name, ref }) => {
    // Given - the ref git leaves while one is in progress
    repo.write("docs/a.md", "a\n");
    repo.write(`.git/${ref}`, repo.git("rev-parse", "HEAD"));

    // When - asking whether a file can be committed alone
    const result = checkCommittable({
      filePaths: ["docs/a.md"],
      repoRoot: repo.root,
    });

    // Then - refused, naming what's in progress
    expect(result).toStrictEqual({
      isOk: false,
      reason: `${name} is in progress, and git won't commit only some files during one; finish or abort it first.`,
    });
  });

  test("refuses an ignored file, with git's reason", () => {
    // Given - a file git ignores
    repo.write(".gitignore", "docs/a.md\n");
    repo.write("docs/a.md", "a\n");

    // When - asking whether it can be committed
    const result = checkCommittable({
      filePaths: ["docs/a.md"],
      repoRoot: repo.root,
    });

    // Then - refused, naming it
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^git won't stage docs\/a\.md: The following paths are ignored/u
      ) as unknown,
    });
  });
});

describe("commitFiles", () => {
  test("commits only the named files", () => {
    // Given - two changed files
    repo.write("docs/a.md", "a\n");
    repo.write("docs/b.md", "b\n");

    // When - committing one
    const result = commitFiles({
      filePaths: ["docs/a.md"],
      message: "docs(docs): 📝 verify a",
      repoRoot: repo.root,
    });

    // Then - a commit holding only it
    expect(result).toStrictEqual({
      hash: expect.stringMatching(/^[0-9a-f]+$/u) as unknown,
      isOk: true,
    });
    expect(repo.git("show", "--name-only", "--format=%s", "HEAD")).toBe(
      "docs(docs): 📝 verify a\n\ndocs/a.md\n"
    );
    expect(repo.git("status", "--porcelain")).toBe("?? docs/b.md\n");
  });

  test("commits a record whose name holds glob characters, and only it", () => {
    // Given - a record named [ab].md, and an unrelated edit to a.md
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add a");
    repo.write("docs/[ab].md", "glob\n");
    repo.write("docs/a.md", "unrelated edit\n");

    // When - committing the glob-named record
    commitFiles({
      filePaths: ["docs/[ab].md"],
      message: "x",
      repoRoot: repo.root,
    });

    // Then - it alone; a.md's edit stays uncommitted
    expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
      "docs/[ab].md\n"
    );
    expect(repo.git("status", "--porcelain")).toBe(" M docs/a.md\n");
  });

  test("keeps the hook's output when unstaging fails too", () => {
    // Given - a hook that breaks HEAD, so the reset that follows fails, then fails
    repo.write("docs/a.md", "a\n");
    repo.installFailingHook({
      output: "hook says no",
      script: "echo broken > .git/HEAD",
    });

    // When - committing
    const result = commitFiles({
      filePaths: ["docs/a.md"],
      message: "x",
      repoRoot: repo.root,
    });

    // Then - the hook's output, not the reset's error
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringContaining("hook says no") as unknown,
    });
  });

  test("returns what the hook printed when the commit fails", () => {
    // Given - a pre-commit hook that fails
    repo.write("docs/a.md", "a\n");
    repo.installFailingHook({ output: "lint found 1 problem" });

    // When - committing
    const result = commitFiles({
      filePaths: ["docs/a.md"],
      message: "x",
      repoRoot: repo.root,
    });

    // Then - the hook's output
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringContaining("lint found 1 problem") as unknown,
    });

    // And - the file unstaged again, still on disk
    expect(repo.git("status", "--porcelain")).toBe("?? docs/\n");
  });
});

describe("findRepoRoot", () => {
  test("finds the root from a subdirectory", () => {
    // Given - a subdirectory
    repo.write("docs/a.md", "a\n");

    // When/Then - the root
    expect(findRepoRoot(`${repo.root}/docs`)).toStrictEqual({
      isOk: true,
      value: repo.root,
    });
  });

  test("says why outside a repo", () => {
    // Given - the filesystem root, which is in no repo
    // When/Then - git's own message
    expect(findRepoRoot("/")).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't find the repo root: fatal: /u
      ) as unknown,
    });
  });
});

describe("listDirtyPaths", () => {
  test("keeps only the files git sees as changed, in the given order", () => {
    // Given - one committed file, one edited after its commit, and a new one
    repo.write("a.md", "a\n");
    repo.write("b.md", "b\n");
    repo.commitAll("add");
    repo.write("b.md", "b2\n");
    repo.write("c.md", "c\n");

    // When - asking about all three
    const dirtyPaths = listDirtyPaths({
      filePaths: ["c.md", "a.md", "b.md"],
      repoRoot: repo.root,
    });

    // Then - the edited and the new one
    expect(dirtyPaths).toStrictEqual({ isOk: true, value: ["c.md", "b.md"] });
  });

  test("leaves out files HEAD doesn't have when told to skip new ones", () => {
    // Given - an edited file, an untracked one, a staged one, and one added with intent to add
    repo.write("a.md", "a\n");
    repo.commitAll("add");
    repo.write("a.md", "a2\n");
    repo.write("b.md", "b\n");
    repo.write("c.md", "c\n");
    repo.git("add", "--", "c.md");
    repo.write("d.md", "d\n");
    repo.git("add", "--intent-to-add", "--", "d.md");

    // When - asking about all four, skipping new files
    const dirtyPaths = listDirtyPaths({
      filePaths: ["a.md", "b.md", "c.md", "d.md"],
      repoRoot: repo.root,
      shouldSkipNew: true,
    });

    // Then - only the edited one
    expect(dirtyPaths).toStrictEqual({ isOk: true, value: ["a.md"] });
  });
});

describe("listDirtyPaths and listChangedPaths, when git status fails", () => {
  test("both fail naming the paths and git's reason", () => {
    // Given - an index git can't read
    repo.write(".git/index", "garbage\n");

    // When - asking for the dirty and the changed paths
    const dirty = listDirtyPaths({ filePaths: ["a.md"], repoRoot: repo.root });
    const changed = listChangedPaths({
      bundleDirs: ["docs"],
      repoRoot: repo.root,
    });

    // Then - each names what it was reading
    const reason = ": fatal: .git/index: index file smaller than expected";

    expect({ changed, dirty }).toStrictEqual({
      changed: {
        isOk: false,
        reason: `Couldn't read git status for docs${reason}`,
      },
      dirty: {
        isOk: false,
        reason: `Couldn't read git status for a.md${reason}`,
      },
    });
  });
});

describe("listChangedPaths", () => {
  test("joins the branch diff with uncommitted and renamed files", () => {
    // Given - a record committed on a branch, a new file, and a staged rename
    repo.write("docs/old.md", "old\n");
    repo.commitAll("base");
    repo.git("checkout", "--quiet", "-b", "feature");
    repo.write("docs/branch.md", "branch\n");
    repo.commitAll("branch");
    repo.write("docs/new.md", "new\n");
    repo.git("mv", "docs/old.md", "docs/renamed.md");
    repo.write("other/ignored.md", "x\n");

    // When - listing the changes under docs
    const result = listChangedPaths({
      bundleDirs: ["docs"],
      repoRoot: repo.root,
    });

    // Then - the branch's, the new, and the renamed path, but not the origin
    expect(result).toMatchObject({
      isOk: true,
      value: { hasBranchDiff: true },
    });
    expect([...(result.isOk ? result.value.paths : [])].sort()).toStrictEqual([
      "docs/branch.md",
      "docs/new.md",
      "docs/renamed.md",
    ]);
  });

  test("diffs against origin's default branch, even with no local copy of it", () => {
    // Given - origin/main at the base, no local main, and a record on the branch
    repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
    repo.git(
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main"
    );
    repo.git("checkout", "--quiet", "-b", "feature");
    repo.git("branch", "--delete", "--force", "main");
    repo.write("docs/branch.md", "branch\n");
    repo.commitAll("branch");

    // When - listing changes
    const result = listChangedPaths({
      bundleDirs: ["docs"],
      repoRoot: repo.root,
    });

    // Then - the branch's record, from the diff
    expect(result).toStrictEqual({
      isOk: true,
      value: {
        hasBranchDiff: true,
        paths: new Set(["docs/branch.md"]),
        statusPaths: new Set(),
      },
    });
  });

  test("skips the origin path of a rename marked in the second status column", () => {
    // Given - a committed record moved in the working tree, the new path intent-to-add
    repo.write("docs/old.md", "same text\n");
    repo.commitAll("base");
    repo.git("mv", "--", "docs/old.md", "docs/new.md");
    repo.git("reset", "--quiet");
    repo.git("add", "--intent-to-add", "docs/new.md");

    // When - listing changes
    const result = listChangedPaths({
      bundleDirs: ["docs"],
      repoRoot: repo.root,
    });

    // Then - the new path, and not the old one read as a record
    expect(repo.git("status", "--porcelain")).toMatch(/^ R /u);
    expect(result.isOk && [...result.value.paths]).toStrictEqual([
      "docs/new.md",
    ]);
  });

  test("falls back to uncommitted changes when there is no base branch", () => {
    // Given - a repo whose only branch isn't main
    repo.git("branch", "--move", "main", "trunk");
    repo.write("docs/a.md", "a\n");

    // When - listing changes
    const result = listChangedPaths({
      bundleDirs: ["docs"],
      repoRoot: repo.root,
    });

    // Then - no branch diff, but the uncommitted file, new to HEAD
    expect(result).toStrictEqual({
      isOk: true,
      value: {
        hasBranchDiff: false,
        paths: new Set(["docs/a.md"]),
        statusPaths: new Set(),
      },
    });
  });

  test("reports only the files HEAD has as the working tree's status", () => {
    // Given - a committed record edited, and a new one beside it
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add");
    repo.write("docs/a.md", "a2\n");
    repo.write("docs/b.md", "b\n");

    // When - listing changes
    const result = listChangedPaths({
      bundleDirs: ["docs"],
      repoRoot: repo.root,
    });

    // Then - both changed, only the edited one in the status
    expect(
      result.isOk && {
        paths: [...result.value.paths].sort(),
        statusPaths: [...result.value.statusPaths],
      }
    ).toStrictEqual({
      paths: ["docs/a.md", "docs/b.md"],
      statusPaths: ["docs/a.md"],
    });
  });
});

describe("listBranchCommits", () => {
  test("lists the commits HEAD has that the base doesn't", () => {
    // Given - a branch with one commit past main
    const base = repo.git("rev-parse", "HEAD").trim();
    repo.git("switch", "--quiet", "-c", "edit");
    repo.write("a.md", "a\n");
    repo.commitAll("add a");
    const head = repo.git("rev-parse", "HEAD").trim();

    // When - listing the branch's commits, and those past a base git
    // doesn't have
    const commits = listBranchCommits({ base, repoRoot: repo.root });
    const unknown = listBranchCommits({
      base: "0".repeat(40),
      repoRoot: repo.root,
    });

    // Then - the one commit, and none
    expect({ commits, unknown }).toStrictEqual({
      commits: [head],
      unknown: [],
    });
  });
});

describe("listPathChanges", () => {
  test("dates a commit by when it was committed, not when it was authored", () => {
    // Given - a commit authored a day before it was committed, as a rebase
    // or a cherry-pick lands it
    repo.write("src/a.ts", "a\n");
    repo.git("add", "--all");
    execFileSync("git", ["commit", "--quiet", "-m", "add a"], {
      cwd: repo.root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-10-01T15:00:00Z",
        GIT_COMMITTER_DATE: "2026-10-02T15:00:00Z",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // When - listing the file's changes
    const changes = listPathChanges({
      filePath: "src/a.ts",
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - the commit, dated by its committer time
    expect(changes).toMatchObject({
      isOk: true,
      value: {
        commits: [
          {
            committedAt: DateTime.fromISO("2026-10-02T15:00:00Z").toSeconds(),
          },
        ],
      },
    });
  });

  test("lists a folder's commits, newest first, and its uncommitted files", () => {
    // Given - two commits to a folder, one elsewhere, and an untracked file
    repo.write("src/a.ts", "a\n");
    repo.commitAll("add a");
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    repo.write("src/a.ts", "a2\n");
    repo.commitAll("edit a");
    repo.write("src/c.ts", "c\n");
    const log = repo
      .git("log", "--format=%H %h %ct", "-2", "--", "src")
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, shortHash, committedAt] = line.split(" ");

        return { committedAt: Number(committedAt), hash, shortHash };
      });

    // When - listing the folder's changes
    const changes = listPathChanges({
      filePath: "src",
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - its two commits, and that it has uncommitted changes
    expect(changes).toStrictEqual({
      isOk: true,
      value: { commits: log, isDirty: true },
    });
  });

  test("lists no commits on a branch that has none", () => {
    // Given - a branch with no commit, and a clean file
    repo.git("update-ref", "-d", "HEAD");

    // When - listing a path's changes
    const changes = listPathChanges({
      filePath: "src/a.ts",
      hasHead: false,
      repoRoot: repo.root,
    });

    // Then - none
    expect(changes).toStrictEqual({
      isOk: true,
      value: { commits: [], isDirty: false },
    });
  });

  test("fails naming the path when git status fails", () => {
    // Given - an index git can't read
    repo.write(".git/index", "garbage\n");

    // When - listing a path's changes
    const changes = listPathChanges({
      filePath: "src/a.ts",
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - it names what it was reading
    expect(changes).toStrictEqual({
      isOk: false,
      reason:
        "Couldn't read git status for src/a.ts: fatal: .git/index: index file smaller than expected",
    });
  });

  test("fails naming the path when git log fails", () => {
    // Given - a history git has lost a tree of
    repo.write("src/a.ts", "a\n");
    repo.commitAll("add a");
    const tree = repo.git("rev-parse", "HEAD^{tree}").trim();
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    rmSync(
      path.join(repo.root, ".git/objects", tree.slice(0, 2), tree.slice(2))
    );

    // When - listing a path's changes
    const changes = listPathChanges({
      filePath: "src/a.ts",
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - it names the path
    expect(changes.isOk ? undefined : changes.reason).toMatch(
      /^Couldn't read the history of src\/a\.ts: /u
    );
  });
});

describe("listPathChangesTogether", () => {
  test("reads each path's changes as listPathChanges reads them alone", () => {
    // Given - a folder, a file beside a longer name, a deleted file, a file
    // renamed away in the index, an untracked one, another case, and a commit
    // that changes several of them at once
    repo.write("src/a.ts", "a\n");
    repo.write("src/ab.ts", "ab\n");
    repo.write("gone.md", "gone\n");
    repo.write("old.md", "old\n");
    repo.commitAll("add files");
    repo.write("src/a.ts", "a2\n");
    repo.write("b.md", "b\n");
    repo.commitAll("edit a, add b");
    rmSync(path.join(repo.root, "gone.md"));
    repo.commitAll("remove gone");
    repo.git("mv", "old.md", "new.md");
    repo.write("untracked.md", "u\n");
    const filePaths = [
      "src",
      "src/a",
      "src/a.ts",
      "b.md",
      "gone.md",
      "old.md",
      "new.md",
      "untracked.md",
      "SRC/a.ts",
      "missing.md",
    ];

    // When - reading them together, and each one alone
    const together = listPathChangesTogether({
      filePaths,
      hasHead: true,
      repoRoot: repo.root,
    });
    const alone = filePaths.map((filePath) => {
      const changes = listPathChanges({
        filePath,
        hasHead: true,
        repoRoot: repo.root,
      });

      return { changes: changes.isOk ? changes.value : changes, filePath };
    });

    // Then - the same changes for every path, and every commit in order
    expect(together).toStrictEqual({
      isOk: true,
      value: {
        order: repo.git("rev-list", "--max-count=3", "HEAD").trim().split("\n"),
        paths: alone,
      },
    });
  });

  test.skipIf(!DISK_SPELLING.isNormalizationInsensitive)(
    "matches a decomposed spelling, as git composes it on this disk",
    () => {
      // Given - a file committed and edited, named in its composed form
      repo.write("caf\u00e9.md", "cafe\n");
      repo.commitAll("add cafe");
      repo.write("caf\u00e9.md", "cafe2\n");
      const filePath = "cafe\u0301.md";

      // When - reading its decomposed spelling together, and alone
      const together = listPathChangesTogether({
        filePaths: [filePath],
        hasHead: true,
        repoRoot: repo.root,
      });
      const alone = listPathChanges({
        filePath,
        hasHead: true,
        repoRoot: repo.root,
      });

      // Then - the same commit and uncommitted change
      expect(together).toStrictEqual({
        isOk: true,
        value: {
          order: [repo.git("rev-parse", "HEAD").trim()],
          paths: [{ changes: alone.isOk ? alone.value : alone, filePath }],
        },
      });
      expect(alone).toMatchObject({ value: { isDirty: true } });
    }
  );

  test("reads no commits on a branch that has none", () => {
    // Given - a branch with no commit, and an untracked file
    repo.git("update-ref", "-d", "HEAD");
    repo.write("src/a.ts", "a\n");

    // When - reading two paths' changes
    const changes = listPathChangesTogether({
      filePaths: ["src/a.ts", "b.md"],
      hasHead: false,
      repoRoot: repo.root,
    });

    // Then - no commits, and the untracked one
    expect(changes).toStrictEqual({
      isOk: true,
      value: {
        order: [],
        paths: [
          { changes: { commits: [], isDirty: true }, filePath: "src/a.ts" },
          { changes: { commits: [], isDirty: false }, filePath: "b.md" },
        ],
      },
    });
  });

  test("fails on a history with a merge", () => {
    // Given - a side branch merged back with a merge commit
    repo.git("switch", "--quiet", "-c", "side");
    repo.write("src/a.ts", "a\n");
    repo.commitAll("add a");
    repo.git("switch", "--quiet", "main");
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    repo.git("merge", "--quiet", "--no-edit", "side");

    // When - reading a path's changes
    const changes = listPathChangesTogether({
      filePaths: ["src/a.ts"],
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - it fails, so its caller reads each path alone
    expect(changes).toStrictEqual({
      isOk: false,
      reason: "Couldn't rule out a merge in the history.",
    });
  });

  test("fails naming the paths when git status fails", () => {
    // Given - an index git can't read
    repo.write(".git/index", "garbage\n");

    // When - reading two paths' changes
    const changes = listPathChangesTogether({
      filePaths: ["src/a.ts", "b.md"],
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - it names what it was reading
    expect(changes).toStrictEqual({
      isOk: false,
      reason:
        "Couldn't read git status for src/a.ts, b.md: fatal: .git/index: index file smaller than expected",
    });
  });

  test("fails naming the paths when git log fails", () => {
    // Given - a history git has lost a tree of
    repo.write("src/a.ts", "a\n");
    repo.commitAll("add a");
    const tree = repo.git("rev-parse", "HEAD^{tree}").trim();
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    rmSync(
      path.join(repo.root, ".git/objects", tree.slice(0, 2), tree.slice(2))
    );

    // When - reading two paths' changes
    const changes = listPathChangesTogether({
      filePaths: ["src/a.ts", "b.md"],
      hasHead: true,
      repoRoot: repo.root,
    });

    // Then - it names the paths
    expect(changes.isOk ? undefined : changes.reason).toMatch(
      /^Couldn't read the history of src\/a\.ts, b\.md: /u
    );
  });
});

describe("listUnreachedCommits", () => {
  test("lists the commits no other given commit has in its history", () => {
    // Given - a main line, and a side branch off its first commit, merged
    // back
    repo.write("a.md", "a\n");
    repo.commitAll("add a");
    const first = repo.git("rev-parse", "HEAD").trim();
    repo.git("switch", "--quiet", "-c", "side");
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    const side = repo.git("rev-parse", "HEAD").trim();
    repo.git("switch", "--quiet", "main");
    repo.write("c.md", "c\n");
    repo.commitAll("add c");
    const main = repo.git("rev-parse", "HEAD").trim();
    repo.git("merge", "--quiet", "--no-ff", "--no-edit", "side");
    const merge = repo.git("rev-parse", "HEAD").trim();

    // When - asking which of them main's commit reaches
    const unreached = listUnreachedCommits({
      commits: [first, side, main, merge],
      from: [main],
      repoRoot: repo.root,
    });

    // Then - the side branch's commit and the merge, but not main's commit
    // or its ancestor
    expect(unreached).toStrictEqual({
      isOk: true,
      value: new Set([merge, side]),
    });
  });

  test("says why when git can't read a commit", () => {
    // Given - a hash no commit has
    repo.write("a.md", "a\n");
    repo.commitAll("add a");
    const head = repo.git("rev-parse", "HEAD").trim();

    // When - asking whether the commit reaches it
    const unreached = listUnreachedCommits({
      commits: ["0".repeat(40)],
      from: [head],
      repoRoot: repo.root,
    });

    // Then - git's reason
    expect(unreached.isOk ? undefined : unreached.reason).toMatch(/\S/u);
  });
});

describe("listWorkingPaths", () => {
  test("lists tracked and untracked paths, but not ignored ones", () => {
    // Given - a committed file, an untracked one, and an ignored one
    repo.write(".gitignore", "build/\n");
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add a");
    repo.write("docs/b.md", "b\n");
    repo.write("build/c.md", "c\n");

    // When - listing the working tree
    const workingPaths = listWorkingPaths(repo.root);

    // Then - all but the ignored one
    expect([...workingPaths].sort()).toStrictEqual([
      ".gitignore",
      "docs/a.md",
      "docs/b.md",
      "package.json",
    ]);
  });

  test("lists nothing when git can't be asked", () => {
    // Given/When - a folder that isn't a repo
    const workingPaths = listWorkingPaths("/");

    // Then - nothing
    expect(workingPaths).toStrictEqual([]);
  });
});

describe("readWorkingPaths", () => {
  test("lists each path git would track", () => {
    // Given - a committed file and an untracked one
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add a");
    repo.write("docs/b.md", "b\n");

    // When - listing the working tree
    const listed = readWorkingPaths(repo.root);

    // Then - both, with the repo's package.json
    expect(listed.isOk && [...listed.value].sort()).toStrictEqual([
      "docs/a.md",
      "docs/b.md",
      "package.json",
    ]);
  });

  test("says why when git can't be asked", () => {
    // Given/When - a folder that isn't a repo
    const listed = readWorkingPaths("/");

    // Then - the reason, naming the listing
    expect(listed).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't list the files git tracks: /u
      ) as unknown,
    });
  });
});

describe("listIndexPaths", () => {
  test("lists every path the index holds, spelled as it is", () => {
    // Given - a committed file, a staged one whose name starts with a space,
    // and an untracked one
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add a");
    repo.write(" b.md", "b\n");
    repo.git("add", "--", " b.md");
    repo.write("c.md", "c\n");

    // When - listing the index
    const indexPaths = listIndexPaths(repo.root);

    // Then - the committed and the staged ones, untrimmed
    expect(indexPaths).toStrictEqual([" b.md", "docs/a.md", "package.json"]);
  });

  test("lists an index larger than Node's default output buffer", () => {
    // Given - more than 1 MiB of long paths staged, all for one blob
    const blob = repo.git("hash-object", "-w", "--", "package.json").trim();
    const folder = "x".repeat(200);
    const indexInfo = Array.from(
      { length: 6000 },
      (_, position) => `100644 ${blob}\t${folder}/${position}.md\n`
    ).join("");

    execFileSync("git", ["update-index", "--index-info"], {
      cwd: repo.root,
      input: indexInfo,
    });

    // When - listing the index
    const indexPaths = listIndexPaths(repo.root);

    // Then - every path
    expect(indexPaths).toHaveLength(6001);
  });

  test("is empty when git can't read the index", () => {
    // Given - an index git can't read
    repo.write(".git/index", "garbage\n");

    // When - listing the index
    const indexPaths = listIndexPaths(repo.root);

    // Then - nothing
    expect(indexPaths).toStrictEqual([]);
  });
});

describe("readBaseRef", () => {
  test("reads the remote's default branch", () => {
    // Given - origin/HEAD pointing at trunk
    repo.git("update-ref", "refs/remotes/origin/trunk", "HEAD");
    repo.git(
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk"
    );

    // When/Then - the remote-tracking ref
    expect(readBaseRef(repo.root)).toBe("origin/trunk");
  });

  test("falls back to origin/main when origin/HEAD isn't set", () => {
    // Given - a remote added after the fact: origin/main but no origin/HEAD
    repo.git("update-ref", "refs/remotes/origin/main", "HEAD");

    // When/Then - origin/main
    expect(readBaseRef(repo.root)).toBe("origin/main");
  });

  test("falls back to main without origin/HEAD", () => {
    // Given/When/Then - main
    expect(readBaseRef(repo.root)).toBe("main");
  });
});

describe("readCommittedText", () => {
  test("reads a file as HEAD holds it, not as it is on disk", () => {
    // Given - a committed file, changed since
    repo.write("docs/a.md", "a\n");
    repo.commitAll("add a");
    repo.write("docs/a.md", "a2\n");

    // When - reading it at HEAD
    const result = readCommittedText({
      filePath: "docs/a.md",
      repoRoot: repo.root,
    });

    // Then - the committed text
    expect(result).toStrictEqual({ isOk: true, value: "a\n" });
  });

  test("reads a file HEAD doesn't have as undefined", () => {
    // Given - a file never committed
    repo.write("docs/a.md", "a\n");

    // When - reading it at HEAD
    const result = readCommittedText({
      filePath: "docs/a.md",
      repoRoot: repo.root,
    });

    // Then - nothing, and no failure
    expect(result).toStrictEqual({ isOk: true, value: undefined });
  });

  test("fails, naming the file, on a branch with no commits", () => {
    // Given - HEAD on a branch with no commits yet
    repo.git("checkout", "--quiet", "--orphan", "empty");

    // When - reading a file at HEAD
    const result = readCommittedText({
      filePath: "package.json",
      repoRoot: repo.root,
    });

    // Then - why
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't read package\.json at HEAD: /u
      ) as unknown,
    });
  });
});

describe("readGitFailure", () => {
  test("reads the string fields an exec error carries", () => {
    // Given - an error with a code, stderr, and a non-string stdout
    const error = Object.assign(new Error("failed"), {
      code: "ENOENT",
      stderr: "fatal",
      stdout: Buffer.from("x"),
    });

    // When/Then - the strings, and undefined for the rest
    expect(readGitFailure(error)).toStrictEqual({
      code: "ENOENT",
      stderr: "fatal",
      stdout: undefined,
    });
  });

  test("reads nothing from a thrown non-Error", () => {
    // Given/When/Then - every field undefined
    expect(readGitFailure("failed")).toStrictEqual({
      code: undefined,
      stderr: undefined,
      stdout: undefined,
    });
  });
});
