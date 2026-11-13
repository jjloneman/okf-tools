import { describe, expect, test, vi } from "vitest";

import { findRepoRoot } from "./git.ts";

const { failure } = vi.hoisted(() => ({
  failure: { error: new Error("unset") },
}));

// Stands in for git failing in ways no real test machine shows.
vi.mock(import("node:child_process"), () => ({
  execFileSync: () => {
    throw failure.error;
  },
}));

describe("findRepoRoot when git can't run", () => {
  test("says git is missing rather than blaming the directory", () => {
    // Given - no git binary
    failure.error = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
    });

    // When/Then - the missing binary named
    expect(findRepoRoot("/")).toStrictEqual({
      isOk: false,
      reason: "git isn't installed, or isn't on PATH.",
    });
  });

  test("says git failed when it printed nothing", () => {
    // Given - a failure with no stderr
    failure.error = new Error("killed");

    // When/Then - a generic reason
    expect(findRepoRoot("/")).toStrictEqual({
      isOk: false,
      reason: "Couldn't find the repo root: git failed",
    });
  });
});
