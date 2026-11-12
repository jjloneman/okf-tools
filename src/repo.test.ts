import { chmodSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TestRepo } from "#test/repo";

import {
  createTestRepo,
  draftRecord,
  record,
  verifiedRecord,
} from "#test/repo";

import {
  commitFiles,
  findRepoRoot,
  listChangedPaths,
  listDirtyPaths,
  loadCandidate,
  loadCandidates,
  loadCandidatesAt,
  readBaseRef,
  readGitFailure,
  resolveBundleDirs,
  resolveRecordPaths,
  writeRecords,
} from "./repo.ts";

const VERIFIED_BY = "human:jjloneman";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo();
});

afterEach(() => {
  repo.remove();
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

describe("loadCandidate", () => {
  test("explains a record that can't be read", () => {
    // Given - a record with no read permission
    repo.write("docs/decisions/a.md", draftRecord("A"));
    chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

    // When - loading it
    const loaded = loadCandidate({
      filePath: "docs/decisions/a.md",
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - a reason naming the file and the error
    expect(loaded).toStrictEqual({
      kind: "unreadable",
      reason: expect.stringMatching(
        /^docs\/decisions\/a\.md can't be read: .*EACCES/u
      ) as string,
    });
  });
});

describe("loadCandidates, given invalid YAML", () => {
  test("reports a record whose frontmatter isn't valid YAML", () => {
    // Given - a record with a duplicated key, and a good one
    repo.write(
      "docs/decisions/a.md",
      record(["type: Decision", "type: Again"])
    );
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - loading the bundle
    const { candidates, problems } = loadCandidates({
      bundleDirs: ["docs/decisions"],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the good record listed, and the other reported
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
    ]);
    expect(problems).toStrictEqual([
      expect.stringMatching(
        /^docs\/decisions\/a\.md: frontmatter isn't valid YAML: /u
      ),
    ]);
  });
});

describe("loadCandidates", () => {
  test("reports a record that can't be read instead of listing it", () => {
    // Given - two records, the first with no read permission
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));
    chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

    // When - loading the bundle
    const { candidates, problems } = loadCandidates({
      bundleDirs: ["docs/decisions"],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the readable record listed, and the other reported
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
    ]);
    expect(problems).toStrictEqual([
      expect.stringMatching(/^docs\/decisions\/a\.md can't be read: /u),
    ]);
  });

  test("reads each bundle's records in order, skipping non-records", () => {
    // Given - two bundles with records, an index, a non-record, and a non-Markdown file
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.write(
      "docs/decisions/a.md",
      verifiedRecord({ by: VERIFIED_BY, title: "A" })
    );
    repo.write("docs/decisions/index.md", draftRecord("Index"));
    repo.write("docs/decisions/notes.txt", "x\n");
    repo.write("docs/decisions/assets.md/image.txt", "x\n");
    repo.write("docs/references/c.md", "# No frontmatter\n");
    repo.write("docs/references/d.md", draftRecord("D"));

    // When - loading both bundles
    const { candidates, problems } = loadCandidates({
      bundleDirs: ["docs/decisions", "docs/references"],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the records, with their states
    expect(
      candidates.map(({ filePath, state }) => [filePath, state])
    ).toStrictEqual([
      ["docs/decisions/a.md", "verified"],
      ["docs/decisions/b.md", "unverified"],
      ["docs/references/d.md", "unverified"],
    ]);
    expect(problems).toStrictEqual([]);
  });
});

describe("loadCandidatesAt", () => {
  test("keeps the record files among the paths, in the given order", () => {
    // Given - two records, a file outside the bundle, and the bundle's index
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.write("docs/decisions/index.md", draftRecord("Index"));
    repo.write("other/c.md", draftRecord("C"));

    // When - loading them, deleted path included
    const { candidates } = loadCandidatesAt({
      bundleDirs: ["docs/decisions"],
      filePaths: [
        "docs/decisions/b.md",
        "docs/decisions/deleted.md",
        "docs/decisions/index.md",
        "other/c.md",
        "docs/decisions/a.md",
      ],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the two records, in the given order
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
      "docs/decisions/a.md",
    ]);
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

describe("resolveBundleDirs", () => {
  test("accepts a folder whose name starts with two dots", () => {
    // Given - a folder named ..archive inside the repo
    repo.write("..archive/a.md", "a\n");

    // When/Then - it, not "outside the repo"
    expect(
      resolveBundleDirs({
        bundleDirs: [`${repo.root}/..archive`],
        repoRoot: repo.root,
      })
    ).toStrictEqual({ isOk: true, value: ["..archive"] });
  });

  test("returns paths from the root, each once, with the root as .", () => {
    // Given - one bundle, named twice, and the root itself
    repo.write("docs/decisions/a.md", "a\n");
    const bundleDir = `${repo.root}/docs/decisions`;

    // When - resolving them
    const result = resolveBundleDirs({
      bundleDirs: [bundleDir, bundleDir, repo.root],
      repoRoot: repo.root,
    });

    // Then - each once
    expect(result).toStrictEqual({
      isOk: true,
      value: ["docs/decisions", "."],
    });
  });

  test.each([
    {
      description: "a directory outside the repo",
      dir: "/",
      reason: "/ is outside the repo at ROOT.",
    },
    {
      description: "a missing directory",
      dir: "ROOT/missing",
      reason: "No bundle directory at ROOT/missing.",
    },
    {
      description: "a file",
      dir: "ROOT/package.json",
      reason: "No bundle directory at ROOT/package.json.",
    },
  ])("rejects $description", ({ dir, reason }) => {
    // When/Then - why
    expect(
      resolveBundleDirs({
        bundleDirs: [dir.replace("ROOT", repo.root)],
        repoRoot: repo.root,
      })
    ).toStrictEqual({
      isOk: false,
      reason: reason.replaceAll("ROOT", repo.root),
    });
  });
});

describe("resolveRecordPaths", () => {
  beforeEach(() => {
    repo.write("docs/decisions/a.md", "a\n");
    repo.write("docs/decisions/index.md", "i\n");
    repo.write("docs/decisions/notes.txt", "n\n");
    repo.write("docs/decisions/folder.md/inner.txt", "x\n");
  });

  test("returns paths from the root, each once", () => {
    // When - naming one record twice, from a subdirectory
    const result = resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: `${repo.root}/docs`,
      recordPaths: ["decisions/a.md", `${repo.root}/docs/decisions/a.md`],
      repoRoot: repo.root,
    });

    // Then - it once
    expect(result).toStrictEqual({
      isOk: true,
      value: ["docs/decisions/a.md"],
    });
  });

  test.each([
    {
      description: "a file outside the repo",
      reason: "/etc/hosts isn't a record in docs/decisions.",
      recordPath: "/etc/hosts",
    },
    {
      description: "a file outside the bundles",
      reason: "package.json isn't a record in docs/decisions.",
      recordPath: "package.json",
    },
    {
      description: "a non-Markdown file",
      reason: "docs/decisions/notes.txt isn't a record in docs/decisions.",
      recordPath: "docs/decisions/notes.txt",
    },
    {
      description: "the bundle's index",
      reason: "docs/decisions/index.md isn't a record in docs/decisions.",
      recordPath: "docs/decisions/index.md",
    },
    {
      description: "a missing record",
      reason: "No record at docs/decisions/missing.md.",
      recordPath: "docs/decisions/missing.md",
    },
  ])("rejects $description", ({ reason, recordPath }) => {
    // When/Then - why
    expect(
      resolveRecordPaths({
        bundleDirs: ["docs/decisions"],
        cwd: repo.root,
        recordPaths: [recordPath],
        repoRoot: repo.root,
      })
    ).toStrictEqual({ isOk: false, reason });
  });
});

describe("writeRecords", () => {
  test("writes each record's new text", () => {
    // Given - a record on disk
    repo.write("docs/a.md", "old\n");

    // When - writing its edit
    const result = writeRecords({
      edits: [{ filePath: "docs/a.md", originalText: "old\n", text: "new\n" }],
      repoRoot: repo.root,
    });

    // Then - the new text
    expect(result).toStrictEqual({ isOk: true, value: undefined });
    expect(repo.read("docs/a.md")).toBe("new\n");
  });

  test("restores the records already written when a later write fails", () => {
    // Given - two records, the second read-only
    repo.write("docs/a.md", "old a\n");
    repo.write("docs/b.md", "old b\n");
    chmodSync(path.join(repo.root, "docs/b.md"), 0o444);

    // When - writing both
    const result = writeRecords({
      edits: [
        { filePath: "docs/a.md", originalText: "old a\n", text: "new a\n" },
        { filePath: "docs/b.md", originalText: "old b\n", text: "new b\n" },
      ],
      repoRoot: repo.root,
    });

    // Then - the failure named, and the first record back as it was
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't write docs\/b\.md: .*EACCES[\s\S]*No files changed\.$/u
      ) as unknown,
    });
    expect(repo.read("docs/a.md")).toBe("old a\n");
  });
});
