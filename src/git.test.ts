import { describe, expect, test } from "vitest";

import { useTestRepo } from "#test/repo";

import {
  checkCommittable,
  commitFiles,
  findRepoRoot,
  listChangedPaths,
  listDirtyPaths,
  readBaseRef,
  readCommittedText,
  readGitFailure,
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

    // Then - no branch diff, but the uncommitted file
    expect(result).toStrictEqual({
      isOk: true,
      value: {
        hasBranchDiff: false,
        paths: new Set(["docs/a.md"]),
        statusPaths: new Set(["docs/a.md"]),
      },
    });
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
