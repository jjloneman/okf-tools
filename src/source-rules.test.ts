import { DateTime } from "luxon";
import { describe, expect, test } from "vitest";

import { record } from "#test/repo";

import type { FileChange } from "./check-engine.ts";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { readSourcePaths, SOURCE_RULES } from "./source-rules.ts";

/** When the records below were generated. */
const GENERATED_AT = "2026-10-01T15:00:00Z";

/** A `generated` at `GENERATED_AT`. */
const GENERATED = `generated: { by: claude-code/1.0, at: ${GENERATED_AT} }`;

/** A commit's hashes, by a letter, for a fabricated history. */
function commit(letter: string): { hash: string; shortHash: string } {
  return { hash: letter.repeat(40), shortHash: letter.repeat(7) };
}

/** A record of the type `Decision` that cites the given sources. */
function concept(lines: readonly string[]): string {
  return record(["type: Decision", GENERATED, ...lines]);
}

/**
 * Run the source rules over one record, `kb/notes/a.md`, and keep one rule's
 * findings, each as `line: severity message`.
 */
function findHits(params: {
  /**
   * The rule's code.
   *
   * @example "T007"
   */
  code: string;

  /**
   * The changes git knows to each path, by path from the repo root.
   *
   * @example `{ "src/a.ts": [{ at: toSeconds("2026-10-02T00:00:00Z"), … }] }`
   */
  history?: Record<string, readonly FileChange[]>;

  /**
   * The paths that exist, from the repo root.
   *
   * @example `["src/a.ts"]`
   */
  paths?: readonly string[];

  /**
   * The record's text.
   *
   * @example `concept(["sources: [{ resource: ../../src/a.ts }]"])`
   */
  text: string;
}): string[] {
  const { code, history = {}, paths = [], text } = params;
  const report = buildCheckReport({
    bundles: [
      {
        bundleDir: "kb",
        files: [
          readCheckedFile({
            bundleDir: "kb",
            doesExist: (filePath) => paths.includes(filePath),
            filePath: "kb/notes/a.md",
            readChanges: (filePath) => history[filePath] ?? [],
            text,
          }),
        ],
      },
    ],
    rules: SOURCE_RULES,
    skipped: [],
  });

  return report.findings
    .filter((finding) => finding.code === code)
    .map(
      ({ line, message, severity }) => `${String(line)}: ${severity} ${message}`
    );
}

/** Read a UTC date-time as whole seconds since the epoch. */
function toSeconds(value: string): number {
  return DateTime.fromISO(value, { zone: "utc" }).toSeconds();
}

describe("readSourcePaths", () => {
  test.each([
    {
      description: "a path from the record's folder, leaving the bundle",
      expected: ["src/a.ts"],
      resource: "../../src/a.ts",
    },
    {
      description: "a path from the bundle root",
      expected: ["kb/refs/a.md"],
      resource: "/refs/a.md",
    },
    {
      description: "a folder, its trailing slash dropped",
      expected: ["src"],
      resource: "../../src/",
    },
    {
      description: "a percent-encoded path, with a fragment",
      expected: ["kb/notes/my notes.md"],
      resource: "my%20notes.md#part",
    },
    {
      description: "a bad percent escape, kept as written",
      expected: ["kb/notes/100%.md"],
      resource: "100%.md",
    },
    { description: "a URL", expected: [], resource: "https://example.com/a" },
    {
      description: "a scheme-relative URL",
      expected: [],
      resource: "//example.com/a",
    },
    { description: "an anchor", expected: [], resource: "'#part'" },
    {
      description: "a scope descriptor",
      expected: [],
      resource: "all queries in project X",
    },
    {
      description: "a path that leaves the repo",
      expected: [],
      resource: "../../../a.ts",
    },
    { description: "the repo root", expected: [], resource: "../.." },
  ])("reads $description", ({ expected, resource }) => {
    // Given - a record that cites the resource
    const file = readCheckedFile({
      bundleDir: "kb",
      doesExist: () => true,
      filePath: "kb/notes/a.md",
      text: concept([`sources: [{ resource: ${resource} }]`]),
    });

    // When - reading the paths it cites
    const paths = readSourcePaths(file);

    // Then - the path in the repo, or none
    expect(paths).toStrictEqual(expected);
  });

  test.each([
    {
      description: "each path once, a bare mapping as one entry",
      expected: ["src/a.ts"],
      lines: ["sources: { resource: ../../src/a.ts }"],
    },
    {
      description: "nothing from an entry with no text resource",
      expected: ["src/a.ts"],
      lines: [
        "sources:",
        "  - resource: ../../src/a.ts",
        "  - resource: ../../src/a.ts",
        "  - resource: [a]",
        "  - title: A",
        "  - plain",
      ],
    },
    { description: "nothing from no sources", expected: [], lines: [] },
  ])("reads $description", ({ expected, lines }) => {
    // Given - a record with those sources
    const file = readCheckedFile({
      bundleDir: "kb",
      doesExist: () => true,
      filePath: "kb/notes/a.md",
      text: concept(lines),
    });

    // When - reading the paths it cites
    const paths = readSourcePaths(file);

    // Then - each path once
    expect(paths).toStrictEqual(expected);
  });

  test.each([
    {
      description: "an index.md",
      filePath: "kb/notes/index.md",
      text: concept(["sources: [{ resource: a.md }]"]),
    },
    {
      description: "a file with no frontmatter",
      filePath: "kb/notes/a.md",
      text: "# A\n",
    },
  ])("reads nothing from $description", ({ filePath, text }) => {
    // Given - a file that isn't a concept
    const file = readCheckedFile({
      bundleDir: "kb",
      doesExist: () => true,
      filePath,
      text,
    });

    // When - reading the paths it cites
    const paths = readSourcePaths(file);

    // Then - none
    expect(paths).toStrictEqual([]);
  });
});

