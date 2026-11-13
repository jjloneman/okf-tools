import { describe, expect, test } from "vitest";

import { useTestRepo } from "#test/repo";

import {
  commitFiles,
  findRepoRoot,
  listChangedPaths,
  listDirtyPaths,
  readBaseRef,
  readGitFailure,
} from "./git.ts";

const { repo } = useTestRepo();

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
    expect(dirtyPaths).toStrictEqual(["c.md", "b.md"]);
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
    expect(result.hasBranchDiff).toBe(true);
    expect([...result.paths].sort()).toStrictEqual([
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
      hasBranchDiff: true,
      paths: new Set(["docs/branch.md"]),
      statusPaths: new Set(),
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
    expect([...result.paths]).toStrictEqual(["docs/new.md"]);
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
      hasBranchDiff: false,
      paths: new Set(["docs/a.md"]),
      statusPaths: new Set(["docs/a.md"]),
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
