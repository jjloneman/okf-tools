import { describe, expect, test } from "vitest";

import { VERIFIED_BY } from "#test/repo";

import {
  findFrontmatterProblem,
  getRecordState,
  readRecordSummary,
} from "./read.ts";

const AT = "2026-10-02T13:30:00Z";
const BODY = "\n# Title\n\nBody text.\n";

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
  ])("finds nothing wrong with $description", ({ text }) => {
    // When/Then - no problem
    expect(findFrontmatterProblem(text)).toBeUndefined();
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
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the checklist fields come back
    expect(summary).toStrictEqual({
      generatedAt: "2026-10-01T15:00:00Z",
      status: "draft",
      title: "What every export promises",
      type: "Decision",
      verifiedAt: "2026-09-28T09:00:00Z",
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
      generatedAt: "2026-10-01T15:00:00Z",
      status: "draft",
      title: "What every export promises",
      type: "Decision",
      verifiedAt: undefined,
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

  test("reads an unknown status as absent", () => {
    // Given - a status OKF doesn't define
    const text = record(["status: stabel"]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - the status is undefined
    expect(summary?.status).toBeUndefined();
  });

  test("leaves absent fields undefined", () => {
    // Given - a record with only a status
    const text = record(["status: draft"]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

    // Then - every other field is undefined
    expect(summary).toStrictEqual({
      generatedAt: undefined,
      status: "draft",
      title: undefined,
      type: undefined,
      verifiedAt: undefined,
    });
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
      description: "generated later, in ISO basic format",
      expected: "changed",
      generatedAt: "20261113T000000Z",
      verifiedAt: "2026-11-12T00:00:00Z",
    },
  ])("$description is $expected", ({ expected, generatedAt, verifiedAt }) => {
    // When - judging a summary whose timestamps are $description
    const state = getRecordState({
      generatedAt,
      status: "stable",
      title: "T",
      type: "Decision",
      verifiedAt,
    });

    // Then - the state is $expected
    expect(state).toBe(expected);
  });
});
