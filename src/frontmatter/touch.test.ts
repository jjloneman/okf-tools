import { describe, expect, test } from "vitest";

import { touchRecord } from "./touch.ts";

const AT = "2026-11-25T10:00:00Z";
const BY = "claude-code/2.2.0";
const OLD = "{ by: claude-code/2.1.0, at: 2026-10-01T15:00:00Z }";
const NEW = `{ by: ${BY}, at: ${AT} }`;
const BODY = "\n# Title\n\nBody text.\n";
const HAND_EDIT_HINT = "edit the record by hand";

/** Build a fabricated record from its frontmatter lines. */
function record(frontmatter: readonly string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

describe("touchRecord", () => {
  test.each([
    {
      after: ["type: Decision", "status: draft", `generated: ${NEW}`],
      before: ["type: Decision", "status: draft", `generated: ${OLD}`],
      description: "an inline generated",
    },
    {
      after: ["generated:", `  by: ${BY}`, `  at: ${AT}`, "type: Decision"],
      before: [
        "generated:",
        "  by: claude-code/2.1.0",
        "  at: 2026-10-01T15:00:00Z",
        "type: Decision",
      ],
      description: "a block generated",
    },
    {
      after: [`generated: { by: "${BY}", at: '${AT}' } # kept`],
      before: ["generated: { by: \"a/1\", at: '2026-10-01T15:00:00Z' } # kept"],
      description: "quoted values, keeping their quotes and the comment",
    },
    {
      after: ["type: Decision", `generated: ${NEW}`, "status: draft"],
      before: ["type: Decision", "generated:", "status: draft"],
      description: "an empty generated",
    },
    {
      after: ["type: Decision", `generated: ${NEW}`],
      before: ["type: Decision", "generated: ~"],
      description: "a null generated",
    },
    {
      after: [
        "type: Decision",
        "status: draft # why",
        `generated: ${NEW}`,
        "title: A",
      ],
      before: ["type: Decision", "status: draft # why", "title: A"],
      description: "no generated, adding it after the status",
    },
    {
      after: ["type: Decision", "title: A", `generated: ${NEW}`],
      before: ["type: Decision", "title: A"],
      description: "no generated or status, adding it at the end",
    },
    {
      after: ["  type: Decision", `  generated: ${NEW}`],
      before: ["  type: Decision"],
      description: "indented keys, indenting the new field to match",
    },
    {
      after: [`generated: { at: ${AT}, by: ${BY} }`],
      before: ["generated: { at: 2026-10-01T15:00:00Z }"],
      description: "an inline generated with no by",
    },
    {
      after: [`generated: { by: ${BY}, at: ${AT} }`],
      before: ["generated: { by: a/1 }"],
      description: "an inline generated with no at",
    },
    {
      after: ["generated:", `  by: ${BY}`, `  at: ${AT}`, "type: Decision"],
      before: ["generated:", "  by: a/1", "type: Decision"],
      description: "a block generated with no at",
    },
    {
      after: [`generated: {by: ${BY}, at: ${AT}}`],
      before: ["generated: {}"],
      description: "an empty inline generated",
    },
    {
      after: [`generated: { by: ${BY}, at: ${AT} }`],
      before: ["generated: { }"],
      description: "an empty inline generated with spaces inside",
    },
    {
      after: ["# only a comment", `generated: ${NEW}`],
      before: ["# only a comment"],
      description: "a frontmatter of only a comment",
    },
  ])("re-stamps $description", ({ after, before }) => {
    // Given - a record in that layout
    const text = record(before);

    // When - re-stamping it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text,
    });

    // Then - only generated changed
    expect(result).toStrictEqual({ isOk: true, text: record(after) });
  });

  test("adds generated to an empty frontmatter", () => {
    // Given - a record whose frontmatter block holds nothing
    const text = `---\n---\n${BODY}`;

    // When - re-stamping it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text,
    });

    // Then - generated is its only line
    expect(result).toStrictEqual({
      isOk: true,
      text: `---\ngenerated: ${NEW}\n---\n${BODY}`,
    });
  });

  test.each([
    {
      description: "a record",
      text: `---\r\ntype: Decision\r\nstatus: stable\r\n---\r\n\r\n# T\r\n`,
      touched: `---\r\ntype: Decision\r\nstatus: draft\r\ngenerated: ${NEW}\r\n---\r\n\r\n# T\r\n`,
    },
    {
      description: "a frontmatter of only a comment",
      text: "---\r\n# only a comment\r\n---\r\n",
      touched: `---\r\n# only a comment\r\ngenerated: ${NEW}\r\n---\r\n`,
    },
    {
      description: "an empty frontmatter",
      text: "---\r\n---\r\n",
      touched: `---\r\ngenerated: ${NEW}\r\n---\r\n`,
    },
  ])("keeps the CRLF line breaks of $description", ({ text, touched }) => {
    // When - re-stamping it, drafting it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: true,
      text,
    });

    // Then - every new line break a CRLF
    expect(result).toStrictEqual({ isOk: true, text: touched });
  });

  test.each([
    {
      description: "sets a stable record back to draft when asked",
      shouldDraft: true,
      status: "stable",
      touchedStatus: "draft",
    },
    {
      description: "leaves a stable record stable unless asked",
      shouldDraft: false,
      status: "stable",
      touchedStatus: "stable",
    },
    {
      description: "leaves a deprecated record as it is when asked to draft",
      shouldDraft: true,
      status: "deprecated",
      touchedStatus: "deprecated",
    },
    {
      description: "leaves a status that isn't one value as it is",
      shouldDraft: true,
      status: "[stable]",
      touchedStatus: "[stable]",
    },
  ])("$description", ({ shouldDraft, status, touchedStatus }) => {
    // Given - a signed-off record with that status
    const verified =
      "verified: { by: human:jjloneman, at: 2026-10-02T13:30:00Z }";
    const text = record([
      "type: Decision",
      `status: ${status}`,
      `generated: ${OLD}`,
      verified,
    ]);

    // When - re-stamping it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft,
      text,
    });

    // Then - the status as expected, verified untouched
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "type: Decision",
        `status: ${touchedStatus}`,
        `generated: ${NEW}`,
        verified,
      ]),
    });
  });

  test.each([
    {
      by: "claude-code\n2.2.0",
      description: "a producer with a line break",
      reason: "the producer's name holds a line break",
    },
    {
      by: "claude-code\r2.2.0",
      description: "a producer with a carriage return",
      reason: "the producer's name holds a line break",
    },
  ])("refuses $description", ({ by, reason }) => {
    // When - re-stamping a record with it
    const result = touchRecord({
      at: AT,
      by,
      reason: undefined,
      shouldDraft: false,
      text: record([`generated: ${OLD}`]),
    });

    // Then - refused as invalid parameters
    expect(result).toStrictEqual({
      isOk: false,
      kind: "invalidParams",
      reason,
    });
  });

  test("refuses a timestamp it can't write", () => {
    // When - re-stamping with a date and no time
    const result = touchRecord({
      at: "2026-11-25",
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text: record([`generated: ${OLD}`]),
    });

    // Then - refused as invalid parameters
    expect(result).toStrictEqual({
      isOk: false,
      kind: "invalidParams",
      reason:
        'the timestamp "2026-11-25" isn\'t an RFC 3339 date and time with a zone, such as 2026-10-02T13:30:00Z',
    });
  });

  test.each([
    {
      description: "no frontmatter",
      reason: "no frontmatter block",
      text: "# Title\n",
    },
    {
      description: "no closing fence",
      reason: "the frontmatter has no closing `---` line",
      text: "---\ntype: Decision\n",
    },
  ])("refuses a record with $description", ({ reason, text }) => {
    // When - re-stamping it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text,
    });

    // Then - refused for its missing frontmatter
    expect(result).toStrictEqual({
      isOk: false,
      kind: "noFrontmatter",
      reason,
    });
  });

  test("refuses frontmatter that isn't valid YAML", () => {
    // When - re-stamping a record with an unclosed list
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text: record(["tags: [a"]),
    });

    // Then - refused for its YAML
    expect(result).toMatchObject({
      isOk: false,
      kind: "invalidYaml",
      reason: expect.stringMatching(
        /^frontmatter isn't valid YAML: /u
      ) as unknown,
    });
  });

  test.each([
    {
      description: "a lone carriage return",
      lines: ["title: a\rb"],
      problem:
        "the frontmatter holds a carriage return that doesn't end a line",
    },
    {
      description: "an alias with no anchor",
      lines: ["generated: *nope"],
      problem: "the alias `*nope` names no anchor set before it",
    },
    {
      description: "two keys that mean the same",
      lines: ["? ~", ": a", "? null", ": b"],
      problem: "the frontmatter has two keys that mean the same",
    },
    {
      description: "a frontmatter that's a list",
      lines: ["- a"],
      problem: "the frontmatter isn't a mapping",
    },
    {
      description: "a generated that's a list",
      lines: ["generated: [a/1]"],
      problem: "`generated` isn't a mapping",
    },
    {
      description: "a generated that's text",
      lines: ["generated: a/1"],
      problem: "`generated` isn't a mapping",
    },
    {
      description: "a generated.by that's a mapping",
      lines: ["generated: { by: { name: a/1 }, at: 2026-10-01T15:00:00Z }"],
      problem: "`generated.by` isn't a single value",
    },
    {
      description: "a generated.at that's a list",
      lines: ["generated:", "  by: a/1", "  at: [2026-10-01T15:00:00Z]"],
      problem: "`generated.at` isn't a single value",
    },
  ])("refuses $description", ({ lines, problem }) => {
    // When - re-stamping it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text: record(lines),
    });

    // Then - refused, asking for a hand edit
    expect(result).toStrictEqual({
      isOk: false,
      kind: "unsupportedLayout",
      reason: `${problem}; ${HAND_EDIT_HINT}`,
    });
  });

  test.each([
    {
      by: "x, y",
      description: "a producer that splits an inline mapping",
      problem: "the new `generated` would be read as something else",
    },
    {
      by: "*a",
      description: "a producer that reads as an alias with no anchor",
      problem: "the new `generated` would be read as something else",
    },
    {
      by: "[",
      description: "a producer that opens a list",
      problem: "the new `generated` wouldn't be valid YAML",
    },
  ])("refuses $description", ({ by, problem }) => {
    // When - re-stamping a record with it
    const result = touchRecord({
      at: AT,
      by,
      reason: undefined,
      shouldDraft: false,
      text: record([`generated: ${OLD}`]),
    });

    // Then - refused, rather than written to mean more
    expect(result).toStrictEqual({
      isOk: false,
      kind: "unsupportedLayout",
      reason: `${problem}; ${HAND_EDIT_HINT}`,
    });
  });

  test("keeps everything outside the frontmatter byte for byte", () => {
    // Given - a body that looks like frontmatter
    const body = "\n---\ngenerated: { by: x/1 }\n---\n trailing  \n";
    const text = `---\ngenerated: ${OLD}\n---\n${body}`;

    // When - re-stamping it
    const result = touchRecord({
      at: AT,
      by: BY,
      reason: undefined,
      shouldDraft: false,
      text,
    });

    // Then - the body as it was
    expect(result).toStrictEqual({
      isOk: true,
      text: `---\ngenerated: ${NEW}\n---\n${body}`,
    });
  });

  describe("with a reason", () => {
    test.each([
      {
        after: [
          "type: Decision",
          `generated: ${NEW}`,
          "status: draft",
          "x-okf-restamp-reason: the spec moved",
        ],
        before: ["type: Decision", `generated: ${OLD}`, "status: draft"],
        description: "none yet, adding it at the end",
      },
      {
        after: [
          "generated:",
          `  by: ${BY}`,
          `  at: ${AT}`,
          "x-okf-restamp-reason: the spec moved",
        ],
        before: [
          "generated:",
          "  by: claude-code/2.1.0",
          "  at: 2026-10-01T15:00:00Z",
        ],
        description: "a block generated last, adding it after the block",
      },
      {
        after: [`generated: ${NEW}`, "x-okf-restamp-reason: the spec moved"],
        before: ['x-okf-restamp-reason: "an old reason"', `generated: ${OLD}`],
        description: "an old one, replacing its line, quotes and all",
      },
    ])("writes it, given $description", ({ after, before }) => {
      // When - re-stamping with a reason
      const result = touchRecord({
        at: AT,
        by: BY,
        reason: "the spec moved",
        shouldDraft: false,
        text: record(before),
      });

      // Then - the reason written as x-okf-restamp-reason
      expect(result).toStrictEqual({ isOk: true, text: record(after) });
    });

    test("takes out an old one when re-stamped without one", () => {
      // Given - a reason an earlier re-stamp wrote
      const text = record([
        `generated: ${OLD}`,
        "x-okf-restamp-reason: an old reason",
        "status: draft",
      ]);

      // When - re-stamping with none
      const result = touchRecord({
        at: AT,
        by: BY,
        reason: undefined,
        shouldDraft: false,
        text,
      });

      // Then - the old reason gone
      expect(result).toStrictEqual({
        isOk: true,
        text: record([`generated: ${NEW}`, "status: draft"]),
      });
    });

    test.each([
      { description: "an empty reason", reason: " " },
      { description: "a reason over two lines", reason: "a\nb" },
    ])("refuses $description", ({ reason }) => {
      // When - re-stamping with it
      const result = touchRecord({
        at: AT,
        by: BY,
        reason,
        shouldDraft: false,
        text: record([`generated: ${OLD}`]),
      });

      // Then - refused before any edit
      expect(result).toStrictEqual({
        isOk: false,
        kind: "invalidParams",
        reason: "the reason must be one line of text",
      });
    });

    test("replaces a quoted reason with one holding its quote", () => {
      // When - re-stamping a double-quoted reason with a reason holding "
      const result = touchRecord({
        at: AT,
        by: BY,
        reason: 'the "v2" API: moved',
        shouldDraft: false,
        text: record([`generated: ${OLD}`, 'x-okf-restamp-reason: "a: b"']),
      });

      // Then - written fresh, quoted as YAML needs
      expect(result).toStrictEqual({
        isOk: true,
        text: record([
          `generated: ${NEW}`,
          "x-okf-restamp-reason: 'the \"v2\" API: moved'",
        ]),
      });
    });

    test("refuses a flow mapping, which it can't add a field to", () => {
      // When - re-stamping a flow frontmatter with a reason
      const result = touchRecord({
        at: AT,
        by: BY,
        reason: "the spec moved",
        shouldDraft: false,
        text: record([`{ generated: ${OLD} }`]),
      });

      // Then - refused, as writeFields refuses it
      expect(result).toStrictEqual({
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the frontmatter isn't a block mapping; ${HAND_EDIT_HINT}`,
      });
    });
  });
});
