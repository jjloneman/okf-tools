import { describe, expect, test, vi } from "vitest";

import { record, useTestRepo } from "#test/repo";

import { runCheck } from "./check.ts";
import { EXIT_CODES } from "./exit-codes.ts";

// Stands in for git failing to say which commits a record's history holds
// after it read every history, which no real test machine shows; every
// other call runs git for real.
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
  test("says so, and judges only uncommitted changes", () => {
    // Given - a record, then a commit to its source, then uncommitted
    // changes to a second source
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
    repo.write("src/a.ts", "a2\n");
    repo.commitAll("edit a");
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
    });

    // Then - the failure on stderr, and a warning for the uncommitted
    // source alone
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      "Couldn't tell which commits are in the history of kb/a.md: rev-list failed; the source rules skip it.",
    ]);
    expect(infos).toStrictEqual([
      expect.stringMatching(
        /^kb\/a\.md:4: warning T007 source-changed: source \.\.\/src\/b\.ts has uncommitted changes /u
      ),
      "2 files checked: 0 errors, 1 warning, 0 info.",
    ]);
  });
});
