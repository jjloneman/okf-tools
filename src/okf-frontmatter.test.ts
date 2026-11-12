import { describe, expect, test } from "vitest";

import {
  findFrontmatterProblem,
  getRecordState,
  readRecordSummary,
  verifyRecord,
} from "./okf-frontmatter.ts";

const AT = "2026-10-02T13:30:00Z";
const OLD_AT = "2026-09-28T09:00:00Z";
const BODY = "\n# Title\n\nBody text.\n";
const VERIFIED_BY = "human:jjloneman";
const VERIFY_OPTIONS = { at: AT, verifiedBy: VERIFIED_BY };

function record(frontmatter: string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

const DRAFT_LINES = [
  "type: Decision",
  'title: "What every export promises"',
  "status: draft",
  "generated: { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
];

describe("verifyRecord", () => {
  test("turns a draft into stable and adds a verified line after generated", () => {
    // Given - a draft record without a verified entry
    const text = record(DRAFT_LINES);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - stable status and a verified line after generated
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "type: Decision",
        'title: "What every export promises"',
        "status: stable",
        "generated: { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test("adds verified after status when there is no generated line", () => {
    // Given - a draft record with no generated line
    const text = record(["title: T", "status: draft", "type: Decision"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the verified line follows status
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "title: T",
        "status: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "type: Decision",
      ]),
    });
  });

  test("updates an existing inline entry instead of adding a second", () => {
    // Given - a stable record already verified by the owner
    const text = record([
      ...DRAFT_LINES.slice(0, 2),
      "status: stable",
      DRAFT_LINES[3] ?? "",
      `verified: { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z }`,
    ]);

    // When - verifying it again
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the entry's timestamp is renewed, not duplicated
    expect(result).toStrictEqual({
      isOk: true,
      text: text.replace("2026-09-28T09:00:00Z", AT),
    });
  });

  test.each([
    {
      description: "at before by",
      entry: `{ at: 2026-09-28T09:00:00Z, by: ${VERIFIED_BY} }`,
    },
    {
      description: "a quoted actor",
      entry: `{ by: "${VERIFIED_BY}", at: 2026-09-28T09:00:00Z }`,
    },
  ])(
    "renews an inline entry written with $description in place",
    ({ entry }) => {
      // Given - a stable record verified by the owner, spelled unusually
      const text = record(["status: stable", `verified: ${entry}`]);

      // When - verifying it again
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - only the timestamp changes, with no second entry
      expect(result).toStrictEqual({
        isOk: true,
        text: text.replace("2026-09-28T09:00:00Z", AT),
      });
    }
  );

  test.each([
    {
      description: "no at key",
      entry: `{ by: ${VERIFIED_BY} }`,
      expected: `{ by: ${VERIFIED_BY}, at: ${AT} }`,
    },
    {
      description: "an empty quoted at",
      entry: `{ by: ${VERIFIED_BY}, at: "" }`,
      expected: `{ by: ${VERIFIED_BY}, at: "${AT}" }`,
    },
    {
      description: "a null at",
      entry: `{ by: ${VERIFIED_BY}, at: ~ }`,
      expected: `{ by: ${VERIFIED_BY}, at: ${AT} }`,
    },
    {
      description: "quoted values holding braces, commas, and at:",
      entry: `{ note: "{x}, at: 2020", by: ${VERIFIED_BY}, at: ${OLD_AT} }`,
      expected: `{ note: "{x}, at: 2020", by: ${VERIFIED_BY}, at: ${AT} }`,
    },
  ])(
    "renews an inline owner entry with $description in place",
    ({ entry, expected }) => {
      // Given - the owner's inline entry, its timestamp missing or hidden
      const text = record(["status: stable", `verified: [${entry}]`]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the one entry carries the new timestamp
      expect(result).toStrictEqual({
        isOk: true,
        text: record(["status: stable", `verified: [${expected}]`]),
      });
    }
  );

  test("updates the owner's entry in the list form", () => {
    // Given - a list-form verified field holding the owner's entry
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
      `  - { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z }`,
      "tags: [a]",
    ]);

    // When - verifying it again
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - only the owner's timestamp is renewed
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", AT)
        .replace("status: draft", "status: stable"),
    });
  });

  test("appends an entry to a list that lacks the owner's", () => {
    // Given - a list-form verified field without the owner's entry
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the owner's entry is appended to the list
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...DRAFT_LINES.slice(0, 2),
        "status: stable",
        DRAFT_LINES[3] ?? "",
        "verified:",
        "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
        "tags: [a]",
      ]),
    });
  });

  test("keeps another person's inline entry as a list item", () => {
    // Given - another person's inline verified entry
    const text = record([
      ...DRAFT_LINES,
      "verified: { by: human:someone, at: 2026-09-01T00:00:00Z }",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - their entry becomes a list item beside the owner's
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...DRAFT_LINES.slice(0, 2),
        "status: stable",
        DRAFT_LINES[3] ?? "",
        "verified:",
        "  - { by: human:someone, at: 2026-09-01T00:00:00Z }",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test("adds verified after a nested generated block, not inside it", () => {
    // Given - a generated field written as a nested block
    const text = record([
      ...DRAFT_LINES.slice(0, 3),
      "generated:",
      "  by: claude-code/model",
      "  at: 2026-10-01T15:00:00Z",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the verified line follows the whole block
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...DRAFT_LINES.slice(0, 2),
        "status: stable",
        "generated:",
        "  by: claude-code/model",
        "  at: 2026-10-01T15:00:00Z",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "tags: [a]",
      ]),
    });
  });

  test("does not mistake a longer actor name for the owner", () => {
    // Given - an entry by an actor whose name starts with the owner's
    const text = record([
      ...DRAFT_LINES,
      `verified: { by: ${VERIFIED_BY}2, at: 2026-09-01T00:00:00Z }`,
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - their timestamp is kept and the owner gets a separate entry
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...DRAFT_LINES.slice(0, 2),
        "status: stable",
        DRAFT_LINES[3] ?? "",
        "verified:",
        `  - { by: ${VERIFIED_BY}2, at: 2026-09-01T00:00:00Z }`,
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test.each([
    {
      description: "an empty flow sequence",
      expected: `[{ by: ${VERIFIED_BY}, at: ${AT} }]`,
      verified: "[]",
    },
    {
      description: "another person's entry in a flow sequence",
      expected: `[{ by: human:someone, at: 2026-09-01T00:00:00Z }, { by: ${VERIFIED_BY}, at: ${AT} }]`,
      verified: "[{ by: human:someone, at: 2026-09-01T00:00:00Z }]",
    },
    {
      description: "the owner's entry among others in a flow sequence",
      expected: `[{ by: human:someone, at: 2026-09-01T00:00:00Z }, { by: ${VERIFIED_BY}, at: ${AT} }]`,
      verified: `[{ by: human:someone, at: 2026-09-01T00:00:00Z }, { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z }]`,
    },
  ])(
    "keeps the flow-sequence form for $description",
    ({ expected, verified }) => {
      // Given - a verified field in the flow-sequence form
      const text = record([...DRAFT_LINES, `verified: ${verified}`]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the entry is added or renewed inside the same sequence
      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          ...DRAFT_LINES.slice(0, 2),
          "status: stable",
          DRAFT_LINES[3] ?? "",
          `verified: ${expected}`,
        ]),
      });
    }
  );

  test("renews the owner's timestamp in a block-style list item", () => {
    // Given - a list item written as a block, with at: on its own line
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "  - by: human:someone",
      "    at: 2026-09-01T00:00:00Z",
      `  - by: ${VERIFIED_BY}`,
      "    at: 2026-09-28T09:00:00Z",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - only the owner's at: line changes
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", AT)
        .replace("status: draft", "status: stable"),
    });
  });

  test("appends the owner after block-style items without splitting them", () => {
    // Given - a block-style list without the owner's entry
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "  - by: human:someone",
      "    at: 2026-09-01T00:00:00Z",
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the new entry follows the whole item
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...DRAFT_LINES.slice(0, 2),
        "status: stable",
        DRAFT_LINES[3] ?? "",
        "verified:",
        "  - by: human:someone",
        "    at: 2026-09-01T00:00:00Z",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
        "tags: [a]",
      ]),
    });
  });

  test("rejects a verified field that is a nested mapping without the owner", () => {
    // Given - a verified field written as one nested mapping
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "  by: human:someone",
      "  at: 2026-09-01T00:00:00Z",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - it is rejected rather than rewritten into invalid YAML
    expect(result).toStrictEqual({
      isOk: false,
      reason: "`verified` is a nested mapping, not a list",
    });
  });

  test("still marks a draft that carries a trailing comment", () => {
    // Given - a status line with a trailing YAML comment
    const text = record([
      ...DRAFT_LINES.slice(0, 2),
      "status: draft # not settled",
      DRAFT_LINES[3] ?? "",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the status becomes stable and keeps its comment
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining("status: stable # not settled\n") as string,
    });
  });

  test("renews a quoted timestamp and keeps its quotes", () => {
    // Given - the owner's entry with a quoted timestamp
    const text = record([
      ...DRAFT_LINES,
      `verified: { by: ${VERIFIED_BY}, at: "2026-09-28T09:00:00Z" }`,
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - only the timestamp inside the quotes changes
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", AT)
        .replace("status: draft", "status: stable"),
    });
  });

  test("indents a new list item like the existing ones", () => {
    // Given - list items that start at column 0
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      "- { by: human:someone, at: 2026-09-01T00:00:00Z }",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the new item also starts at column 0
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining(
        `\n- { by: human:someone, at: 2026-09-01T00:00:00Z }\n- { by: ${VERIFIED_BY}, at: ${AT} }\n`
      ) as string,
    });
  });

  test("renews the owner's entry inside a multi-line flow sequence", () => {
    // Given - a flow sequence spread over several lines
    const text = record([
      ...DRAFT_LINES,
      "verified: [",
      "    { by: human:someone, at: 2026-09-01T00:00:00Z },",
      `    { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z },`,
      "  ]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the owner's line is renewed in place
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", AT)
        .replace("status: draft", "status: stable"),
    });
  });

  test("rejects a multi-line flow sequence without the owner's entry", () => {
    // Given - a flow sequence spread over several lines, missing the owner
    const text = record([
      ...DRAFT_LINES,
      "verified: [",
      "    { by: human:someone, at: 2026-09-01T00:00:00Z },",
      "  ]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - it is rejected rather than left with a dangling bracket
    expect(result).toStrictEqual({
      isOk: false,
      reason: "`verified` is a flow sequence spread over several lines",
    });
  });

  test("renews a block-style at: line that ends in a comment", () => {
    // Given - the owner's block entry with a trailing comment
    const text = record([
      ...DRAFT_LINES,
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      "    at: 2026-09-28T09:00:00Z # first pass",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the timestamp changes and the comment stays
    expect(result).toStrictEqual({
      isOk: true,
      text: text
        .replace("2026-09-28T09:00:00Z", AT)
        .replace("status: draft", "status: stable"),
    });
  });

  test("keeps a trailing comment on an inline flow sequence", () => {
    // Given - a one-line flow sequence with a comment
    const text = record([...DRAFT_LINES, "verified: [] # none yet"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the entry goes inside the brackets, before the comment
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining(
        `verified: [{ by: ${VERIFIED_BY}, at: ${AT} }] # none yet\n`
      ) as string,
    });
  });

  test("leaves a non-draft status alone", () => {
    // Given - a deprecated record
    const text = record([
      ...DRAFT_LINES.slice(0, 2),
      "status: deprecated",
      DRAFT_LINES[3] ?? "",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the status stays deprecated
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining("status: deprecated") as string,
    });
  });

  test("keeps the file's CRLF line breaks and everything after the frontmatter", () => {
    // Given - a record with CRLF line breaks
    const text = record(DRAFT_LINES).replaceAll("\n", "\r\n");

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - every line keeps its CRLF ending
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...DRAFT_LINES.slice(0, 2),
        "status: stable",
        DRAFT_LINES[3] ?? "",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
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
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

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
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the entry is added at the end and no status line appears
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "type: Decision",
        "title: T",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test.each([`status: "draft"`, `status: 'draft'`])(
    "promotes a quoted draft: %s",
    (statusLine) => {
      // Given - a draft status written with quotes
      const text = record([...DRAFT_LINES.slice(0, 2), statusLine]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

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
      const text = record([...DRAFT_LINES, `verified: ${emptyValue}`]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the null becomes the owner's inline entry
      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          ...DRAFT_LINES.slice(0, 2),
          "status: stable",
          DRAFT_LINES[3] ?? "",
          `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        ]),
      });
    }
  );

  test("adds an at: line to a block-style owner entry that has none", () => {
    // Given - the owner's block entry lacks an at: line
    const text = record([
      "status: stable",
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      "    note: forgot the time",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the timestamp goes after the entry's last line, in the same entry
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        "verified:",
        `  - by: ${VERIFIED_BY}`,
        "    note: forgot the time",
        `    at: ${AT}`,
      ]),
    });
  });

  test("renews an empty block-style at: line in place", () => {
    // Given - the owner's block entry with an empty quoted timestamp
    const text = record([
      "status: stable",
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      '    at: ""',
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the timestamp fills the quotes
    expect(result).toStrictEqual({
      isOk: true,
      text: text.replace('at: ""', `at: "${AT}"`),
    });
  });

  test.each([
    {
      after: `    at: ${AT}`,
      before: "    at:",
      description: "an empty value",
    },
    {
      after: `    at: ${AT} # when`,
      before: "    at:  # when",
      description: "only a comment",
    },
    {
      after: `    at: "${AT}"`,
      before: '    at: "2026-01-01 00:00:00"',
      description: "a quoted value holding a space",
    },
    {
      after: `    at: ${AT} # renewed`,
      before: "    at: NULL # renewed",
      description: "a null spelled NULL",
    },
  ])(
    "renews a block-style at: line holding $description in place",
    ({ after, before }) => {
      // Given - the owner's block entry with that at: line
      const text = record([
        "status: stable",
        "verified:",
        `  - by: ${VERIFIED_BY}`,
        before,
      ]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the same line carries the new timestamp
      expect(result).toStrictEqual({
        isOk: true,
        text: text.replace(before, after),
      });
    }
  );

  test("adds an own at: beside by: rather than renewing a nested one", () => {
    // Given - the owner's block entry whose only at: is under a child key
    const text = record([
      "status: stable",
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      "    source:",
      "      at: 2020-01-01T00:00:00Z",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the child's at: is kept, and the entry gets its own
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        "verified:",
        `  - by: ${VERIFIED_BY}`,
        "    source:",
        "      at: 2020-01-01T00:00:00Z",
        `    at: ${AT}`,
      ]),
    });
  });

  test("renews an inline entry spread over two lines in place", () => {
    // Given - the owner's flow mapping split across lines
    const text = record([
      "status: stable",
      "verified:",
      `  - { by: ${VERIFIED_BY},`,
      "      at: 2026-09-28T09:00:00Z }",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the timestamp renewed, the line split kept
    expect(result).toStrictEqual({
      isOk: true,
      text: text.replace("2026-09-28T09:00:00Z", AT),
    });
  });

  test.each([
    {
      description: "frontmatter that isn't valid YAML",
      lines: ["title: Colon: inside", "status: draft"],
      reason: /^frontmatter isn't valid YAML: /u,
    },
    {
      description: "an at that holds a list",
      lines: ["status: stable", `verified: { by: ${VERIFIED_BY}, at: [x] }`],
      reason: /^the signer's `at` isn't a single value$/u,
    },
  ])("refuses $description", ({ lines, reason }) => {
    // Given - a record the tool can't edit safely
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - a refusal saying why
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(reason) as string,
    });
  });

  test.each([
    {
      description: "a nested list",
      lines: [`verified: { by: ${VERIFIED_BY}, at: ${OLD_AT}, notes: [x] }`],
    },
    {
      description: "a comment between its keys",
      lines: [
        `verified: { by: ${VERIFIED_BY}, # me`,
        "  at: 2026-09-28T09:00:00Z }",
      ],
    },
    {
      description: "an earlier entry holding a list",
      lines: [
        "verified: [{ by: human:someone, tags: [a] },",
        `  { by: ${VERIFIED_BY}, at: 2026-09-28T09:00:00Z }]`,
      ],
    },
  ])("renews the owner's entry beside $description in place", ({ lines }) => {
    // Given - the owner's entry among YAML the old reader tripped on
    const text = record(["status: stable", ...lines]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - only the owner's timestamp changes
    expect(result).toStrictEqual({
      isOk: true,
      text: text.replace("2026-09-28T09:00:00Z", AT),
    });
  });

  test("adds an at: line before the fields that follow the entry", () => {
    // Given - the owner's block entry without an at, then another field
    const text = record([
      "status: stable",
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      "tags: [a]",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the at closes the entry, above the next field
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        "verified:",
        `  - by: ${VERIFIED_BY}`,
        `    at: ${AT}`,
        "tags: [a]",
      ]),
    });
  });

  test("keeps a status comment holding a line separator", () => {
    // Given - a draft whose status comment holds U+2028
    const text = record(["status: draft # wip\u2028still"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the comment kept whole
    expect(result).toMatchObject({
      isOk: true,
      text: expect.stringContaining(
        "status: stable # wip\u2028still"
      ) as string,
    });
  });

  test.each([
    {
      description: "a trailing comment",
      expected: [`verified: { by: ${VERIFIED_BY}, at: ${AT} # who`, "  }"],
      lines: [`verified: { by: ${VERIFIED_BY} # who`, "  }"],
    },
    {
      description: "a trailing comma",
      expected: [`verified: { by: ${VERIFIED_BY}, at: ${AT}, }`],
      lines: [`verified: { by: ${VERIFIED_BY}, }`],
    },
    {
      description: "a key with no value last",
      expected: [`verified: { by: ${VERIFIED_BY}, note, at: ${AT} }`],
      lines: [`verified: { by: ${VERIFIED_BY}, note }`],
    },
  ])(
    "adds a missing at after the last value, before $description",
    ({ expected, lines }) => {
      // Given - the owner's flow entry without an at, ending unusually
      const text = record(["status: stable", ...lines]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the at follows the last value, the rest kept
      expect(result).toStrictEqual({
        isOk: true,
        text: record(["status: stable", ...expected]),
      });
    }
  );

  test("refuses an edit that would leave invalid YAML", () => {
    // Given - another person's inline entry spread over two lines
    const text = record([
      "status: stable",
      "verified: { by: human:someone,",
      "  at: 2026-09-01T00:00:00Z }",
    ]);

    // When - verifying it, which the line-based append can't do safely
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - a refusal, not a broken record
    expect(result).toStrictEqual({
      isOk: false,
      reason: "the edit would leave the frontmatter invalid YAML",
    });
  });

  test("replaces a verified field that's NULL with the owner's entry", () => {
    // Given - a verified field spelled NULL
    const text = record(["status: stable", "verified: NULL"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the owner's entry, with no NULL list item left
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test("keeps tight braces tight when adding a missing at", () => {
    // Given - the owner's entry written without spaces inside its braces
    const text = record(["status: stable", `verified: {by: ${VERIFIED_BY}}`]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the at added the same way
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        `verified: {by: ${VERIFIED_BY}, at: ${AT}}`,
      ]),
    });
  });

  test("adds the owner's own entry when only a nested by: names them", () => {
    // Given - another person's entry with the owner's name under a child key
    const text = record([
      "status: stable",
      "verified:",
      "  - by: human:someone",
      "    at: 2026-09-01T00:00:00Z",
      "    review:",
      `      by: ${VERIFIED_BY}`,
      "      at: 2026-09-28T09:00:00Z",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the other entry untouched, and the owner's appended
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        "verified:",
        "  - by: human:someone",
        "    at: 2026-09-01T00:00:00Z",
        "    review:",
        `      by: ${VERIFIED_BY}`,
        "      at: 2026-09-28T09:00:00Z",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test("keeps a $ in the timestamp literal", () => {
    // Given - the owner's block entry, and a timestamp holding $&
    const text = record([
      "status: stable",
      "verified:",
      `  - by: ${VERIFIED_BY}`,
      "    at: 2026-09-28T09:00:00Z",
    ]);

    // When - verifying it with that timestamp
    const result = verifyRecord({ ...VERIFY_OPTIONS, at: "x$&y", text });

    // Then - the timestamp written as given
    expect(result).toStrictEqual({
      isOk: true,
      text: text.replace("2026-09-28T09:00:00Z", () => "x$&y"),
    });
  });
});

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
