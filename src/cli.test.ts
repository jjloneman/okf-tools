import { chmodSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TestRepo } from "#test/repo";

import {
  createTestRepo,
  draftRecord,
  record,
  verifiedRecord,
} from "#test/repo";

import { run } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { runInteractive } from "./interactive.ts";

// The prompts are covered in interactive.test.ts; here only the dispatch is.
vi.mock(import("./interactive.ts"), () => ({
  runInteractive: vi.fn(() => Promise.resolve(EXIT_CODES.ok)),
}));

const CONFIG = JSON.stringify({
  okf: {
    bundles: ["docs/decisions", "docs/references"],
    verifiedBy: "human:jjloneman",
  },
});

let repo: TestRepo;
let errors: string[];
let infos: string[];

beforeEach(() => {
  repo = createTestRepo(CONFIG);
  errors = [];
  infos = [];
  vi.spyOn(console, "error").mockImplementation((line: string) =>
    errors.push(line)
  );
  vi.spyOn(console, "log").mockImplementation((line: string) =>
    infos.push(line)
  );
});

afterEach(() => {
  repo.remove();
  vi.restoreAllMocks();
  vi.mocked(runInteractive).mockClear();
});

/** Run the CLI non-interactively from the repo root, or a directory in it. */
function runIn(args: string[], directory = "."): Promise<number> {
  return run({
    args,
    cwd: path.join(repo.root, directory),
    isInteractive: false,
  });
}

describe("run, before any records are read", () => {
  test("prints the usage for --help", async () => {
    // When - asking for help
    const code = await runIn(["--help"]);

    // Then - the usage on stdout
    expect(code).toBe(0);
    expect(infos.join("\n")).toContain("[okf-verify] usage: okf-verify");
  });

  test("prints the problem and the usage for bad arguments", async () => {
    // When - passing --yes alone
    const code = await runIn(["--yes"]);

    // Then - both on stderr
    expect(code).toBe(1);
    expect(errors.join("\n")).toMatch(
      /needs --changed[\s\S]*usage: okf-verify/u
    );
  });

  test("refuses the prompts without a terminal", async () => {
    // Given - a bundle to scan
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/references/b.md", draftRecord("B"));

    // When - running without --yes or a terminal
    const code = await runIn([]);

    // Then - a pointer to --yes
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(
      "pass --yes with --changed or record paths"
    );
    expect(runInteractive).not.toHaveBeenCalled();
  });

  test.each([
    {
      args: [],
      description: "a directory outside any repo",
      directory: "/",
      expected: "Couldn't find the repo root",
    },
    {
      args: ["--bundle", "missing"],
      description: "a missing bundle",
      directory: ".",
      expected: "No bundle directory at",
    },
    {
      args: ["--by", "has space", "--bundle", "."],
      description: "an unusable actor",
      directory: ".",
      expected: "isn't an actor a record can hold",
    },
  ])("fails on $description", async ({ args, directory, expected }) => {
    // When - running there
    const code = await run({
      args,
      cwd: directory === "/" ? "/" : path.join(repo.root, directory),
      isInteractive: true,
    });

    // Then - why, on stderr
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(expected);
  });

  test("fails on an unreadable package.json", async () => {
    // Given - a repo whose package.json isn't JSON
    repo.remove();
    repo = createTestRepo("{");

    // When - running
    const code = await runIn(["--bundle", "."]);

    // Then - why
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("package.json isn't valid JSON");
  });

  test("runs with flags alone when there is no package.json", async () => {
    // Given - a repo without a package.json, with one draft
    repo.git("rm", "--quiet", "package.json");
    repo.commitAll("drop package.json");
    repo.write("decisions/a.md", draftRecord("A"));

    // When - verifying it with flags
    const code = await runIn([
      "--yes",
      "--bundle",
      "decisions",
      "--by",
      "human:jjloneman",
      "decisions/a.md",
    ]);

    // Then - verified
    expect(code).toBe(0);
    expect(repo.read("decisions/a.md")).toContain(
      "verified: { by: human:jjloneman"
    );
  });
});

describe("run, interactively", () => {
  test("hands a terminal run to the prompts with the resolved context", async () => {
    // Given - both bundles exist
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/references/b.md", draftRecord("B"));

    // When - running in a terminal from a subdirectory
    const code = await run({
      args: ["--no-commit"],
      cwd: path.join(repo.root, "docs"),
      isInteractive: true,
    });

    // Then - the prompts get the bundles from the root
    expect(code).toBe(0);
    expect(runInteractive).toHaveBeenCalledWith({
      bundleDirs: ["docs/decisions", "docs/references"],
      cwd: path.join(repo.root, "docs"),
      repoRoot: repo.root,
      shouldCommit: false,
      verifiedBy: "human:jjloneman",
    });
  });
});

