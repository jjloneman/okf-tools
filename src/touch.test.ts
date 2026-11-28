import { chmodSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { record, useTestRepo, verifiedRecord } from "#test/repo";

import type { TouchOptions } from "./options.ts";
import type { Output } from "./output.ts";
import type { BundleContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { runTouch } from "./touch.ts";

const { repo } = useTestRepo();

const AT = "2026-11-25T10:00:00Z";
const BY = "claude-code/2.2.0";

/** A fabricated draft whose `generated` an edit has made stale. */
const DRAFT = record([
  "type: Decision",
  "status: draft",
  "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
]);

/** A fabricated record whose `generated` is a list, which touch refuses. */
const REFUSED = record(["type: Decision", "generated: [claude-code/2.1.316]"]);

/** Root can write a read-only file, so the write can't fail for it. */
const isRoot = process.getuid?.() === 0;

let errors: string[];
let infos: string[];

beforeEach(() => {
  errors = [];
  infos = [];
  vi.useFakeTimers({ now: new Date(AT), toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** An output that collects its lines, with no prefix. */
function collectOutput(): Output {
  return {
    data: (text) => infos.push(text),
    error: (message) => errors.push(message),
    info: (message) => infos.push(message),
  };
}

/** Run `okf touch` over `docs/decisions`, from the repo root. */
function touch(options: Partial<TouchOptions> = {}): number {
  const context: BundleContext = {
    bundleDirs: ["docs/decisions"],
    cwd: repo.root,
    excludeGlobs: [],
    output: collectOutput(),
    repoRoot: repo.root,
  };

  return runTouch({
    context,
    options: {
      bundles: [],
      by: BY,
      reason: undefined,
      recordPaths: ["docs/decisions/a.md"],
      shouldDraft: false,
      ...options,
    },
  });
}

describe("runTouch", () => {
  test("re-stamps each record's generated, and says so", () => {
    // Given - a draft and a signed-off record
    repo.write("docs/decisions/a.md", DRAFT);
    repo.write(
      "docs/decisions/b.md",
      verifiedRecord({ by: "human:jjloneman", title: "B" })
    );

    // When - touching both
    const code = touch({
      recordPaths: ["docs/decisions/a.md", "docs/decisions/b.md"],
    });

    // Then - both re-stamped, the signed-off one still stable
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      `Re-stamped docs/decisions/a.md at ${AT}.`,
      `Re-stamped docs/decisions/b.md at ${AT}.`,
    ]);
    expect(repo.read("docs/decisions/a.md")).toBe(
      record([
        "type: Decision",
        "status: draft",
        `generated: { by: ${BY}, at: ${AT} }`,
      ])
    );
    expect(repo.read("docs/decisions/b.md")).toContain("status: stable");
    expect(repo.read("docs/decisions/b.md")).toContain(
      `generated: { by: ${BY}, at: ${AT} }`
    );
  });

  test("writes --reason at the end, and a later touch takes it out", () => {
    // Given - a draft
    repo.write("docs/decisions/a.md", DRAFT);

    // When - touching it with a reason, then again without one
    const withReason = touch({ reason: "re-checked: the spec moved" });
    const touched = repo.read("docs/decisions/a.md");
    const withoutReason = touch();

    // Then - the reason written, quoted, then taken out again
    expect([withReason, withoutReason]).toStrictEqual([
      EXIT_CODES.ok,
      EXIT_CODES.ok,
    ]);
    expect(touched).toBe(
      record([
        "type: Decision",
        "status: draft",
        `generated: { by: ${BY}, at: ${AT} }`,
        'x-okf-restamp-reason: "re-checked: the spec moved"',
      ])
    );
    expect(repo.read("docs/decisions/a.md")).toBe(
      record([
        "type: Decision",
        "status: draft",
        `generated: { by: ${BY}, at: ${AT} }`,
      ])
    );
  });

  test("sets a stable record back to draft with --draft, keeping verified", () => {
    // Given - a signed-off record
    repo.write(
      "docs/decisions/a.md",
      verifiedRecord({ by: "human:jjloneman", title: "A" })
    );

    // When - touching it with --draft
    const code = touch({ shouldDraft: true });

    // Then - a draft, re-stamped, its sign-off kept
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("docs/decisions/a.md")).toBe(
      record([
        "type: Decision",
        'title: "A"',
        "status: draft",
        `generated: { by: ${BY}, at: ${AT} }`,
        "verified: { by: human:jjloneman, at: 2026-10-02T13:30:00Z }",
      ])
    );
  });

  test("writes nothing when any record refuses", () => {
    // Given - a draft, and a record touch refuses
    repo.write("docs/decisions/a.md", DRAFT);
    repo.write("docs/decisions/b.md", REFUSED);

    // When - touching both
    const code = touch({
      recordPaths: ["docs/decisions/a.md", "docs/decisions/b.md"],
    });

    // Then - the refusal, and neither written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/b.md: `generated` isn't a mapping; edit the record by hand",
      "Nothing was written.",
    ]);
    expect(infos).toStrictEqual([]);
    expect(repo.read("docs/decisions/a.md")).toBe(DRAFT);
    expect(repo.read("docs/decisions/b.md")).toBe(REFUSED);
  });

  test("prints a refusal's control characters as spaces", () => {
    // Given - a record whose refusal quotes an escape character
    repo.write(
      "docs/decisions/a.md",
      "---\ngenerated: x\u001b[31m\n---\n# Title\n"
    );

    // When - touching it
    const code = touch();

    // Then - refused, with no escape character
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toHaveLength(2);
    expect(errors[0]).not.toContain("\u001b");
  });

  test.each([
    {
      description: "a path that isn't a record",
      reason: "docs/decisions/index.md isn't a record in docs/decisions.",
      recordPath: "docs/decisions/index.md",
    },
    {
      description: "a record that doesn't exist",
      reason: "No record at docs/decisions/missing.md.",
      recordPath: "docs/decisions/missing.md",
    },
  ])("refuses $description", ({ reason, recordPath }) => {
    // Given - a bundle with a record
    repo.write("docs/decisions/a.md", DRAFT);

    // When - touching the path
    const code = touch({ recordPaths: [recordPath] });

    // Then - refused
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([reason]);
  });

  test("refuses a file without frontmatter", () => {
    // Given - a Markdown file with no frontmatter block
    repo.write("docs/decisions/a.md", "# Notes\n");

    // When - touching it
    const code = touch();

    // Then - refused, the file as it was
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/a.md has no frontmatter block.",
      "Nothing was written.",
    ]);
    expect(repo.read("docs/decisions/a.md")).toBe("# Notes\n");
  });

  test("refuses a record that's a symlink", () => {
    // Given - a record linked to a file outside the bundle
    repo.write("elsewhere.md", DRAFT);
    repo.write("docs/decisions/a.md", DRAFT);
    rmSync(path.join(repo.root, "docs/decisions/a.md"));
    symlinkSync(
      "../../elsewhere.md",
      path.join(repo.root, "docs/decisions/a.md")
    );

    // When - touching it
    const code = touch();

    // Then - refused, the file it points to as it was
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors[0]).toMatch(
      /^docs\/decisions\/a\.md is a symlink, or inside one, to /u
    );
    expect(repo.read("elsewhere.md")).toBe(DRAFT);
  });

  test("refuses a --by that isn't an actor", () => {
    // Given - a draft
    repo.write("docs/decisions/a.md", DRAFT);

    // When - touching it by a name with a space
    const code = touch({ by: "claude code" });

    // Then - refused, the record as it was
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      '"claude code" isn\'t an actor a record can hold, such as human:jjloneman.',
    ]);
    expect(repo.read("docs/decisions/a.md")).toBe(DRAFT);
  });

  test.skipIf(isRoot)("says so when a record can't be written", () => {
    // Given - a draft no one can write
    repo.write("docs/decisions/a.md", DRAFT);
    const filePath = path.join(repo.root, "docs/decisions/a.md");
    chmodSync(filePath, 0o444);

    try {
      // When - touching it
      const code = touch();

      // Then - why, and nothing changed
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(
          /^Couldn't write docs\/decisions\/a\.md: EACCES[^\n]*\nNo files changed\.$/u
        ),
      ]);
      expect(infos).toStrictEqual([]);
      expect(repo.read("docs/decisions/a.md")).toBe(DRAFT);
    } finally {
      chmodSync(filePath, 0o644);
    }
  });
});