describe("SOURCE_RULES", () => {
  test("lists each rule once, in code order", () => {
    // Given - the codes
    const codes = SOURCE_RULES.map((rule) => rule.code);

    // Then - unique and sorted
    expect(codes).toStrictEqual([...new Set(codes)].sort());
  });
});

describe("T007 source-changed", () => {
  test("warns about a source committed after the record was written", () => {
    // Given - a record citing a file with two later commits and an
    // earlier one
    const text = concept([
      "sources:",
      "  - resource: ../../src/a.ts",
      "  - resource: https://example.com/a",
    ]);
    const history = {
      "src/a.ts": [
        { at: toSeconds("2026-10-03T00:00:00Z"), commit: commit("b") },
        { at: toSeconds("2026-10-05T08:30:00Z"), commit: commit("a") },
        { at: toSeconds("2026-09-01T00:00:00Z"), commit: commit("c") },
      ],
    };

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["src/a.ts"],
      text,
    });

    // Then - a warning on the resource's line, naming the newest commit
    expect(hits).toStrictEqual([
      "5: warning source ../../src/a.ts changed in aaaaaaa, at 2026-10-05T08:30:00Z, since the record was last written or signed off, at 2026-10-01T15:00:00Z; check the record still holds, then re-stamp generated with okf touch",
    ]);
  });

  test("warns about a source with uncommitted changes", () => {
    // Given - a record citing a file with uncommitted changes
    const text = concept(["sources: [{ resource: /refs/a.md }]"]);
    const history = {
      "kb/refs/a.md": [
        { at: toSeconds("2026-10-06T00:00:00Z"), commit: undefined },
      ],
    };

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["kb/refs/a.md"],
      text,
    });

    // Then - a warning that says so
    expect(hits).toStrictEqual([
      "4: warning source /refs/a.md has uncommitted changes since the record was last written or signed off, at 2026-10-01T15:00:00Z; check the record still holds, then re-stamp generated with okf touch",
    ]);
  });

  test.each([
    {
      description: "a source changed before the record was written",
      history: {
        "src/a.ts": [{ at: toSeconds(GENERATED_AT), commit: commit("a") }],
      },
      lines: [],
    },
    {
      description: "a source changed before a later sign-off",
      history: {
        "src/a.ts": [
          { at: toSeconds("2026-10-05T00:00:00Z"), commit: commit("a") },
        ],
      },
      lines: ["verified: [{ by: human:a, at: 2026-10-06T00:00:00Z }]"],
    },
    {
      description:
        "a source changed before a later sign-off, beside one ahead of the clock",
      history: {
        "src/a.ts": [
          { at: toSeconds("2026-10-05T00:00:00Z"), commit: commit("a") },
        ],
      },
      lines: [
        "verified:",
        "  - { by: human:a, at: 2026-10-06T00:00:00Z }",
        "  - { by: human:b, at: 2999-01-01T00:00:00Z }",
      ],
    },
    {
      description: "a source changed in a commit that changed the record too",
      history: {
        "kb/notes/a.md": [
          { at: toSeconds("2026-10-05T00:00:00Z"), commit: commit("a") },
        ],
        "src/a.ts": [
          { at: toSeconds("2026-10-05T00:00:00Z"), commit: commit("a") },
        ],
      },
      lines: [],
    },
    {
      description: "uncommitted changes while the record has some too",
      history: {
        "kb/notes/a.md": [
          { at: toSeconds("2026-10-05T00:00:00Z"), commit: undefined },
        ],
        "src/a.ts": [
          { at: toSeconds("2026-10-05T00:00:00Z"), commit: undefined },
        ],
      },
      lines: [],
    },
  ])("passes $description", ({ history, lines }) => {
    // Given - a record citing the file
    const text = concept(["sources: [{ resource: ../../src/a.ts }]", ...lines]);

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["src/a.ts"],
      text,
    });

    // Then - nothing
    expect(hits).toStrictEqual([]);
  });

  test("ignores a generated.at ahead of the clock", () => {
    // Given - a record generated in the future, signed off in 2026, citing a
    // file changed since the sign-off
    const text = record([
      "type: Decision",
      "generated: { by: claude-code/1.0, at: 2999-01-01T00:00:00Z }",
      "verified: [{ by: human:a, at: 2026-10-02T00:00:00Z }]",
      "sources: [{ resource: ../../src/a.ts }]",
    ]);
    const history = {
      "src/a.ts": [
        { at: toSeconds("2026-10-05T00:00:00Z"), commit: commit("a") },
      ],
    };

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["src/a.ts"],
      text,
    });

    // Then - the change still warns, against the sign-off
    expect(hits).toStrictEqual([
      "5: warning source ../../src/a.ts changed in aaaaaaa, at 2026-10-05T00:00:00Z, since the record was last written or signed off, at 2026-10-02T00:00:00Z; check the record still holds, then re-stamp generated with okf touch",
    ]);
  });

  test("ignores a sign-off ahead of the clock", () => {
    // Given - a record signed off in the future, citing a file changed since
    // it was generated
    const text = concept([
      "sources: [{ resource: ../../src/a.ts }]",
      "verified: [{ by: human:a, at: 2999-01-01T00:00:00Z }]",
    ]);
    const history = {
      "src/a.ts": [
        { at: toSeconds("2026-10-05T00:00:00Z"), commit: commit("a") },
      ],
    };

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["src/a.ts"],
      text,
    });

    // Then - the change still warns, against generated.at
    expect(hits).toStrictEqual([
      "4: warning source ../../src/a.ts changed in aaaaaaa, at 2026-10-05T00:00:00Z, since the record was last written or signed off, at 2026-10-01T15:00:00Z; check the record still holds, then re-stamp generated with okf touch",
    ]);
  });

  test("passes a record with no time it was written or signed off", () => {
    // Given - a record with no readable generated.at or verified.at
    const text = record([
      "type: Decision",
      "generated: { by: claude-code/1.0, at: soon }",
      "verified: [{ by: human:a }]",
      "sources: [{ resource: ../../src/a.ts }]",
    ]);
    const history = {
      "src/a.ts": [{ at: toSeconds(GENERATED_AT), commit: commit("a") }],
    };

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["src/a.ts"],
      text,
    });

    // Then - nothing to compare with
    expect(hits).toStrictEqual([]);
  });
});

describe("T008 source-gone", () => {
  test("fails a source git history has but the working tree doesn't", () => {
    // Given - a record citing a deleted file, a file that exists, and one
    // that never did
    const text = concept([
      "sources:",
      "  - resource: ../../src/gone.ts",
      "  - resource: ../../src/a.ts",
      "  - resource: ../../src/never.ts",
    ]);
    const change = {
      at: toSeconds("2026-09-01T00:00:00Z"),
      commit: commit("a"),
    };

    // When - checking it
    const hits = findHits({
      code: "T008",
      history: { "src/a.ts": [change], "src/gone.ts": [change] },
      paths: ["src/a.ts"],
      text,
    });

    // Then - an error about the deleted one alone
    expect(hits).toStrictEqual([
      "5: error source ../../src/gone.ts no longer exists, though git history has it; cite where it is now, or remove the source",
    ]);
  });
});
