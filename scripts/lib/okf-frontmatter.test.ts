import { describe, expect, test } from "vitest";

import {
  getRecordState,
  readRecordSummary,
  verifyRecord,
} from "./okf-frontmatter.ts";

const verifiedBy = "human:jjloneman";
const at = "2026-10-02T13:30:00Z";
const body = "\n# Title\n\nBody text.\n";

function record(frontmatter: string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${body}`;
}

const draftLines = [
  "type: Decision",
  'title: "What every export promises"',
  "status: draft",
  "generated: { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
];

describe("verifyRecord", () => {
  test("turns a draft into stable and adds a verified line after generated", () => {
    // Given - a draft record without a verified entry
    const text = record(draftLines);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - stable status and a verified line after generated
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "type: Decision",
        'title: "What every export promises"',
        "status: stable",
        "generated: { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
        `verified: { by: ${verifiedBy}, at: ${at} }`,
      ]),
    });
  });

  test("adds verified after status when there is no generated line", () => {
    // Given - a draft record with no generated line
    const text = record(["title: T", "status: draft", "type: Decision"]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the verified line follows status
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "title: T",
        "status: stable",
        `verified: { by: ${verifiedBy}, at: ${at} }`,
        "type: Decision",
      ]),
    });
  });

  test("updates an existing inline entry instead of adding a second", () => {
    // Given - a stable record already verified by the owner
    const text = record([
      ...draftLines.slice(0, 2),
      "status: stable",
      draftLines[3] ?? "",
      `verified: { by: ${verifiedBy}, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - verifying it again
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the entry's timestamp is renewed, not duplicated
    expect(result).toStrictEqual({
      isOk: true,
      text: text.replace("2026-09-28T09:00:00Z", at),
    });
  });

  test("updates the owner's entry in the list form", () => {
    // Given - a list-form verified field holding the owner's entry
    const text = record([
      ...draftLines,
      "verified:",
      "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
      `  - { by: ${verifiedBy}, at: 2026-09-28T09:00:00Z }`,
      "tags: [a]",
    ]);

    // When - verifying it again
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - only the owner's timestamp is renewed
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", at)
        .replace("status: draft", "status: stable"),
    });
  });

  test("appends an entry to a list that lacks the owner's", () => {
    // Given - a list-form verified field without the owner's entry
    const text = record([
      ...draftLines,
      "verified:",
      "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the owner's entry is appended to the list
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...draftLines.slice(0, 2),
        "status: stable",
        draftLines[3] ?? "",
        "verified:",
        "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
        `  - { by: ${verifiedBy}, at: ${at} }`,
        "tags: [a]",
      ]),
    });
  });

  test("keeps another person's inline entry as a list item", () => {
    // Given - another person's inline verified entry
    const text = record([
      ...draftLines,
      "verified: { by: human:someone, at: 2026-09-01T00:00:00Z }",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - their entry becomes a list item beside the owner's
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...draftLines.slice(0, 2),
        "status: stable",
        draftLines[3] ?? "",
        "verified:",
        "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
        `  - { by: ${verifiedBy}, at: ${at} }`,
      ]),
    });
  });

  test("adds verified after a nested generated block, not inside it", () => {
    // Given - a generated field written as a nested block
    const text = record([
      ...draftLines.slice(0, 3),
      "generated:",
      "  by: claude-code/model",
      "  at: 2026-10-01T15:00:00Z",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the verified line follows the whole block
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...draftLines.slice(0, 2),
        "status: stable",
        "generated:",
        "  by: claude-code/model",
        "  at: 2026-10-01T15:00:00Z",
        `verified: { by: ${verifiedBy}, at: ${at} }`,
        "tags: [a]",
      ]),
    });
  });

  test("does not mistake a longer actor name for the owner", () => {
    // Given - an entry by an actor whose name starts with the owner's
    const text = record([
      ...draftLines,
      `verified: { by: ${verifiedBy}2, at: 2026-09-01T00:00:00Z }`,
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - their timestamp is kept and the owner gets a separate entry
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...draftLines.slice(0, 2),
        "status: stable",
        draftLines[3] ?? "",
        "verified:",
        `  - { by: ${verifiedBy}2, at: 2026-09-01T00:00:00Z }`,
        `  - { by: ${verifiedBy}, at: ${at} }`,
      ]),
    });
  });

  test.each([
    {
      description: "an empty flow sequence",
      expected: `[{ by: ${verifiedBy}, at: ${at} }]`,
      verified: "[]",
    },
    {
      description: "another person's entry in a flow sequence",
      expected: `[{ by: human:someone, at: 2026-09-01T00:00:00Z }, { by: ${verifiedBy}, at: ${at} }]`,
      verified: "[{ by: human:someone, at: 2026-09-01T00:00:00Z }]",
    },
    {
      description: "the owner's entry among others in a flow sequence",
      expected: `[{ by: human:someone, at: 2026-09-01T00:00:00Z }, { by: ${verifiedBy}, at: ${at} }]`,
      verified: `[{ by: human:someone, at: 2026-09-01T00:00:00Z }, { by: ${verifiedBy}, at: 2026-09-28T09:00:00Z }]`,
    },
  ])(
    "keeps the flow-sequence form for $description",
    ({ expected, verified }) => {
      // Given - a verified field in the flow-sequence form
      const text = record([...draftLines, `verified: ${verified}`]);

      // When - verifying it
      const result = verifyRecord({ at, text, verifiedBy });

      // Then - the entry is added or renewed inside the same sequence
      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          ...draftLines.slice(0, 2),
          "status: stable",
          draftLines[3] ?? "",
          `verified: ${expected}`,
        ]),
      });
    }
  );

  test("renews the owner's timestamp in a block-style list item", () => {
    // Given - a list item written as a block, with at: on its own line
    const text = record([
      ...draftLines,
      "verified:",
      "  - by: human:someone",
      "    at: 2026-09-01T00:00:00Z",
      `  - by: ${verifiedBy}`,
      "    at: 2026-09-28T09:00:00Z",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - only the owner's at: line changes
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", at)
        .replace("status: draft", "status: stable"),
    });
  });

  test("appends the owner after block-style items without splitting them", () => {
    // Given - a block-style list without the owner's entry
    const text = record([
      ...draftLines,
      "verified:",
      "  - by: human:someone",
      "    at: 2026-09-01T00:00:00Z",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the new entry follows the whole item
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...draftLines.slice(0, 2),
        "status: stable",
        draftLines[3] ?? "",
        "verified:",
        "  - by: human:someone",
        "    at: 2026-09-01T00:00:00Z",
        `  - { by: ${verifiedBy}, at: ${at} }`,
        "tags: [a]",
      ]),
    });
  });

  test("rejects a verified field that is a nested mapping without the owner", () => {
    // Given - a verified field written as one nested mapping
    const text = record([
      ...draftLines,
      "verified:",
      "  by: human:someone",
      "  at: 2026-09-01T00:00:00Z",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - it is rejected rather than rewritten into invalid YAML
    expect(result).toStrictEqual({
      isOk: false,
      reason: "`verified` is a nested mapping, not a list",
    });
  });

  test("still marks a draft that carries a trailing comment", () => {
    // Given - a status line with a trailing YAML comment
    const text = record([
      ...draftLines.slice(0, 2),
      "status: draft # not settled",
      draftLines[3] ?? "",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the status becomes stable and keeps its comment
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining("status: stable # not settled\n") as string,
    });
  });

  test("renews a quoted timestamp and keeps its quotes", () => {
    // Given - the owner's entry with a quoted timestamp
    const text = record([
      ...draftLines,
      `verified: { by: ${verifiedBy}, at: "2026-09-28T09:00:00Z" }`,
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - only the timestamp inside the quotes changes
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", at)
        .replace("status: draft", "status: stable"),
    });
  });

  test("indents a new list item like the existing ones", () => {
    // Given - list items that start at column 0
    const text = record([
      ...draftLines,
      "verified:",
      "- { by: human:someone, at: 2026-09-01T00:00:00Z }",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the new item also starts at column 0
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining(
        `\n- { by: human:someone, at: 2026-09-01T00:00:00Z }\n- { by: ${verifiedBy}, at: ${at} }\n`
      ) as string,
    });
  });

  test("renews the owner's entry inside a multi-line flow sequence", () => {
    // Given - a flow sequence spread over several lines
    const text = record([
      ...draftLines,
      "verified: [",
      "    { by: human:someone, at: 2026-09-01T00:00:00Z },",
      `    { by: ${verifiedBy}, at: 2026-09-28T09:00:00Z },`,
      "  ]",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the owner's line is renewed in place
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", at)
        .replace("status: draft", "status: stable"),
    });
  });

  test("rejects a multi-line flow sequence without the owner's entry", () => {
    // Given - a flow sequence spread over several lines, missing the owner
    const text = record([
      ...draftLines,
      "verified: [",
      "    { by: human:someone, at: 2026-09-01T00:00:00Z },",
      "  ]",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - it is rejected rather than left with a dangling bracket
    expect(result).toStrictEqual({
      isOk: false,
      reason: "`verified` is a flow sequence spread over several lines",
    });
  });

  test("renews a block-style at: line that ends in a comment", () => {
    // Given - the owner's block entry with a trailing comment
    const text = record([
      ...draftLines,
      "verified:",
      `  - by: ${verifiedBy}`,
      "    at: 2026-09-28T09:00:00Z # first pass",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the timestamp changes and the comment stays
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", at)
        .replace("status: draft", "status: stable"),
    });
  });

  test("keeps a trailing comment on an inline flow sequence", () => {
    // Given - a one-line flow sequence with a comment
    const text = record([...draftLines, "verified: [] # none yet"]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the entry goes inside the brackets, before the comment
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining(
        `verified: [{ by: ${verifiedBy}, at: ${at} }] # none yet\n`
      ) as string,
    });
  });

  test("leaves a non-draft status alone", () => {
    // Given - a deprecated record
    const text = record([
      ...draftLines.slice(0, 2),
      "status: deprecated",
      draftLines[3] ?? "",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the status stays deprecated
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining("status: deprecated") as string,
    });
  });

  test("keeps the file's CRLF line breaks and everything after the frontmatter", () => {
    // Given - a record with CRLF line breaks
    const text = record(draftLines).replaceAll("\n", "\r\n");

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - every line keeps its CRLF ending
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...draftLines.slice(0, 2),
        "status: stable",
        draftLines[3] ?? "",
        `verified: { by: ${verifiedBy}, at: ${at} }`,
      ]).replaceAll("\n", "\r\n"),
    });
  });

  test.each([
    { description: "no frontmatter at all", text: "# Title\n" },
    {
      description: "an unclosed frontmatter block",
      text: "---\nstatus: draft\n",
    },
  ])("rejects a record with $description", ({ text }) => {
    // When - verifying a record with $description
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - it is rejected for the missing block
    expect(result).toStrictEqual({
      isOk: false,
      reason: "no frontmatter block",
    });
  });

  test("adds only verified to a record with no status line", () => {
    // Given - a record whose absent status counts as stable
    const text = record(["type: Decision", "title: T"]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - the entry is added at the end and no status line appears
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "type: Decision",
        "title: T",
        `verified: { by: ${verifiedBy}, at: ${at} }`,
      ]),
    });
  });

  test.each([`status: "draft"`, `status: 'draft'`])(
    "promotes a quoted draft: %s",
    (statusLine) => {
      // Given - a draft status written with quotes
      const text = record([...draftLines.slice(0, 2), statusLine]);

      // When - verifying it
      const result = verifyRecord({ at, text, verifiedBy });

      // Then - the status becomes stable
      expect(result).toMatchObject({
        isOk: true,
        text: expect.stringContaining("status: stable\n") as string,
      });
    }
  );

  test.each(["null", "~"])(
    "replaces an empty verified value: %s",
    (emptyValue) => {
      // Given - a verified field with a null value
      const text = record([...draftLines, `verified: ${emptyValue}`]);

      // When - verifying it
      const result = verifyRecord({ at, text, verifiedBy });

      // Then - the null becomes the owner's inline entry
      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          ...draftLines.slice(0, 2),
          "status: stable",
          draftLines[3] ?? "",
          `verified: { by: ${verifiedBy}, at: ${at} }`,
        ]),
      });
    }
  );

  test("adds a fresh entry beside a block-style owner entry that has no timestamp", () => {
    // Given - the owner's block entry lacks an at: line
    const text = record([
      ...draftLines,
      "verified:",
      `  - by: ${verifiedBy}`,
      "    note: forgot the time",
    ]);

    // When - verifying it
    const result = verifyRecord({ at, text, verifiedBy });

    // Then - a timestamped entry is appended rather than a wrong line edited
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining(
        `  - { by: ${verifiedBy}, at: ${at} }\n---`
      ) as string,
    });
  });
});

