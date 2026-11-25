import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { draftRecord, record, useTestRepo, VERIFIED_BY } from "#test/repo";

import type { Candidate } from "./records.ts";

import { applyVerification, planVerification } from "./apply.ts";
import { getRecordState, readRecordSummary } from "./frontmatter/read.ts";
import { loadCandidatesAt } from "./repo.ts";

const { repo } = useTestRepo();

/** Build the candidate a record's text would be listed as. */
function toCandidate(params: { filePath: string; text: string }): Candidate {
  const { filePath, text } = params;
  const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

  if (summary === undefined) {
    throw new Error(`${filePath} has no frontmatter`);
  }

  return { filePath, state: getRecordState(summary), summary, text };
}

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
    ].map(toCandidate);

    // When - applying the plan
    const outcome = applyVerification({
      context: {
        repoRoot: repo.root,
        shouldCommit: false,
        style: "match",
        verifiedBy: VERIFIED_BY,
      },
      plan: {
        candidates,
        dirtyPaths: [],
        filePaths: candidates.map(({ filePath }) => filePath),
        message: "docs(okf): ✅ verify 2 records",
        uncommitted: [],
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

  test("writes nothing when a record no longer reads as UTF-8", () => {
    // Given - a record listed as UTF-8, then saved as Latin-1
    repo.write("docs/decisions/a.md", draftRecord("A"));

    const candidates = [
      toCandidate({ filePath: "docs/decisions/a.md", text: draftRecord("A") }),
    ];
    const latin1 = Buffer.concat([
      Buffer.from(draftRecord("A")),
      Buffer.from([0xe9, 0x0a]),
    ]);

    writeFileSync(path.join(repo.root, "docs/decisions/a.md"), latin1);

    // When - applying the plan
    const outcome = applyVerification({
      context: {
        repoRoot: repo.root,
        shouldCommit: false,
        style: "match",
        verifiedBy: VERIFIED_BY,
      },
      plan: {
        candidates,
        dirtyPaths: [],
        filePaths: ["docs/decisions/a.md"],
        message: "docs(okf): ✅ verify 1 record",
        uncommitted: [],
      },
    });

    // Then - not written, and the record's bytes left alone
    expect(outcome).toStrictEqual({
      kind: "notWritten",
      message:
        "docs/decisions/a.md changed on disk since it was read; nothing written.",
    });
    expect(
      readFileSync(path.join(repo.root, "docs/decisions/a.md"))
    ).toStrictEqual(latin1);
  });

  test("writes nothing when a record was deleted since it was listed", () => {
    // Given - a record listed, then deleted
    repo.write("docs/decisions/a.md", draftRecord("A"));

    const candidates = [
      toCandidate({ filePath: "docs/decisions/a.md", text: draftRecord("A") }),
    ];

    rmSync(path.join(repo.root, "docs/decisions/a.md"));

    // When - applying the plan
    const outcome = applyVerification({
      context: {
        repoRoot: repo.root,
        shouldCommit: false,
        style: "match",
        verifiedBy: VERIFIED_BY,
      },
      plan: {
        candidates,
        dirtyPaths: [],
        filePaths: ["docs/decisions/a.md"],
        message: "docs(okf): ✅ verify 1 record",
        uncommitted: [],
      },
    });

    // Then - not written, and no file put back in its place
    expect(outcome).toHaveProperty("kind", "notWritten");
    expect(outcome).toHaveProperty(
      "message",
      expect.stringMatching(
        /^docs\/decisions\/a\.md can't be read any more: ENOENT[^\n]*\nNo files changed\.$/u
      )
    );
    expect(existsSync(path.join(repo.root, "docs/decisions/a.md"))).toBe(false);
  });
});

describe("applyVerification, given a record replaced by a symlink", () => {
  test("writes nothing through a link swapped in after listing", () => {
    // Given - a listed draft, since replaced by a link to the same text
    repo.write("drafts/real.md", draftRecord("A"));
    mkdirSync(path.join(repo.root, "docs/decisions"), { recursive: true });
    symlinkSync(
      "../../drafts/real.md",
      path.join(repo.root, "docs/decisions/a.md")
    );

    const candidates = [
      toCandidate({ filePath: "docs/decisions/a.md", text: draftRecord("A") }),
    ];

    // When - applying the plan
    const outcome = applyVerification({
      context: {
        repoRoot: repo.root,
        shouldCommit: false,
        style: "match",
        verifiedBy: VERIFIED_BY,
      },
      plan: {
        candidates,
        dirtyPaths: [],
        filePaths: ["docs/decisions/a.md"],
        message: "docs(okf): ✅ verify 1 record",
        uncommitted: [],
      },
    });

    // Then - counted as changed, and the linked file left alone
    expect(outcome).toStrictEqual({
      kind: "notWritten",
      message:
        "docs/decisions/a.md changed on disk since it was read; nothing written.",
    });
    expect(repo.read("drafts/real.md")).toBe(draftRecord("A"));
  });
});

describe("planVerification", () => {
  test("warns about a record git reported in another Unicode form", () => {
    // Given - a draft whose name is decomposed, reported by git composed
    const filePath = "docs/decisions/cafe\u0301.md";

    repo.write(filePath, draftRecord("Cafe"));

    const { candidates } = loadCandidatesAt({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: [],
      filePaths: [filePath],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // When - planning its sign-off
    const plan = planVerification({
      context: { bundleDirs: ["docs/decisions"], shouldCommit: true },
      selected: candidates,
      statusPaths: new Set(["docs/decisions/caf\u00e9.md"]),
    });

    // Then - warned about, under the disk's spelling
    expect(plan.dirtyPaths).toStrictEqual([filePath]);
  });
});
