import fc from "fast-check";
import { DateTime } from "luxon";
import { afterEach, describe, expect, test, vi } from "vitest";

import { NEAR_MISSES, VERIFIED_BY } from "#test/repo";

import {
  findFrontmatterProblem,
  getRecordState,
  getTrustTier,
  isGeneratedAhead,
  isStale,
  isVerifiedAhead,
  readRecordSummary,
  readStatusText,
} from "./read.ts";

const AT = "2026-10-02T13:30:00Z";
const BODY = "\n# Title\n\nBody text.\n";
const NOW = "2026-11-20T12:00:00.400Z";

function record(frontmatter: string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

const DRAFT_LINES = [
  "type: Decision",
  'title: "What every export promises"',
  "status: draft",
  "generated: { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
];

describe("findFrontmatterProblem", () => {
  test.each([
    { description: "valid frontmatter", text: record(["type: Decision"]) },
    { description: "no frontmatter block", text: "# Title\n" },
    { description: "an empty file", text: "" },
    { description: "only blank lines", text: "\n \n\t\n" },
    {
      description: "a byte order mark before a clean block",
      text: `\uFEFF${record(["type: Decision"])}`,
    },
  ])("finds nothing wrong with $description", ({ text }) => {
    // When/Then - no problem
    expect(findFrontmatterProblem(text)).toBeUndefined();
  });

  test.each(NEAR_MISSES)(
    "explains a near-miss block: $description",
    ({ problem, text }) => {
      // When/Then - what's wrong with the fences
      expect(findFrontmatterProblem(text)).toBe(problem);
    }
  );

  test("never takes a file that opens with `---` for one with no frontmatter", () => {
    // Given - files built from fence-like lines, blanks, and every line break
    const line = fc.constantFrom(
      "",
      " ",
      "\t",
      "---",
      " ---",
      "--- ",
      "---\t",
      "----",
      "...",
      "type: Decision"
    );
    const text = fc
      .tuple(
        fc.constantFrom("", "\uFEFF"),
        fc.array(fc.tuple(line, fc.constantFrom("\n", "\r\n", "\r")), {
          maxLength: 6,
        })
      )
      .map(([start, lines]) => `${start}${lines.flat().join("")}`);

    // When/Then - one whose first non-blank line opens with `---` is read as
    // a block or reported, never neither
    fc.assert(
      fc.property(text, (candidate) => {
        const firstLine = candidate
          .replace(/^\uFEFF/u, "")
          .split(/\r\n|\n|\r/u)
          .map((each) => each.replace(/^[\t ]+|[\t ]+$/gu, ""))
          .find((each) => each !== "");

        return (
          firstLine?.startsWith("---") !== true ||
          findFrontmatterProblem(candidate) !== undefined ||
          readRecordSummary({ text: candidate, verifiedBy: VERIFIED_BY }) !==
            undefined
        );
      }),
      { numRuns: 1000, seed: 31 }
    );
  });

  test("explains frontmatter that isn't valid YAML", () => {
    // Given - a duplicated key
    const text = record(["type: Decision", "type: Again"]);

    // When/Then - the parser's reason
    expect(findFrontmatterProblem(text)).toMatch(
      /^frontmatter isn't valid YAML: /u
    );
  });
});

describe("readRecordSummary", () => {
  test.each([
    { by: "claude-code/2.1.316", description: "a CLI version" },
    { by: "claude-code/claude-opus-5-5", description: "a model id" },
  ])(
    "reads generated.at whatever generated.by names, such as $description",
    ({ by }) => {
      // Given - a draft whose generator is named either way
      const text = record([
        "type: Decision",
        "status: draft",
        `generated: { by: ${by}, at: 2026-10-01T15:00:00Z }`,
      ]);

      // When - reading its summary
      const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

      // Then - the timestamp, with the actor's form not mattering
      expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
    }
  );

  test("keeps a title whole when a line separator stops the comment split", () => {
    // Given - an unquoted title holding U+2028, which `.` doesn't match
    const title = "Before\u2028after";
    const text = record(["type: Decision", `title: ${title}`]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the raw value, separator included
    expect(summary?.title).toBe(title);
  });

  test("reads the fields the checklist shows", () => {
    // Given - a verified record
    const text = record([
      ...DRAFT_LINES,
      `verified: { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z }`,
      "stale_after: 2027-01-01T00:00:00Z",
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the checklist fields come back
    expect(summary).toStrictEqual({
      description: undefined,
      generatedAt: "2026-10-01T15:00:00Z",
      staleAfter: "2027-01-01T00:00:00Z",
      status: "draft",
      tags: [],
      title: "What every export promises",
      type: "Decision",
      verifications: [{ at: "2026-09-28T09:00:00Z", by: VERIFIED_BY }],
      verifiedAt: "2026-09-28T09:00:00Z",
      writtenStatus: "draft",
    });
  });

  test("reads the owner's timestamp out of a list, ignoring other people's", () => {
    // Given - a list that holds another person's entry first
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
      `  - { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - only the owner's timestamp is read
    expect(summary?.verifiedAt).toBe("2026-09-28T09:00:00Z");
  });

  test.each([
    {
      description: "the latest of the owner's entries",
      entries: ["2026-09-01T00:00:00Z", "2026-10-05T00:00:00Z", "~"],
      expected: "2026-10-05T00:00:00Z",
    },
    {
      description: "the first of two equal latest entries",
      entries: ["2026-10-05T00:00:00Z", "'2026-10-05T00:00:00.000Z'"],
      expected: "2026-10-05T00:00:00Z",
    },
    {
      description: "a readable entry past an unreadable one",
      entries: ["soon", "2026-09-01T00:00:00Z"],
      expected: "2026-09-01T00:00:00Z",
    },
    {
      description: "the first entry when none reads",
      entries: ["soon", "later"],
      expected: "soon",
    },
  ])("reads $description", ({ entries, expected }) => {
    // Given - several entries by the owner
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      ...entries.map((at) => `  - { by: ${VERIFIED_BY}, at: ${at} }`),
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the entry that counts is read
    expect(summary?.verifiedAt).toBe(expected);
  });

  test("reads generated.at out of a nested generated block", () => {
    // Given - a generated field written as a nested block
    const text = record([
      "status: draft",
      "generated:",
      "  by: claude-code/model",
      "  at: 2026-10-01T15:00:00Z",
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the timestamp is found inside the block
    expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
  });

  test("reads generated.at past an actor id that holds at:", () => {
    // Given - a generator whose id spells at: inside its value
    const text = record([
      "status: stable",
      "generated: { by: svc@at:prod, at: 2026-10-01T15:00:00Z }",
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the real timestamp, not the actor's tail
    expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
  });

  test("reads the owner's timestamp when at comes before by", () => {
    // Given - the owner's entry with its keys reversed
    const text = record([
      "status: stable",
      `verified: { at: 2026-09-28T09:00:00Z, by: ${VERIFIED_BY} }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the owner's timestamp
    expect(summary?.verifiedAt).toBe("2026-09-28T09:00:00Z");
  });

  test.each([
    {
      description: "a single-quoted title with '' escapes",
      expected: "It's working",
      title: "'It''s working'",
    },
    {
      description: String.raw`a double-quoted title with \" escapes`,
      expected: String.raw`Say "hi" \ bye`,
      title: String.raw`"Say \"hi\" \\ bye"`,
    },
    {
      description: "a double-quoted title with YAML's other escapes",
      expected: "Café\tA😀/",
      title: String.raw`"Caf\u00e9\t\x41\U0001F600\/"`,
    },
    {
      description: "a double-quoted title with escapes YAML doesn't define",
      expected: String.raw`\q \U00110000`,
      title: String.raw`"\q \U00110000"`,
    },
    {
      description: "a quoted title followed by a comment",
      expected: "Kept",
      title: "'Kept' # note",
    },
  ])("reads $description whole", ({ expected, title }) => {
    // Given - a record whose title uses YAML's quoting
    const text = record(["type: Decision", `title: ${title}`]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the title, unescaped
    expect(summary?.title).toBe(expected);
  });

  test.each([
    {
      description: "a nested block with a deeper at: first",
      lines: [
        "generated:",
        "  source:",
        "    at: 2020-01-01T00:00:00Z",
        "  at: 2026-10-01T15:00:00Z",
      ],
    },
    {
      description: "a flow mapping spread over two lines",
      lines: [
        "generated: { by: claude-code/model,",
        "  at: 2026-10-01T15:00:00Z }",
      ],
    },
  ])("reads generated's own at: out of $description", ({ lines }) => {
    // Given - a generated field written that way
    const text = record(["status: stable", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - generated's own timestamp
    expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
  });

  test.each([
    {
      description: "a nested block without at:",
      lines: ["generated:", "  by: x"],
    },
    { description: "a malformed flow mapping", lines: ["generated: { by x }"] },
    { description: "a null at", lines: ["generated: { by: x, at: null }"] },
  ])("reads no generated.at out of $description", ({ lines }) => {
    // Given - a generated field with no usable timestamp
    const text = record(["status: stable", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - no timestamp
    expect(summary?.generatedAt).toBeUndefined();
  });

  test.each([
    { description: "no at key", entry: `{ by: ${VERIFIED_BY} }` },
    { description: "an empty at", entry: `{ by: ${VERIFIED_BY}, at: "" }` },
  ])("reads the owner's entry with $description as unverified", ({ entry }) => {
    // Given - the owner's entry without a timestamp
    const text = record(["status: stable", `verified: ${entry}`]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - no sign-off time
    expect(summary?.verifiedAt).toBeUndefined();
  });

  test("reads generated.at past a comment indented less than its keys", () => {
    // Given - a nested generated block opening with a shallow comment
    const text = record([
      "status: stable",
      "generated:",
      " # produced by the docs agent",
      "  by: claude-code/model",
      "  at: 2026-10-01T15:00:00Z",
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the timestamp under generated
    expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
  });

  test.each([
    { description: "NULL", value: "NULL" },
    { description: "Null", value: "Null" },
  ])("reads an owner's at: $description as no sign-off", ({ value }) => {
    // Given - the owner's entry with a null timestamp, and no generated
    const text = record([
      "status: stable",
      `verified: { by: ${VERIFIED_BY}, at: ${value} }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - unverified, not verified at "NULL"
    expect(summary === undefined ? undefined : getRecordState(summary)).toBe(
      "unverified"
    );
  });

  test("reads a quoted null at as the text it is", () => {
    // Given - the owner's entry whose at is the quoted string "null"
    const text = record([
      "status: stable",
      `verified: { by: ${VERIFIED_BY}, at: "null" }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - a timestamp of "null", the same rule the edits follow
    expect(summary?.verifiedAt).toBe("null");
  });

  test.each([
    {
      description: "the signer's by",
      lines: [`me: &m ${VERIFIED_BY}`, `verified: { by: *m, at: ${AT} }`],
    },
    {
      description: "the signer's at",
      lines: [`when: &t ${AT}`, `verified: { by: ${VERIFIED_BY}, at: *t }`],
    },
    {
      description: "the signer's entry",
      lines: [`mine: &e { by: ${VERIFIED_BY}, at: ${AT} }`, "verified: [*e]"],
    },
    {
      description: "the verified field",
      lines: [`mine: &v { by: ${VERIFIED_BY}, at: ${AT} }`, "verified: *v"],
    },
  ])("reads the sign-off through an alias for $description", ({ lines }) => {
    // Given - the owner's sign-off reached through an alias
    const text = record(["status: stable", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the sign-off found, as the YAML means it
    expect(summary?.verifiedAt).toBe(AT);
  });

  test("reads generated, status, title, and type through aliases", () => {
    // Given - every read field written as an alias
    const text = record([
      "defs:",
      "  - &g { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
      "  - &s draft",
      "  - &t What every export promises",
      "  - &k Decision",
      "generated: *g",
      "status: *s",
      "title: *t",
      "type: *k",
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - each read as what its anchor names
    expect(summary).toStrictEqual({
      description: undefined,
      generatedAt: "2026-10-01T15:00:00Z",
      staleAfter: undefined,
      status: "draft",
      tags: [],
      title: "What every export promises",
      type: "Decision",
      verifications: [],
      verifiedAt: undefined,
      writtenStatus: "draft",
    });
  });

  test("reads the owner's block-style timestamp, not a nested child's", () => {
    // Given - the owner's block entry whose only at: is under a child key
    const text = record([
      "status: stable",
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      "    source:",
      "      at: 2020-01-01T00:00:00Z",
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - no sign-off time
    expect(summary?.verifiedAt).toBeUndefined();
  });

  test.each([
    {
      description: "a flow mapping holding a list",
      lines: ["generated: { by: x, at: 2026-10-01T15:00:00Z, tools: [a] }"],
    },
    {
      description: "a flow mapping on the next line",
      lines: ["generated:", "  { by: x, at: 2026-10-01T15:00:00Z }"],
    },
  ])("reads generated.at out of $description", ({ lines }) => {
    // Given - a generated field written that way
    const text = record(["status: stable", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the timestamp
    expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
  });

  test("ignores an actor whose name merely starts with the owner's", () => {
    // Given - only a longer actor name has verified the record
    const text = record([
      ...DRAFT_LINES,
      `verified: { by: ${VERIFIED_BY}2, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the owner has not verified it
    expect(summary?.verifiedAt).toBeUndefined();
  });

  test("reads quoted timestamps without their quotes", () => {
    // Given - quoted generated and verified timestamps
    const text = record([
      "status: stable",
      'generated: { by: claude-code/model, at: "2026-10-01T15:00:00Z" }',
      `verified: { by: ${VERIFIED_BY}, at: '2026-10-02T15:00:00Z' }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - both timestamps parse, so the record reads as verified
    expect(summary === undefined ? undefined : getRecordState(summary)).toBe(
      "verified"
    );
  });

  test("reads a quoted status that carries a trailing comment", () => {
    // Given - a quoted draft status with a comment after it
    const text = record(['status: "draft" # wip']);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the status is draft
    expect(summary?.status).toBe("draft");
  });

  test.each([
    {
      description: "a status OKF doesn't define",
      lines: ["status: stabel"],
      writtenStatus: "stabel",
    },
    {
      description: "no status",
      lines: ["type: Decision"],
      writtenStatus: undefined,
    },
    {
      description: "an empty status",
      lines: ["status:"],
      writtenStatus: undefined,
    },
    {
      description: "a null status",
      lines: ["status: ~"],
      writtenStatus: undefined,
    },
    {
      description: "a quoted empty status",
      lines: ['status: ""'],
      writtenStatus: undefined,
    },
    {
      description: "a status that isn't a single value",
      lines: ["status: [draft]"],
      writtenStatus: undefined,
    },
  ])("tells $description apart by its written status", (row) => {
    // Given - a record with $description
    const text = record(row.lines);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - no status OKF defines, and the status as written
    expect({
      status: summary?.status,
      writtenStatus: summary?.writtenStatus,
    }).toStrictEqual({ status: undefined, writtenStatus: row.writtenStatus });
  });

  test("leaves absent fields undefined", () => {
    // Given - a record with only a status
    const text = record(["status: draft"]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - every other field is undefined
    expect(summary).toStrictEqual({
      description: undefined,
      generatedAt: undefined,
      staleAfter: undefined,
      status: "draft",
      tags: [],
      title: undefined,
      type: undefined,
      verifications: [],
      verifiedAt: undefined,
      writtenStatus: "draft",
    });
  });

  test.each([
    {
      description: "a block list",
      lines: ["tags:", "  - cli", "  - api"],
    },
    { description: "a flow list", lines: ["tags: [cli, api]"] },
    {
      description: "a flow list wrapped over lines",
      lines: ["tags:", "  [", "    cli,", "    api,", "  ]"],
    },
    {
      description: "a list with duplicates",
      lines: ["tags: [cli, api, cli, api]"],
    },
    {
      description: "items that aren't non-empty strings",
      lines: ['tags: [cli, "", { a: b }, [c], api]'],
    },
    {
      description: "an item written as an alias",
      lines: ["defs: [&k cli]", "tags: [*k, api]"],
    },
    {
      description: "the list written as an alias",
      lines: ["defs: [&t [cli, api]]", "tags: *t"],
    },
  ])("reads tags out of $description, in order, each once", ({ lines }) => {
    // Given - a record whose tags are written that way
    const text = record(["type: Decision", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the two tags, in the order first listed
    expect(summary?.tags).toStrictEqual(["cli", "api"]);
  });

  test.each([
    { description: "a single value", lines: ["tags: cli"] },
    { description: "a mapping", lines: ["tags: { cli: true }"] },
    { description: "an empty value", lines: ["tags:"] },
    { description: "an empty list", lines: ["tags: []"] },
  ])("reads no tags out of $description", ({ lines }) => {
    // Given - a record whose tags aren't a list of strings
    const text = record(["type: Decision", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - no tags
    expect(summary?.tags).toStrictEqual([]);
  });

  test.each([
    {
      description: "a plain description",
      expected: "Every export returns a fallback.",
      lines: ["description: Every export returns a fallback."],
    },
    {
      description: "a quoted description",
      expected: "Every export: a fallback.",
      lines: ['description: "Every export: a fallback."'],
    },
    {
      description: "a folded description",
      expected: "Every export returns\na fallback.\n",
      lines: ["description: >", "  Every export returns", "", "  a fallback."],
    },
    {
      description: "a description written as an alias",
      expected: "A fallback.",
      lines: ["defs: [&d A fallback.]", "description: *d"],
    },
    {
      description: "a description that isn't a single value",
      expected: undefined,
      lines: ["description: [a, b]"],
    },
  ])("reads $description", ({ expected, lines }) => {
    // Given - a record with that description
    const text = record(["type: Decision", ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - its value, without quotes
    expect(summary?.description).toBe(expected);
  });

  test("returns undefined without a frontmatter block", () => {
    // When - reading text with no frontmatter block
    const summary = readRecordSummary({
      text: "# Title\n",
      verifiedBy: VERIFIED_BY,
    });

    // Then - there is no summary
    expect(summary).toBeUndefined();
  });
});

describe("getRecordState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    {
      description: "never verified",
      expected: "unverified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifiedAt: undefined,
    },
    {
      description: "generated after it was verified",
      expected: "changed",
      generatedAt: "2026-10-02T15:00:00Z",
      verifiedAt: "2026-10-01T15:00:00Z",
    },
    {
      description: "verified after it was generated",
      expected: "verified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifiedAt: "2026-10-02T15:00:00Z",
    },
    {
      description: "verified at an unreadable time",
      expected: "changed",
      generatedAt: "2026-10-01T15:00:00Z",
      verifiedAt: "not a date",
    },
    {
      description: "verified with no generated time",
      expected: "verified",
      generatedAt: undefined,
      verifiedAt: "2026-10-02T15:00:00Z",
    },
    {
      description: "generated at an unreadable time",
      expected: "verified",
      generatedAt: "null",
      verifiedAt: "2026-10-02T15:00:00Z",
    },
    {
      description: "generated at a date that doesn't exist",
      expected: "verified",
      generatedAt: "2026-11-31T10:00:00Z",
      verifiedAt: "2026-10-02T15:00:00Z",
    },
    {
      description: "generated later, with a space before the time",
      expected: "changed",
      generatedAt: "2026-11-13 00:00:00Z",
      verifiedAt: "2026-11-12T00:00:00Z",
    },
    {
      description: "verified later, with a space and no zone",
      expected: "verified",
      generatedAt: "2026-11-12T00:00:00Z",
      verifiedAt: "2026-11-13 00:00:00",
    },
    {
      description: "verified in the second it was generated",
      expected: "verified",
      generatedAt: "2026-10-02T13:30:00.500Z",
      verifiedAt: "2026-10-02T13:30:00Z",
    },
    {
      description: "generated a second after it was verified",
      expected: "changed",
      generatedAt: "2026-10-02T13:30:01Z",
      verifiedAt: "2026-10-02T13:30:00.999Z",
    },
    {
      description: "generated ahead of the clock",
      expected: "changed",
      generatedAt: "2026-12-01T10:00:00Z",
      verifiedAt: "2026-11-01T10:00:00Z",
    },
    {
      description: "verified after a generation ahead of the clock",
      expected: "verified",
      generatedAt: "2026-12-01T10:00:00Z",
      verifiedAt: "2026-12-02T10:00:00Z",
    },
    {
      description:
        "verified at an unreadable time, generated ahead of the clock",
      expected: "changed",
      generatedAt: "2026-12-01T10:00:00Z",
      verifiedAt: "soon",
    },
    {
      description: "generated later, in ISO basic format",
      expected: "changed",
      generatedAt: "20261113T000000Z",
      verifiedAt: "2026-11-12T00:00:00Z",
    },
  ])("$description is $expected", ({ expected, generatedAt, verifiedAt }) => {
    // Given - two clocks, one before every row's times and one on a fixed day
    const judgeAt = (now: string): string => {
      vi.useFakeTimers({
        now: DateTime.fromISO(now).toJSDate(),
        toFake: ["Date"],
      });

      return getRecordState({ generatedAt, verifiedAt });
    };

    // When - judging a summary whose timestamps are $description under each
    const states = [judgeAt("2000-01-01T00:00:00Z"), judgeAt(NOW)];

    // Then - the state is $expected under both, as it never reads the clock
    expect(states).toStrictEqual([expected, expected]);
  });
});

describe("getTrustTier", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    {
      description: "no verified events",
      expected: "unverified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [],
    },
    {
      description: "a summary built without its events",
      expected: "unverified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: undefined,
    },
    {
      description: "a human sign-off after the generation",
      expected: "human-reviewed",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [{ at: AT, by: "human:someone" }],
    },
    {
      description: "a human sign-off in the second it was generated",
      expected: "human-reviewed",
      generatedAt: "2026-10-01T15:00:00.900Z",
      verifications: [{ at: "2026-10-01T15:00:00Z", by: "human:someone" }],
    },
    {
      description: "a human sign-off older than the generation",
      expected: "unverified",
      generatedAt: "2026-10-05T09:00:00Z",
      verifications: [{ at: AT, by: "human:someone" }],
    },
    {
      description: "a team sign-off after the generation",
      expected: "machine-confirmed",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [{ at: AT, by: "team:finance" }],
    },
    {
      description: "a process check, and an older human sign-off",
      expected: "machine-confirmed",
      generatedAt: "2026-10-05T09:00:00Z",
      verifications: [
        { at: AT, by: "human:someone" },
        { at: "2026-10-06T02:00:00Z", by: "process:nightly" },
      ],
    },
    {
      description: "a tool's check, and a current human sign-off",
      expected: "human-reviewed",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [
        { at: AT, by: "okf-tools/0.1.0" },
        { at: AT, by: "human:someone" },
      ],
    },
    {
      description: "a human scheme with no id",
      expected: "machine-confirmed",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [{ at: AT, by: "human:" }],
    },
    {
      description: "a human sign-off at an unreadable time",
      expected: "unverified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [{ at: "not a date", by: "human:someone" }],
    },
    {
      description: "a human sign-off ahead of the clock",
      expected: "unverified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [{ at: "2026-11-20T12:00:01Z", by: "human:someone" }],
    },
    {
      description: "a human sign-off at an unreadable time, never generated",
      expected: "human-reviewed",
      generatedAt: undefined,
      verifications: [{ at: "not a date", by: "human:someone" }],
    },
    {
      description:
        "an older human sign-off, and a later one ahead of the clock",
      expected: "unverified",
      generatedAt: "2026-10-01T15:00:00Z",
      verifications: [
        { at: AT, by: "human:someone" },
        { at: "2027-01-01T00:00:00Z", by: "human:someone" },
      ],
    },
    {
      description:
        "an older human sign-off, and a later one by the same person",
      expected: "human-reviewed",
      generatedAt: "2026-10-05T09:00:00Z",
      verifications: [
        { at: "2026-10-06T09:00:00Z", by: "human:someone" },
        { at: AT, by: "human:someone" },
      ],
    },
    {
      description: "a human sign-off with no generation time",
      expected: "human-reviewed",
      generatedAt: undefined,
      verifications: [{ at: AT, by: "human:someone" }],
    },
    {
      description: "a human sign-off with an unreadable generation time",
      expected: "human-reviewed",
      generatedAt: "yesterday",
      verifications: [{ at: AT, by: "human:someone" }],
    },
  ])("is $expected for $description", ({ expected, ...summary }) => {
    // Given - the clock on a fixed day
    vi.useFakeTimers({
      now: DateTime.fromISO(NOW).toJSDate(),
      toFake: ["Date"],
    });

    // When - calculating the tier
    const tier = getTrustTier(summary);

    // Then - only each actor's latest event counts, when current, and only a
    // person reviews
    expect(tier).toBe(expected);
  });
});

describe("isGeneratedAhead", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    {
      description: "no generated time",
      generatedAt: undefined,
      shouldBeAhead: false,
    },
    {
      description: "an unreadable one",
      generatedAt: "soon",
      shouldBeAhead: false,
    },
    {
      description: "one in the past",
      generatedAt: "2026-11-20T11:59:59Z",
      shouldBeAhead: false,
    },
    {
      description: "one later in the same second",
      generatedAt: "2026-11-20T12:00:00.900Z",
      shouldBeAhead: false,
    },
    {
      description: "one in the next second",
      generatedAt: "2026-11-20T12:00:01Z",
      shouldBeAhead: true,
    },
  ])("is $shouldBeAhead for $description", ({ generatedAt, shouldBeAhead }) => {
    // Given - the clock on a fixed day
    vi.useFakeTimers({
      now: DateTime.fromISO(NOW).toJSDate(),
      toFake: ["Date"],
    });

    // When - asking whether the generation time is ahead of it
    const isAhead = isGeneratedAhead({ generatedAt, verifiedAt: undefined });

    // Then - only a time in a later second is
    expect(isAhead).toBe(shouldBeAhead);
  });
});

describe("isStale", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    {
      description: "no stale_after",
      shouldBeStale: false,
      staleAfter: undefined,
    },
    {
      description: "an unreadable one",
      shouldBeStale: false,
      staleAfter: "next year",
    },
    {
      description: "one in the next second",
      shouldBeStale: false,
      staleAfter: "2026-11-20T12:00:01Z",
    },
    {
      description: "one earlier in the same second",
      shouldBeStale: true,
      staleAfter: "2026-11-20T12:00:00Z",
    },
    {
      description: "one later in the same second",
      shouldBeStale: false,
      staleAfter: "2026-11-20T12:00:00.900Z",
    },
    {
      description: "one at the same instant",
      shouldBeStale: true,
      staleAfter: "2026-11-20T12:00:00.400Z",
    },
    {
      description: "one in the past",
      shouldBeStale: true,
      staleAfter: "2026-09-23T00:00:00Z",
    },
  ])("is $shouldBeStale for $description", ({ shouldBeStale, staleAfter }) => {
    // Given - the clock on a fixed day
    vi.useFakeTimers({
      now: DateTime.fromISO(NOW).toJSDate(),
      toFake: ["Date"],
    });

    // When - asking whether the record is past its stale_after
    const isPast = isStale({ staleAfter });

    // Then - it is from that instant on
    expect(isPast).toBe(shouldBeStale);
  });
});

describe("isVerifiedAhead", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    {
      description: "no sign-off",
      shouldBeAhead: false,
      verifiedAt: undefined,
    },
    {
      description: "an unreadable one",
      shouldBeAhead: false,
      verifiedAt: "soon",
    },
    {
      description: "one later in the same second",
      shouldBeAhead: false,
      verifiedAt: "2026-11-20T12:00:00.900Z",
    },
    {
      description: "one in the next second",
      shouldBeAhead: true,
      verifiedAt: "2026-11-20T12:00:01Z",
    },
  ])("is $shouldBeAhead for $description", ({ shouldBeAhead, verifiedAt }) => {
    // Given - the clock on a fixed day
    vi.useFakeTimers({
      now: DateTime.fromISO(NOW).toJSDate(),
      toFake: ["Date"],
    });

    // When - asking whether the sign-off time is ahead of it
    const isAhead = isVerifiedAhead({
      generatedAt: "2099-01-01T00:00:00Z",
      verifiedAt,
    });

    // Then - only a time in a later second is, whatever the generation time
    expect(isAhead).toBe(shouldBeAhead);
  });
});

describe("readStatusText", () => {
  test.each([
    {
      description: "a status OKF doesn't define",
      expected: "wip",
      text: record(["status: wip"]),
    },
    {
      description: "a status OKF defines",
      expected: "draft",
      text: record(["status: draft"]),
    },
    { description: "no status", expected: undefined, text: record(["a: b"]) },
    {
      description: "a null status",
      expected: undefined,
      text: record(["status: null"]),
    },
    {
      description: "a status that's a list, as written",
      expected: "[draft]",
      text: record(["status: [draft]"]),
    },
    {
      description: "a status that's a mapping, as written",
      expected: "value: wip",
      text: record(["status:", "  value: wip"]),
    },
    {
      description: "a block list whose last item is empty, up to that item",
      expected: "- wip\n  -",
      text: record(["status:", "  - wip", "  -", "# note", "title: X"]),
    },
    { description: "no frontmatter", expected: undefined, text: BODY },
  ])("reads $description", ({ expected, text }) => {
    // When/Then - the status as written, or nothing
    expect(readStatusText(text)).toBe(expected);
  });
});

describe("readRecordSummary's verifications", () => {
  test.each([
    {
      description: "a list of events, in order",
      expected: [
        { at: AT, by: "human:someone" },
        { at: "2026-10-03T02:00:00Z", by: "process:nightly" },
      ],
      lines: [
        "verified:",
        `  - { by: human:someone, at: ${AT} }`,
        "  - by: process:nightly",
        "    at: 2026-10-03T02:00:00Z",
      ],
    },
    {
      description: "a bare mapping, as one event",
      expected: [{ at: AT, by: "team:finance" }],
      lines: [`verified: { by: team:finance, at: ${AT} }`],
    },
    {
      description: "an event through an alias",
      expected: [{ at: AT, by: "human:someone" }],
      lines: [
        `checked: &check { by: human:someone, at: ${AT} }`,
        "verified:",
        "  - *check",
      ],
    },
    {
      description: "events missing a by or an at, left out",
      expected: [{ at: AT, by: "human:someone" }],
      lines: [
        "verified:",
        `  - { at: ${AT} }`,
        "  - { by: human:nobody, at: ~ }",
        "  - not an event",
        `  - { by: human:someone, at: ${AT} }`,
      ],
    },
    {
      description: "no verified",
      expected: [],
      lines: [],
    },
  ])("reads $description", ({ expected, lines }) => {
    // Given - a record with those verified events
    const text = record([...DRAFT_LINES, ...lines]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - every event with both keys, by any actor
    expect(summary?.verifications).toStrictEqual(expected);
  });
});