describe("readRecordSummary", () => {
  test("reads the fields the checklist shows", () => {
    // Given - a verified record
    const text = record([
      ...draftLines,
      `verified: { by: ${verifiedBy}, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

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
      ...draftLines,
      "verified:",
      "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
      `  - { by: ${verifiedBy}, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

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
    const summary = readRecordSummary({ text, verifiedBy });

    // Then - the timestamp is found inside the block
    expect(summary?.generatedAt).toBe("2026-10-01T15:00:00Z");
  });

  test("ignores an actor whose name merely starts with the owner's", () => {
    // Given - only a longer actor name has verified the record
    const text = record([
      ...draftLines,
      `verified: { by: ${verifiedBy}2, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

    // Then - the owner has not verified it
    expect(summary?.verifiedAt).toBeUndefined();
  });

  test("reads quoted timestamps without their quotes", () => {
    // Given - quoted generated and verified timestamps
    const text = record([
      "status: stable",
      'generated: { by: claude-code/model, at: "2026-10-01T15:00:00Z" }',
      `verified: { by: ${verifiedBy}, at: '2026-10-02T15:00:00Z' }`,
    ]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

    // Then - both timestamps parse, so the record reads as verified
    expect(summary === undefined ? undefined : getRecordState(summary)).toBe(
      "verified"
    );
  });

  test("reads a quoted status that carries a trailing comment", () => {
    // Given - a quoted draft status with a comment after it
    const text = record(['status: "draft" # wip']);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

    // Then - the status is draft
    expect(summary?.status).toBe("draft");
  });

  test("reads an unknown status as absent", () => {
    // Given - a status OKF doesn't define
    const text = record(["status: stabel"]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

    // Then - the status is undefined
    expect(summary?.status).toBeUndefined();
  });

  test("leaves absent fields undefined", () => {
    // Given - a record with only a status
    const text = record(["status: draft"]);

    // When - reading its summary
    const summary = readRecordSummary({ text, verifiedBy });

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
    const summary = readRecordSummary({ text: "# Title\n", verifiedBy });

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
