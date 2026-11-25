import { describe, expect, test, vi } from "vitest";

import { useTestRepo } from "#test/repo";

import { commitFiles } from "./git.ts";

// Stands in for git failing to read back a commit it just made, which no
// real test machine shows; every other call runs git for real.
vi.mock(import("node:child_process"), async (importOriginal) => {
  const original = await importOriginal();

  return {
    ...original,
    execFileSync: ((...args: Parameters<typeof original.execFileSync>) => {
      if (args[1]?.includes("rev-parse") === true) {
        throw new Error("rev-parse failed");
      }

      return original.execFileSync(...args);
    }) as typeof original.execFileSync,
  };
});

const { repo } = useTestRepo();

describe("commitFiles when the new commit's hash can't be read", () => {
  test("still reports the commit, with the hash unknown", () => {
    // Given - a new file
    repo.write("a.md", "a\n");

    // When - committing it
    const result = commitFiles({
      filePaths: ["a.md"],
      message: "add a",
      repoRoot: repo.root,
    });

    // Then - committed, since git made the commit
    expect(result).toStrictEqual({ hash: "(hash unknown)", isOk: true });
    expect(repo.git("status", "--porcelain")).toBe("");
  });
});
