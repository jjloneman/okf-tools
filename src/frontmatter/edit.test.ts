import { describe, expect, test, vi } from "vitest";

import { VERIFIED_BY } from "#test/repo";

import { verifyRecord } from "./edit.ts";
import { readRecordSummary } from "./read.ts";

const AT = "2026-10-02T13:30:00Z";
const OLD_AT = "2026-09-28T09:00:00Z";
const BODY = "\n# Title\n\nBody text.\n";
const VERIFY_OPTIONS = { at: AT, verifiedBy: VERIFIED_BY };
const HAND_EDIT_HINT = "edit the record by hand";

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
    "promotes a quoted draft and keeps its quotes: %s",
    (statusLine) => {
      // Given - a draft status written with quotes
      const text = record([...DRAFT_LINES.slice(0, 2), statusLine]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the status becomes stable, in the same quotes
      expect(result).toMatchObject({
        isOk: true,
        text: expect.stringContaining(
          `${statusLine.replace("draft", "stable")}\n`
        ) as string,
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

  test.each([
    {
      description: "frontmatter that isn't valid YAML",
      lines: ["title: Colon: inside", "status: draft"],
      reason: /^frontmatter isn't valid YAML: /u,
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

  test("refuses frontmatter with too many aliases to check", () => {
    // Given - aliases nested past the parser's limit
    const tens = (item: string): string =>
      `[${Array.from({ length: 10 }, () => item).join(", ")}]`;

    const text = record([
      `a: &a ${tens("x")}`,
      `b: &b ${tens("*a")}`,
      `c: ${tens("*b")}`,
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - a refusal rather than a thrown error
    expect(result).toStrictEqual({
      isOk: false,
      reason: `the frontmatter has too many aliases to check the edit; ${HAND_EDIT_HINT}`,
    });
  });

  test("adds verified after a |+ last field, keeping its blank line with it", () => {
    // Given - a |+ last field, which keeps the blank line as part of its value
    const lines = ["title: |+", "  hi", ""];
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the field follows the blank line, so the title's value is kept
    expect(result).toStrictEqual({
      isOk: true,
      text: record([...lines, `verified: { by: ${VERIFIED_BY}, at: ${AT} }`]),
    });
  });

  test.each([
    {
      description: "a blank line before the closing fence",
      lines: ["type: x", ""],
    },
  ])("adds verified after the last field, past $description", ({ lines }) => {
    // Given - no generated or status, and a blank last frontmatter line
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the field follows the last one, and the blank line stays last
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...lines.slice(0, -1),
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "",
      ]),
    });
  });

  test("keeps a |+ scalar's trailing blank lines with it", () => {
    // Given - a generated block whose last value keeps its trailing blank line
    const lines = ["status: stable", "generated:", "  note: |+", "    y", ""];
    const text = record([...lines, "title: T"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the new field follows the blank line, so the note is unchanged
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...lines,
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "title: T",
      ]),
    });
  });

  test.each([
    {
      description: "a comma and a key",
      expected: '"human:a, at: 1999"',
      verifiedBy: "human:a, at: 1999",
    },
    {
      description: "a comment marker",
      expected: '"human:a #x"',
      verifiedBy: "human:a #x",
    },
  ])(
    "quotes a signer whose name holds $description",
    ({ expected, verifiedBy }) => {
      // Given - a record with no verified field
      const text = record(["status: stable"]);

      // When - a signer whose name holds YAML syntax verifies it
      const result = verifyRecord({ at: AT, text, verifiedBy });

      // Then - the name quoted, and read back as the signer
      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          "status: stable",
          `verified: { by: ${expected}, at: ${AT} }`,
        ]),
      });
      expect(
        readRecordSummary({
          text: result.isOk ? result.text : "",
          verifiedBy,
        })?.verifiedAt
      ).toBe(AT);
    }
  );

  test.each([
    {
      description: "draft on the line after status:",
      expected: ["status:", "  stable"],
      lines: ["status:", "  draft"],
    },
  ])("promotes $description in place", ({ expected, lines }) => {
    // Given - a draft status in a layout a line-based edit misses
    const text = record([...lines, "title: T"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - only the value changed, and the entry added after status
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...expected,
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "title: T",
      ]),
    });
  });

  test.each([
    {
      description: "an empty verified field",
      expected: [`verified: { by: ${VERIFIED_BY}, at: ${AT} }`],
      lines: ["verified:"],
    },
    {
      description: "an empty verified field with a comment",
      expected: [`verified: { by: ${VERIFIED_BY}, at: ${AT} } # none yet`],
      lines: ["verified: # none yet"],
    },
    {
      description: "another person's entry with a comment",
      expected: [
        "verified: # theirs",
        "  - { by: human:someone }",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
      ],
      lines: ["verified: { by: human:someone } # theirs"],
    },
    {
      description: "a flow sequence holding a single-pair mapping",
      expected: [`verified: [a: b, { by: ${VERIFIED_BY}, at: ${AT} }]`],
      lines: ["verified: [a: b]"],
    },
    {
      description: "a flow sequence with spaces inside",
      expected: [`verified: [ { by: ${VERIFIED_BY}, at: ${AT} } ]`],
      lines: ["verified: [ ]"],
    },
  ])("adds the owner's entry to $description", ({ expected, lines }) => {
    // Given - a verified field without the owner's entry
    const text = record(["status: stable", ...lines, "title: T"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the entry written in place, the rest kept
    expect(result).toStrictEqual({
      isOk: true,
      text: record(["status: stable", ...expected, "title: T"]),
    });
  });

  test.each([
    {
      description: "a frontmatter of only a comment",
      expected: [
        "# nothing yet",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ],
      lines: ["# nothing yet"],
    },
    {
      description: "a frontmatter of one blank line",
      expected: ["", `verified: { by: ${VERIFIED_BY}, at: ${AT} }`],
      lines: [""],
    },
    {
      description: "an indented mapping with neither status nor generated",
      expected: ["  type: T", `  verified: { by: ${VERIFIED_BY}, at: ${AT} }`],
      lines: ["  type: T"],
    },
    {
      description: "an indented mapping",
      expected: [
        "  status: stable",
        `  verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ],
      lines: ["  status: draft"],
    },
  ])("adds a verified field to $description", ({ expected, lines }) => {
    // Given - a frontmatter with no verified field
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the field added where it fits
    expect(result).toStrictEqual({ isOk: true, text: record(expected) });
  });

  test.each([
    {
      description: "a flow mapping",
      lines: ["{ status: draft }"],
      reason: "the frontmatter isn't a block mapping",
    },
    {
      description: "a frontmatter of a single value",
      lines: ["just text"],
      reason: "the frontmatter isn't a block mapping",
    },
    {
      description: "a status written as an alias",
      lines: ["type: &d draft", "status: *d"],
      reason: "`status` is an alias",
    },
    {
      description: "a quoted status key",
      lines: ['"status": draft'],
      reason: "`status` isn't a plain key at the start of its line",
    },
    {
      description: "an anchored status",
      lines: ["status: &s draft", "phase: *s"],
      reason: "`status` has an anchor or a tag",
    },
    {
      description: "a tagged status",
      lines: ["status: !!str draft"],
      reason: "`status` has an anchor or a tag",
    },
    {
      description: "a folded block status",
      lines: ["status: >-", "  draft"],
      reason: "`status` spans several lines",
    },
    {
      description: "an explicit verified key with no value",
      lines: ["status: stable", "? verified"],
      reason: "`verified` isn't a plain key at the start of its line",
    },
    {
      description: "an explicit verified key with a value",
      lines: ["status: stable", "? verified", ": ~"],
      reason: "`verified` isn't a plain key at the start of its line",
    },
    {
      description: "a verified field written as an alias",
      lines: ["type: &v ~", "verified: *v"],
      reason: "`verified` is an alias",
    },
    {
      description: "an anchored empty verified field",
      lines: ["verified: &v ~", "copy: *v"],
      reason: "`verified` has an anchor or a tag",
    },
    {
      description: "another person's entry with an anchor",
      lines: ["verified: &theirs { by: human:someone }"],
      reason: "`verified` has an anchor or a tag",
    },
    {
      description: "another person's value with a tag",
      lines: ["verified: !!str someone"],
      reason: "`verified` has an anchor or a tag",
    },
    {
      description: "an anchored list",
      lines: ["verified: &l []"],
      reason: "`verified` has an anchor or a tag",
    },
    {
      description: "a verified field holding a single value",
      lines: ["verified: someone"],
      reason: "`verified` holds a single value, not an entry or a list",
    },
    {
      description: "a single value in quotes",
      lines: ['verified: "null"'],
      reason: "`verified` holds a single value, not an entry or a list",
    },
    {
      description: "a block scalar",
      lines: ["verified: |", "  someone"],
      reason: "`verified` holds a single value, not an entry or a list",
    },
    {
      description: "a nested mapping without the owner",
      lines: ["verified:", "  by: human:someone", "  at: 2026-09-01T00:00:00Z"],
      reason: "`verified` is a nested mapping, not a list",
    },
    {
      description: "an entry spread over two lines",
      lines: [`verified: { by: ${VERIFIED_BY},`, `  at: ${OLD_AT} }`],
      reason: "`verified` spans several lines",
    },
    {
      description: "a flow sequence spread over several lines",
      lines: [
        "verified: [",
        `    { by: ${VERIFIED_BY}, at: ${OLD_AT} },`,
        "  ]",
      ],
      reason: "`verified` spans several lines",
    },
    {
      description: "a list item spread over two lines",
      lines: [
        "verified:",
        `  - { by: ${VERIFIED_BY},`,
        `      at: ${OLD_AT} }`,
      ],
      reason: "a `verified` item spans several lines",
    },
    {
      description: "a list item written as an alias",
      lines: ["theirs: &e { by: human:someone }", "verified: [*e]"],
      reason: "a `verified` item is an alias",
    },
    {
      description: "an anchored list item",
      lines: ["verified:", "  - &e { by: human:someone }", "copy: *e"],
      reason: "a `verified` item has an anchor or a tag",
    },
    {
      description: "a list item that is a single value",
      lines: ["verified: [someone]"],
      reason: "a `verified` item isn't a mapping",
    },
    {
      description: "a nested list",
      lines: ["verified: [[a]]"],
      reason: "a `verified` item isn't a mapping",
    },
    {
      description: "a by written as an alias",
      lines: [`me: &m ${VERIFIED_BY}`, `verified: { by: *m, at: ${OLD_AT} }`],
      reason: "`verified`'s `by` is an alias",
    },
    {
      description: "an at that holds a list",
      lines: [`verified: { by: ${VERIFIED_BY}, at: [x] }`],
      reason: "`verified`'s `at` isn't a single value",
    },
    {
      description: "an anchored at",
      lines: [`verified: { by: ${VERIFIED_BY}, at: &t ${OLD_AT} }`],
      reason: "`verified`'s `at` has an anchor or a tag",
    },
    {
      description: "an at with no value",
      lines: [`verified: { by: ${VERIFIED_BY}, at }`],
      reason: "`verified`'s `at` has no value",
    },
    {
      description: "a block scalar at",
      lines: ["verified:", `  - by: ${VERIFIED_BY}`, "    at: |", "      x"],
      reason: "a `verified` item's `at` spans several lines",
    },
  ])("refuses an unsupported layout: $description", ({ lines, reason }) => {
    // Given - frontmatter outside the layouts the edits support
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - a refusal naming the field, and asking for a hand edit
    expect(result).toStrictEqual({
      isOk: false,
      reason: `${reason}; ${HAND_EDIT_HINT}`,
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
  test.each([
    { description: "LF", lineBreak: "\n" },
    { description: "CRLF", lineBreak: "\r\n" },
  ])(
    "adds a verified field to an empty $description frontmatter",
    ({ lineBreak }) => {
      // Given - fences with nothing between them
      const text = `---${lineBreak}---${lineBreak}# Title${lineBreak}`;

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the field on its own line, with the file's line break
      expect(result).toStrictEqual({
        isOk: true,
        text: [
          "---",
          `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
          "---",
          "# Title",
          "",
        ].join(lineBreak),
      });
    }
  );

  test.each([
    {
      description: "a list item",
      expected: [
        "  verified:",
        "  - at:",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
        "  # a comment",
        "  status: x",
      ],
      lines: ["  verified:", "  - at:", "  # a comment", "  status: x"],
    },
    {
      description: "a field after generated",
      expected: [
        "  generated:",
        "    at:",
        `  verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "  # a comment",
        "  title: x",
      ],
      lines: ["  generated:", "    at:", "  # a comment", "  title: x"],
    },
    {
      description: "an at",
      expected: [
        "  verified:",
        `    by: ${VERIFIED_BY}`,
        "    note:",
        `    at: ${AT}`,
        "  title: x",
      ],
      lines: [
        "  verified:",
        `    by: ${VERIFIED_BY}`,
        "    note:",
        "  title: x",
      ],
    },
  ])(
    "adds $description before the next field when the last value is empty",
    ({ expected, lines }) => {
      // Given - an indented block whose last value is empty, so the parser's
      // range for the block runs on to the next field
      const text = record(lines);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - the insert lands after the empty value, not after the next field
      expect(result).toStrictEqual({ isOk: true, text: record(expected) });
    }
  );

  test.each([
    { description: "an explicit key with no value", lines: ["? status"] },
    { description: "a mapping", lines: ["status: { phase: draft }"] },
    { description: "a list", lines: ["status: [draft]"] },
    { description: "an anchor", lines: ["status: &s stable", "copy: *s"] },
    { description: "a tag", lines: ["status: !!str stable"] },
    { description: "an alias", lines: ["kind: &k stable", "status: *k"] },
  ])(
    "leaves a status that isn't a draft alone, even with $description",
    ({ lines }) => {
      // Given - a status the edits won't promote, in a layout they don't edit
      const text = record([...lines, "title: T"]);

      // When - verifying it
      const result = verifyRecord({ ...VERIFY_OPTIONS, text });

      // Then - only the sign-off added after status, the status as written
      const after = lines.findIndex((line) => line.includes("status")) + 1;

      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          ...lines.slice(0, after),
          `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
          ...lines.slice(after),
          "title: T",
        ]),
      });
    }
  );

  test.each([
    {
      description: "a tag",
      entry: "{ by: human:someone, at: !!str 2026-09-01T00:00:00Z }",
    },
    {
      description: "an anchor",
      entry: "{ by: human:someone, at: &t 2026-09-01T00:00:00Z }",
    },
    { description: "no value", entry: "{ by: human:someone, at }" },
  ])("appends after another person's at with $description", ({ entry }) => {
    // Given - another person's entry whose at the edits would refuse to write
    const text = record(["status: stable", `verified: [${entry}]`]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - their entry kept as written, the signer's appended
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        `verified: [${entry}, { by: ${VERIFIED_BY}, at: ${AT} }]`,
      ]),
    });
  });

  test("adds verified after an explicit generated key with no value", () => {
    // Given - a folded first field, then ? generated with no value
    const lines = ["description: >-", "  folded", "? generated", "type: x"];
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the field after generated's key, not inside the folded value
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        ...lines.slice(0, 3),
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "type: x",
      ]),
    });
  });

  test.each([
    { description: "a line feed", verifiedBy: "human:a\nb" },
    { description: "a carriage return", verifiedBy: "human:a\rb" },
  ])("refuses a signer whose name holds $description", ({ verifiedBy }) => {
    // Given - a draft record
    const text = record(["status: draft"]);

    // When - a signer whose name spans lines verifies it
    const result = verifyRecord({ at: AT, text, verifiedBy });

    // Then - refused, since the entry would span lines too
    expect(result).toStrictEqual({
      isOk: false,
      reason: "the signer's name holds a line break",
    });
  });

  test("keeps a byte order mark before the opening fence", () => {
    // Given - a record that opens with a byte order mark
    const text = `\uFEFF${record(["status: draft"])}`;

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - edited, the mark kept
    expect(result).toStrictEqual({
      isOk: true,
      text: `\uFEFF${record([
        "status: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ])}`,
    });
  });

  test("checks a key that is a collection without a warning", () => {
    // Given - a collection used as a key, which plain objects can't hold
    const warn = vi.spyOn(process, "emitWarning");
    const text = record(["? [generated]", ": x", "status: draft"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - edited, and nothing printed past the tool's own output
    expect(result).toMatchObject({ isOk: true });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test.each([
    {
      description: "an anchored first field",
      expected: ["&k title: x", `verified: { by: ${VERIFIED_BY}, at: ${AT} }`],
      lines: ["&k title: x"],
    },
    {
      description: "a tagged first field",
      expected: [
        "!!str title: x",
        "status: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ],
      lines: ["!!str title: x", "status: draft"],
    },
    {
      description: "an anchored first key in the signer's list item",
      expected: [
        "verified:",
        "  - &k note: x",
        `    by: ${VERIFIED_BY}`,
        `    at: ${AT}`,
      ],
      lines: ["verified:", "  - &k note: x", `    by: ${VERIFIED_BY}`],
    },
    {
      description: "a tagged first key in the signer's entry",
      expected: [
        "verified:",
        "  !!str note: x",
        `  by: ${VERIFIED_BY}`,
        `  at: ${AT}`,
      ],
      lines: ["verified:", "  !!str note: x", `  by: ${VERIFIED_BY}`],
    },
  ])("indents a new line past $description", ({ expected, lines }) => {
    // Given - a mapping whose first key carries an anchor or a tag
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the new line indented like the mapping's keys, not past the mark
    expect(result).toStrictEqual({ isOk: true, text: record(expected) });
  });

  test("refuses a carriage return that doesn't end a line", () => {
    // Given - a flow entry split by a lone CR, a line break in YAML 1.2
    const text = record([
      `verified: [{ by: ${VERIFIED_BY},\r at: ${OLD_AT} }]`,
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - refused, since tools read the CR differently
    expect(result).toStrictEqual({
      isOk: false,
      reason: `the frontmatter holds a carriage return that doesn't end a line; ${HAND_EDIT_HINT}`,
    });
  });

  test("refuses an alias whose anchor isn't set before it", () => {
    // Given - an alias naming no anchor, which no reader can resolve
    const text = record(["status: draft", "copy: *nope"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - refused, naming the alias
    expect(result).toStrictEqual({
      isOk: false,
      reason: `the alias \`*nope\` names no anchor set before it; ${HAND_EDIT_HINT}`,
    });
  });

  test("refuses two collection keys that mean the same", () => {
    // Given - two equal collection keys, whose values a check can't tell apart
    const text = record(["? [a]", ": 1", "? [a]", ": 2", "status: draft"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - refused, rather than checked ambiguously
    expect(result).toStrictEqual({
      isOk: false,
      reason: `the frontmatter has two keys that mean the same; ${HAND_EDIT_HINT}`,
    });
  });

  test("checks a collection shared through an alias once", () => {
    // Given - a list anchored once and repeated by an alias
    const text = record(["tags: &t [a, b]", "copy: *t", "status: draft"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - edited, the shared list left as it was
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "tags: &t [a, b]",
        "copy: *t",
        "status: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test.each([
    {
      description: "an alias key repeating another",
      lines: ["&k a: 1", "*k : 2", "status: draft"],
    },
    {
      description: "two spellings of a null key",
      lines: ["? ~", ": a", "? null", ": b", "status: draft"],
    },
  ])("refuses $description as two keys that mean the same", ({ lines }) => {
    // Given - two keys the parser accepts but YAML reads as one
    const text = record(lines);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - refused before any edit
    expect(result).toStrictEqual({
      isOk: false,
      reason: `the frontmatter has two keys that mean the same; ${HAND_EDIT_HINT}`,
    });
  });

  test("refuses keys whose aliases resolve past the parser's limit", () => {
    // Given - a key that is an alias bomb
    const tens = (item: string): string =>
      `[${Array.from({ length: 10 }, () => item).join(", ")}]`;

    const text = record([
      `a: &a ${tens("x")}`,
      `b: &b ${tens("*a")}`,
      `c: &c ${tens("*b")}`,
      "? *c",
      ": 1",
    ]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - refused rather than thrown
    expect(result).toStrictEqual({
      isOk: false,
      reason: `the frontmatter has too many aliases to check the edit; ${HAND_EDIT_HINT}`,
    });
  });

  test.each([
    { by: "null", description: "null" },
    { by: "~", description: "a tilde" },
  ])("adds an entry rather than renew a $description by", ({ by }) => {
    // Given - an entry whose by is null, for a signer named like that null
    const text = record([
      "status: stable",
      `verified: { by: ${by}, at: ${OLD_AT} }`,
    ]);

    // When - that signer verifies it
    const result = verifyRecord({ at: AT, text, verifiedBy: by });

    // Then - a new, quoted entry, since a null by names nobody
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        "verified:",
        `  - { by: ${by}, at: ${OLD_AT} }`,
        `  - { by: "${by}", at: ${AT} }`,
      ]),
    });
  });

  test("keeps a byte order mark after the opening fence", () => {
    // Given - a byte order mark at the start of the frontmatter
    const text = record(["\uFEFFstatus: draft"]);

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - edited, the mark kept where it was
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "\uFEFFstatus: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test("keeps mixed line endings as they were", () => {
    // Given - a record whose lines end in CRLF and LF, mixed
    const text = "---\r\nstatus: draft\nverified: ~\r\n---\nbody\r\n";

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - only the values changed, every line ending kept
    expect(result).toStrictEqual({
      isOk: true,
      text: `---\r\nstatus: stable\nverified: { by: ${VERIFIED_BY}, at: ${AT} }\r\n---\nbody\r\n`,
    });
  });

  test.each([
    {
      description: "a new field",
      expected: [
        "status: stable",
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
        "type: x",
      ],
      lines: ["status: draft", "type: x"],
    },
    {
      description: "a new list item",
      expected: [
        "verified:",
        "  - { by: human:someone }",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
        "type: x",
      ],
      lines: ["verified:", "  - { by: human:someone }", "type: x"],
    },
    {
      description: "a new at",
      expected: ["verified:", `  by: ${VERIFIED_BY}`, `  at: ${AT}`, "type: x"],
      lines: ["verified:", `  by: ${VERIFIED_BY}`, "type: x"],
    },
    {
      description: "a list made from another person's entry",
      expected: [
        "verified:",
        "  - { by: human:someone }",
        `  - { by: ${VERIFIED_BY}, at: ${AT} }`,
        "type: x",
      ],
      lines: ["verified: { by: human:someone }", "type: x"],
    },
  ])("ends $description with CRLF in a CRLF record", ({ expected, lines }) => {
    // Given - a record with CRLF line breaks
    const crlf = (frontmatter: string[]): string =>
      record(frontmatter).replaceAll("\n", "\r\n");

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text: crlf(lines) });

    // Then - every new line ends in CRLF too
    expect(result).toStrictEqual({ isOk: true, text: crlf(expected) });
  });

  test.each([
    {
      description: "a fence with trailing spaces",
      text: "--- \nstatus: draft\n---\n",
    },
  ])("finds no frontmatter after $description", ({ text }) => {
    // When - verifying a record whose first line isn't exactly a fence
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - no frontmatter found, rather than a guess
    expect(result).toStrictEqual({
      isOk: false,
      reason: "no frontmatter block",
    });
  });

  test("closes the frontmatter at a CRLF fence in an LF record", () => {
    // Given - LF lines, but a closing fence that ends in CRLF
    const text = "---\nstatus: draft\n---\r\nbody\n";

    // When - verifying it
    const result = verifyRecord({ ...VERIFY_OPTIONS, text });

    // Then - the fence found, and its line break kept
    expect(result).toStrictEqual({
      isOk: true,
      text: `---\nstatus: stable\nverified: { by: ${VERIFIED_BY}, at: ${AT} }\n---\r\nbody\n`,
    });
  });
});
