import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TestRepo } from "#test/repo";

import { createTestRepo, draftRecord, record } from "#test/repo";

import { applyVerification } from "./apply.ts";
import { getRecordState, readRecordSummary } from "./okf-frontmatter.ts";

const VERIFIED_BY = "human:jjloneman";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo();
});

afterEach(() => {
  repo.remove();
});

describe("applyVerification", () => {
  test("writes nothing when a record refuses the edit at write time", () => {
    // Given - a plan holding a record the edits refuse, which listing would
    // have left out, beside a good one
    const refused = record(["status: draft", "verified: someone"]);

    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", refused);

    const candidates = [
      { filePath: "docs/decisions/a.md", text: draftRecord("A") },
      { filePath: "docs/decisions/b.md", text: refused },
    ].map(({ filePath, text }) => {
      const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

      if (summary === undefined) {
        throw new Error(`${filePath} has no frontmatter`);
      }

      return { filePath, state: getRecordState(summary), summary, text };
    });

    // When - applying the plan
    const outcome = applyVerification({
      context: {
        repoRoot: repo.root,
        shouldCommit: false,
        verifiedBy: VERIFIED_BY,
      },
      plan: {
        candidates,
        dirtyPaths: [],
        filePaths: candidates.map(({ filePath }) => filePath),
        message: "docs(okf): ✅ verify 2 records",
      },
    });

    // Then - not written, naming the refusal, and the good record untouched
    expect(outcome).toStrictEqual({
      kind: "notWritten",
      message:
        "No files changed.\ndocs/decisions/b.md: `verified` holds a single value, not an entry or a list; edit the record by hand",
    });
    expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
  });
});
