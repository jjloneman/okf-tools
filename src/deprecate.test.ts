import { chmodSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { record, useTestRepo, verifiedRecord } from "#test/repo";

import type { DeprecateOptions } from "./options.ts";
import type { Output } from "./output.ts";
import type { BundleContext } from "./run-context.ts";

import { runDeprecate } from "./deprecate.ts";
import { EXIT_CODES } from "./exit-codes.ts";

const { repo } = useTestRepo();

const AT = "2026-11-25T10:00:00Z";
const BY = "claude-code/2.2.0";

/** A fabricated draft. */
const DRAFT = record([
  "type: Decision",
  "status: draft",
  "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
]);

/** The draft, deprecated now by `BY`. */
const DEPRECATED = record([
  "type: Decision",
  "status: deprecated",
  `generated: { by: ${BY}, at: ${AT} }`,
]);

/** A fabricated record whose `status` is a list, which deprecate refuses. */
const REFUSED = record(["type: Decision", "status: [stable]"]);

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

/** Run `okf deprecate` over two bundles, from `cwd` (the repo root). */
function deprecate(
  options: Partial<{ cwd: string } & DeprecateOptions> = {}
): number {
  const { cwd = repo.root, ...overrides } = options;
  const context: BundleContext = {
    bundleDirs: ["docs/decisions", "docs/references"],
    cwd,
    excludeGlobs: [],
    output: collectOutput(),
    repoRoot: repo.root,
  };

  return runDeprecate({
    context,
    options: {
      bundles: [],
      by: BY,
      recordPaths: ["docs/decisions/a.md"],
      supersededBy: undefined,
      ...overrides,
    },
  });
}

describe("runDeprecate", () => {
  test("deprecates each record, and says so", () => {
    // Given - a draft and a signed-off record
    repo.write("docs/decisions/a.md", DRAFT);
    repo.write(
      "docs/decisions/b.md",
      verifiedRecord({ by: "human:jjloneman", title: "B" })
    );

    // When - deprecating both
    const code = deprecate({
      recordPaths: ["docs/decisions/a.md", "docs/decisions/b.md"],
    });

    // Then - both deprecated and re-stamped, the sign-off kept
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      "Deprecated docs/decisions/a.md.",
      "Deprecated docs/decisions/b.md.",
    ]);
    expect(repo.read("docs/decisions/a.md")).toBe(DEPRECATED);
    expect(repo.read("docs/decisions/b.md")).toBe(
      record([
        "type: Decision",
        'title: "B"',
        "status: deprecated",
        `generated: { by: ${BY}, at: ${AT} }`,
        "verified: { by: human:jjloneman, at: 2026-10-02T13:30:00Z }",
      ])
    );
  });

  test("names the replacement from the bundle root", () => {
    // Given - a draft, and the record that replaces it in a subfolder
    repo.write("docs/decisions/a.md", DRAFT);
    repo.write("docs/decisions/new/b.md", DRAFT);

    // When - deprecating it from the bundle, naming the replacement
    const code = deprecate({
      cwd: path.join(repo.root, "docs/decisions"),
      recordPaths: ["a.md"],
      supersededBy: "new/b.md",
    });

    // Then - deprecated, with superseded_by after its status
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "Deprecated docs/decisions/a.md, superseded by /new/b.md.",
    ]);
    expect(repo.read("docs/decisions/a.md")).toBe(
      record([
        "type: Decision",
        "status: deprecated",
        "superseded_by: /new/b.md",
        `generated: { by: ${BY}, at: ${AT} }`,
      ])
    );
  });

  test.each([
    {
      description: "a replacement that isn't a record",
      reason:
        "--superseded-by: docs/decisions/index.md isn't a record in docs/decisions, docs/references.",
      supersededBy: "docs/decisions/index.md",
    },
    {
      description: "a replacement with no frontmatter",
      reason:
        "--superseded-by: docs/decisions/notes.md has no frontmatter block.",
      supersededBy: "docs/decisions/notes.md",
    },
    {
      description: "a replacement that's one of the records",
      reason: "docs/decisions/a.md can't supersede itself.",
      supersededBy: "docs/decisions/a.md",
    },
    {
      description: "a replacement in another bundle",
      reason:
        "docs/references/c.md isn't in the same bundle as every record it replaces.",
      supersededBy: "docs/references/c.md",
    },
  ])("refuses $description", ({ reason, supersededBy }) => {
    // Given - a draft in each bundle
    repo.write("docs/decisions/a.md", DRAFT);
    repo.write("docs/references/c.md", DRAFT);
    repo.write("docs/decisions/notes.md", "# Notes\n");

    // When - deprecating it with the replacement
    const code = deprecate({ supersededBy });

    // Then - refused, nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([reason]);
    expect(repo.read("docs/decisions/a.md")).toBe(DRAFT);
  });

  test("writes nothing when any record refuses", () => {
    // Given - a draft, and a record deprecate refuses
    repo.write("docs/decisions/a.md", DRAFT);
    repo.write("docs/decisions/b.md", REFUSED);

    // When - deprecating both
    const code = deprecate({
      recordPaths: ["docs/decisions/a.md", "docs/decisions/b.md"],
    });

    // Then - the refusal, and neither written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/b.md: `status` isn't a single value; edit the record by hand",
      "Nothing was written.",
    ]);
    expect(infos).toStrictEqual([]);
    expect(repo.read("docs/decisions/a.md")).toBe(DRAFT);
    expect(repo.read("docs/decisions/b.md")).toBe(REFUSED);
  });

  test("refuses a file without frontmatter", () => {
    // Given - a Markdown file with no frontmatter block
    repo.write("docs/decisions/a.md", "# Notes\n");

    // When - deprecating it
    const code = deprecate();

    // Then - refused, the file as it was
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/a.md has no frontmatter block.",
      "Nothing was written.",
    ]);
  });

  test("refuses a path that isn't a record", () => {
    // When - deprecating an index
    const code = deprecate({ recordPaths: ["docs/decisions/index.md"] });

    // Then - refused
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/index.md isn't a record in docs/decisions, docs/references.",
    ]);
  });

  test("refuses a --by that isn't an actor", () => {
    // Given - a draft
    repo.write("docs/decisions/a.md", DRAFT);

    // When - deprecating it by a name with a space
    const code = deprecate({ by: "claude code" });

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
      // When - deprecating it
      const code = deprecate();

      // Then - why, and nothing changed
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(
          /^Couldn't write docs\/decisions\/a\.md: EACCES[^\n]*\nNo files changed\.$/u
        ),
      ]);
      expect(repo.read("docs/decisions/a.md")).toBe(DRAFT);
    } finally {
      chmodSync(filePath, 0o644);
    }
  });
});
