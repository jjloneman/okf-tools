import { DateTime } from "luxon";
import { describe, expect, test } from "vitest";

import { record } from "#test/repo";

import type { FileChange } from "./check-engine.ts";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { readSourcePaths, readStamp, SOURCE_RULES } from "./source-rules.ts";

/** When the records below were generated. */
const GENERATED_AT = "2026-10-01T15:00:00Z";

/** The record the source rules are run over. */
const RECORD_PATH = "kb/notes/a.md";

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
   * The changes git knows to each path, by path from the repo root; without
   * the record's own, it has uncommitted changes from when it was generated
   * and no commits, as a record not committed yet has.
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

  /**
   * The commits not in the history of the record's re-stamps and sign-offs,
   * by full hash, or `undefined` when git couldn't say; without it, every
   * commit the record didn't make.
   *
   * @example `[commit("a").hash]`
   */
  unseen?: readonly string[] | undefined;
}): string[] {
  const { code, paths = [], text } = params;
  const history: Record<string, readonly FileChange[]> = {
    [RECORD_PATH]: [{ at: toSeconds(GENERATED_AT), commit: undefined }],
    ...params.history,
  };
  const own = new Set(history[RECORD_PATH]?.map(({ commit }) => commit?.hash));
  const lastSeen = history[RECORD_PATH]?.find(
    ({ commit }) => commit !== undefined
  )?.commit;
  const unseen =
    "unseen" in params
      ? params.unseen
      : Object.values(history).flatMap((changes) =>
          changes.flatMap(({ commit }) =>
            commit === undefined || own.has(commit.hash) ? [] : [commit.hash]
          )
        );
  const report = buildCheckReport({
    bundles: [
      {
        bundleDir: "kb",
        files: [
          readCheckedFile({
            bundleDir: "kb",
            doesExist: (filePath) => paths.includes(filePath),
            filePath: RECORD_PATH,
            readChanges: (filePath) => history[filePath] ?? [],
            ...(unseen === undefined
              ? {}
              : {
                  readUnseenCommits: (filePath: string) =>
                    filePath === RECORD_PATH
                      ? { lastSeen, unseen: new Set(unseen) }
                      : undefined,
                }),
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

describe("readStamp", () => {
  test.each([
    { description: "no text", text: undefined },
    { description: "no frontmatter", text: "# A\n" },
    { description: "frontmatter YAML can't read", text: "---\na: [b\n---\n" },
    {
      description: "an alias with no anchor",
      text: "---\ntags: [*x]\n---\n",
    },
    {
      description: "an alias that loops back on itself",
      text: "---\ngenerated: &a [*a]\n---\n",
    },
    {
      description: "aliases that expand past the parser's limit",
      text: `---\na: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [${"*a, ".repeat(10)}*a]\nc: &c [${"*b, ".repeat(10)}*b]\nd: &d [${"*c, ".repeat(10)}*c]\ngenerated: [${"*d, ".repeat(10)}*d]\n---\n`,
    },
  ])("reads nothing from $description", ({ text }) => {
    // Given - a text with nothing to read

    // When - reading its stamp
    const stamp = readStamp(text);

    // Then - nothing
    expect(stamp).toBeUndefined();
  });

  test("reads an empty frontmatter as no generated and no verified", () => {
    // Given - a record whose frontmatter is empty
    const text = "---\n---\n# A\n";

    // When - reading its stamp
    const stamp = readStamp(text);

    // Then - neither
    expect(stamp).toBe("[null,null]");
  });

  test.each([
    {
      description: "its tags",
      edited: record([
        GENERATED,
        "verified: [{ by: human:a, at: x }]",
        "tags: [a]",
      ]),
    },
    {
      description: "generated's layout and key order",
      edited: record([
        "generated:",
        "  at: 2026-10-01T15:00:00Z",
        "  by: claude-code/1.0",
        "verified: [{ at: x, by: human:a }]",
      ]),
    },
  ])("reads a record the same with a change to $description", ({ edited }) => {
    // Given - a record, and the same record edited
    const text = record([GENERATED, "verified: [{ by: human:a, at: x }]"]);

    // When - reading both stamps
    const stamps = [readStamp(text), readStamp(edited)];

    // Then - the same
    expect(stamps[1]).toBe(stamps[0]);
  });

  test.each([
    {
      description: "re-stamped",
      edited: record([GENERATED.replace("2026-10-01", "2026-10-02")]),
    },
    {
      description: "signed off",
      edited: record([GENERATED, "verified: [{ by: human:a, at: x }]"]),
    },
  ])("reads a record $description differently", ({ edited }) => {
    // Given - a record, and the same record changed
    const text = record([GENERATED]);

    // When - reading both stamps
    const stamps = [readStamp(text), readStamp(edited)];

    // Then - different
    expect(stamps[1]).not.toBe(stamps[0]);
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
      "kb/notes/a.md": [{ at: toSeconds(GENERATED_AT), commit: commit("r") }],
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
      description:
        "a source changed before the record was written, for a record git lists no changes to",
      history: {
        "kb/notes/a.md": [],
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

  test.each([
    {
      at: "2026-09-15T00:00:00Z",
      description: "made before the record was written",
      expected:
        "4: warning source ../../src/a.ts changed in aaaaaaa, at 2026-09-15T00:00:00Z, which isn't in the history of the record's last re-stamp or sign-off, rrrrrrr; check the record still holds, then re-stamp generated with okf touch",
      record: [{ at: toSeconds(GENERATED_AT), commit: commit("r") }],
    },
    {
      at: "2026-10-05T00:00:00Z",
      description: "made after an uncommitted re-stamp's time",
      expected:
        "4: warning source ../../src/a.ts changed in aaaaaaa, at 2026-10-05T00:00:00Z, which isn't in the history of the record's last re-stamp or sign-off, rrrrrrr; check the record still holds, then re-stamp generated with okf touch",
      record: [
        { at: toSeconds("2026-10-06T00:00:00Z"), commit: undefined },
        { at: toSeconds("2026-09-01T00:00:00Z"), commit: commit("r") },
      ],
    },
  ])(
    "warns about a commit missing from the record's history, $description",
    ({ at, expected, record: own }) => {
      // Given - a record whose commits don't have its source's commit in
      // their history
      const text = concept(["sources: [{ resource: ../../src/a.ts }]"]);
      const history = {
        "kb/notes/a.md": own,
        "src/a.ts": [{ at: toSeconds(at), commit: commit("a") }],
      };

      // When - checking it
      const hits = findHits({
        code: "T007",
        history,
        paths: ["src/a.ts"],
        text,
        unseen: [commit("a").hash],
      });

      // Then - a warning naming the record's last re-stamp or sign-off
      expect(hits).toStrictEqual([expected]);
    }
  );

  test.each([
    {
      at: "2026-10-05T00:00:00Z",
      description:
        "a commit in the record's history, committed after it was written",
      record: [{ at: toSeconds(GENERATED_AT), commit: commit("r") }],
      unseen: [],
    },
    {
      at: "2026-09-20T00:00:00Z",
      description:
        "a commit missing from the record's history, before an uncommitted re-stamp's time",
      record: [
        { at: toSeconds("2026-10-06T00:00:00Z"), commit: undefined },
        { at: toSeconds("2026-09-01T00:00:00Z"), commit: commit("r") },
      ],
      unseen: [commit("a").hash],
    },
    {
      at: "2026-10-05T00:00:00Z",
      description: "a commit git couldn't place in the record's history",
      record: [{ at: toSeconds(GENERATED_AT), commit: commit("r") }],
      unseen: undefined,
    },
  ])("passes $description", ({ at, record: own, unseen }) => {
    // Given - a record citing a file whose commit came before or after it
    const text = concept(["sources: [{ resource: ../../src/a.ts }]"]);
    const history = {
      "kb/notes/a.md": own,
      "src/a.ts": [{ at: toSeconds(at), commit: commit("a") }],
    };

    // When - checking it
    const hits = findHits({
      code: "T007",
      history,
      paths: ["src/a.ts"],
      text,
      unseen,
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
