import { describe, expect, test, vi } from "vitest";

import { record, useTestRepo } from "#test/repo";

import { runCheck } from "./check.ts";
import { EXIT_CODES } from "./exit-codes.ts";

// Stands in for git failing to place a record's commits, which no real
// test machine shows; every other call runs git for real.
vi.mock(import("node:child_process"), async (importOriginal) => {
  const original = await importOriginal();

  return {
    ...original,
    execFileSync: ((...args: Parameters<typeof original.execFileSync>) => {
      if (args[1]?.includes("--stdin") === true) {
        throw new Error("rev-list failed");
      }

      return original.execFileSync(...args);
    }) as typeof original.execFileSync,
  };
});

const { repo } = useTestRepo();

describe("runCheck when git can't place a source's commits", () => {
  test("says so, and skips the record", () => {
    // Given - a record, then its source changed on a branch merged back with
    // a merge commit, and uncommitted changes to a second source
    repo.write("kb/index.md", '---\nokf_version: "0.3"\n---\n# KB\n');
    repo.write("src/a.ts", "a\n");
    repo.write("src/b.ts", "b\n");
    repo.write(
      "kb/a.md",
      record([
        "type: Decision",
        "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
        "sources: [{ resource: ../src/a.ts }, { resource: ../src/b.ts }]",
      ])
    );
    repo.commitAll("add the record");
    repo.git("switch", "--quiet", "-c", "side");
    repo.write("src/a.ts", "a2\n");
    repo.commitAll("edit a");
    repo.git("switch", "--quiet", "main");
    repo.write("c.md", "c\n");
    repo.commitAll("add c");
    repo.git("merge", "--quiet", "--no-ff", "--no-edit", "side");
    repo.write("src/b.ts", "b2\n");
    const errors: string[] = [];
    const infos: string[] = [];

    // When - checking it
    const code = runCheck({
      context: {
        bundleDirs: ["kb"],
        cwd: repo.root,
        excludeGlobs: [],
        output: {
          data: () => undefined,
          error: (message) => errors.push(message),
          info: (message) => infos.push(message),
        },
        repoRoot: repo.root,
      },
      drafts: undefined,
      format: "text",
      houseRules: {},
      isChanged: false,
      isFix: false,
      isGitHubActions: false,
      isStrict: false,
      reviewFile: undefined,
    });

    // Then - the failure on stderr, and no source finding on the record
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      "Couldn't tell which commits are in the history of kb/a.md: rev-list failed; the source rules skip it.",
    ]);
    expect(infos).toStrictEqual([
      "2 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });
});