describe("run --yes", () => {
  beforeEach(() => {
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write(
      "docs/decisions/b.md",
      verifiedRecord({ by: "human:jjloneman", title: "B" })
    );
    repo.write("docs/references/c.md", draftRecord("C"));
    repo.write("docs/references/d.md", draftRecord("D"));
    repo.commitAll("add records");
    repo.git("checkout", "--quiet", "-b", "feature");
  });

  test("--changed verifies every changed record across bundles in one commit", async () => {
    // Given - two records changed on the branch, one already verified
    repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
    repo.write(
      "docs/decisions/b.md",
      `${verifiedRecord({ by: "human:jjloneman", title: "B" })}\nMore.\n`
    );
    repo.write("docs/references/c.md", `${draftRecord("C")}\nMore.\n`);
    repo.commitAll("edit");

    // When - verifying the changed ones
    const code = await runIn(["--yes", "--changed"]);

    // Then - one commit with both drafts, the verified one skipped
    expect(code).toBe(0);
    expect(repo.git("show", "--name-only", "--format=%B", "HEAD")).toBe(
      "docs(okf): 📝 verify 2 decision records\n\n- A (a.md)\n- C (c.md)\n\n\ndocs/decisions/a.md\ndocs/references/c.md\n"
    );
    expect(infos).toContain(
      "[okf-verify] skipped docs/decisions/b.md: already verified, unchanged"
    );
    expect(infos.at(-1)).toMatch(/^\[okf-verify\] committed [0-9a-f]+$/u);
  });

  test("--changed falls back to uncommitted changes without a base branch", async () => {
    // Given - no main to diff against, and one uncommitted edit
    repo.git("branch", "--delete", "--force", "main");
    repo.write("docs/references/d.md", `${draftRecord("D")}\nMore.\n`);

    // When - verifying the changed ones
    const code = await runIn(["--yes", "--changed", "--no-commit"]);

    // Then - a warning, and the uncommitted record verified but not committed
    expect(code).toBe(0);
    expect(infos[0]).toContain("Can't diff against the base branch");
    expect(infos).toContain("[okf-verify] verified docs/references/d.md");
    expect(infos.at(-1)).toBe("[okf-verify] Left uncommitted (--no-commit).");
    expect(repo.git("status", "--porcelain")).toBe(" M docs/references/d.md\n");
  });

  test("named records are verified relative to the cwd", async () => {
    // When - naming one record from a subdirectory
    const code = await runIn(["--yes", "references/d.md"], "docs");

    // Then - it alone, committed under its bundle's scope
    expect(code).toBe(0);
    expect(repo.git("log", "-1", "--format=%s")).toBe(
      "docs(references): 📝 verify 1 decision record\n"
    );
  });

  test("warns when a named record carries other uncommitted changes", async () => {
    // Given - an uncommitted edit to the record
    repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);

    // When - verifying it
    const code = await runIn(["--yes", "docs/decisions/a.md"]);

    // Then - the warning names it, and the commit includes the edit
    expect(code).toBe(0);
    expect(infos.join("\n")).toContain(
      "which the commit will include:\n[okf-verify] docs/decisions/a.md"
    );
    expect(repo.git("show", "HEAD", "--", "docs/decisions/a.md")).toContain(
      "+More."
    );
  });

  test("exits 2 when nothing needs verifying", async () => {
    // When - naming an already verified record
    const code = await runIn(["--yes", "docs/decisions/b.md"]);

    // Then - nothing to do
    expect(code).toBe(2);
    expect(infos.at(-1)).toBe("[okf-verify] Nothing to verify.");
  });

  test.each([
    {
      description: "a path outside the bundles",
      expected: "package.json isn't a record in",
      recordPath: "package.json",
    },
    {
      description: "a file with no frontmatter",
      expected: "docs/decisions/e.md has no frontmatter block.",
      recordPath: "docs/decisions/e.md",
    },
  ])("fails on $description", async ({ expected, recordPath }) => {
    // Given - a non-record in the bundle
    repo.write("docs/decisions/e.md", "# Just notes\n");

    // When - naming it
    const code = await runIn(["--yes", recordPath]);

    // Then - why
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(expected);
  });

  test("fails without touching anything when a record refuses the edit", async () => {
    // Given - a record whose verified key is a nested mapping, which the editor refuses
    const refusing = record([
      "type: Decision",
      "status: draft",
      "verified:",
      "  by: human:someone",
    ]);
    repo.write("docs/decisions/e.md", refusing);

    // When - naming it with a good one
    const code = await runIn([
      "--yes",
      "docs/decisions/a.md",
      "docs/decisions/e.md",
    ]);

    // Then - no file changed
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("No files changed.");
    expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
  });

  test("fails, leaving the edit on disk, when the commit is rejected", async () => {
    // Given - a hook that rejects every commit
    repo.installFailingHook({ output: "hook says no" });

    // When - verifying a record
    const code = await runIn(["--yes", "docs/decisions/a.md"]);

    // Then - the hook's output, and the file still edited
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain(
      "the commit failed:\n[okf-verify] hook says no"
    );
    expect(repo.read("docs/decisions/a.md")).toContain("status: stable");
  });

  test("restores every record when one can't be written", async () => {
    // Given - two drafts, the second read-only
    chmodSync(path.join(repo.root, "docs/references/d.md"), 0o444);

    // When - verifying both
    const code = await runIn([
      "--yes",
      "docs/decisions/a.md",
      "docs/references/d.md",
    ]);

    // Then - a failure naming it, no "verified" lines, and the first untouched
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("Couldn't write docs/references/d.md");
    expect(infos.some((line) => line.includes("verified "))).toBe(false);
    expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
  });

  test("reports an unexpected error instead of throwing", async () => {
    // Given - a record that can't be read
    chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

    // When - verifying it
    const code = await runIn(["--yes", "docs/decisions/a.md"]);

    // Then - the error, as a failure
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("EACCES");
  });
});
