import { describe, expect, test } from "vitest";

import type { FieldWrite } from "./fields.ts";

import { writeFields } from "./fields.ts";

const BODY = "\n# Title\n\nBody text.\n";
const HAND_EDIT_HINT = "edit the record by hand";
const STALE = "2027-02-23T10:00:00Z";

/** The fields `okf deprecate` writes with a replacement. */
const DEPRECATE: readonly FieldWrite[] = [
  { key: "status", value: "deprecated" },
  { after: "status", key: "superseded_by", value: "/b.md" },
];

/** The field `okf verify --stale-in` writes. */
const STALE_AFTER: readonly FieldWrite[] = [
  { after: "verified", key: "stale_after", value: STALE },
];

/** Build a fabricated record from its frontmatter lines. */
function record(frontmatter: readonly string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

describe("writeFields", () => {
  test.each([
    {
      after: ["type: Decision", "status: deprecated", "superseded_by: /b.md"],
      before: ["type: Decision", "status: stable"],
      description: "a status to overwrite, adding the replacement after it",
      fields: DEPRECATE,
    },
    {
      after: [
        "type: Decision",
        'status: "deprecated" # why',
        "superseded_by: /b.md",
        "title: A",
      ],
      before: ["type: Decision", 'status: "draft" # why', "title: A"],
      description: "a quoted status with a comment, keeping both",
      fields: DEPRECATE,
    },
    {
      after: ["status: deprecated", "superseded_by: '/b.md'"],
      before: ["status: deprecated", "superseded_by: '/a.md'"],
      description: "fields to overwrite, one already holding its value",
      fields: DEPRECATE,
    },
    {
      after: ["status: deprecated", "superseded_by: /b.md", "type: Decision"],
      before: ["status:", "superseded_by: ~", "type: Decision"],
      description: "an empty status and a null replacement",
      fields: DEPRECATE,
    },
    {
      after: ["status: deprecated", "superseded_by: /b.md", "note: A"],
      before: ["status:", "note: A"],
      description: "an empty status, adding the replacement after it",
      fields: DEPRECATE,
    },
    {
      after: ["type: Decision", "status: deprecated", "superseded_by: /b.md"],
      before: ["type: Decision"],
      description: "no status, adding both at the end, in order",
      fields: DEPRECATE,
    },
    {
      after: [
        "  type: Decision",
        "  status: deprecated",
        "  superseded_by: /b.md",
      ],
      before: ["  type: Decision"],
      description: "indented keys, indenting the new fields to match",
      fields: DEPRECATE,
    },
    {
      after: [
        "status: stable",
        "verified:",
        "  - by: human:a",
        "    at: 2026-11-25T10:00:00Z",
        `stale_after: ${STALE}`,
        "title: A",
      ],
      before: [
        "status: stable",
        "verified:",
        "  - by: human:a",
        "    at: 2026-11-25T10:00:00Z",
        "title: A",
      ],
      description: "a block verified, adding the field after it",
      fields: STALE_AFTER,
    },
    {
      after: [
        "verified: { by: human:a, at: 2026-11-25T10:00:00Z }",
        `stale_after: "${STALE}"`,
      ],
      before: [
        "verified: { by: human:a, at: 2026-11-25T10:00:00Z }",
        'stale_after: "2026-01-01T00:00:00Z"',
      ],
      description: "a quoted stale_after, keeping its quotes",
      fields: STALE_AFTER,
    },
    {
      after: ["title: A", `stale_after: ${STALE}`],
      before: ["title: A"],
      description: "no verified, adding the field at the end",
      fields: STALE_AFTER,
    },
    {
      after: ["title: A", 'superseded_by: "/a: b.md"'],
      before: ["title: A"],
      description: "a value YAML reads as more, quoting it",
      fields: [
        { key: "superseded_by", value: "/a: b.md" },
      ] satisfies FieldWrite[],
    },
  ])("writes $description", ({ after, before, fields }) => {
    // Given - a record
    const text = record(before);

    // When - writing the fields
    const result = writeFields({ fields, text });

    // Then - only the fields' characters changed
    expect(result).toStrictEqual({ isOk: true, text: record(after) });
  });

  test("keeps CRLF line endings and a byte order mark", () => {
    // Given - a CRLF record with a byte order mark
    const text = "﻿---\r\ntype: Decision\r\n---\r\nBody\r\n";

    // When - writing a field it lacks
    const result = writeFields({ fields: DEPRECATE, text });

    // Then - the new lines end in CRLF too
    expect(result).toStrictEqual({
      isOk: true,
      text: "﻿---\r\ntype: Decision\r\nstatus: deprecated\r\nsuperseded_by: /b.md\r\n---\r\nBody\r\n",
    });
  });

  test.each([
    {
      description: "no frontmatter",
      expected: {
        isOk: false,
        kind: "noFrontmatter",
        reason: "no frontmatter block",
      },
      text: "# Title\n",
    },
    {
      description: "invalid YAML",
      expected: {
        isOk: false,
        kind: "invalidYaml",
        reason: expect.any(String) as unknown,
      },
      text: record(["status: [stable"]),
    },
    {
      description: "a lone carriage return",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the frontmatter holds a carriage return that doesn't end a line; ${HAND_EDIT_HINT}`,
      },
      text: record(['title: "a\rb"']),
    },
    {
      description: "an alias with no anchor",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the alias \`*a\` names no anchor set before it; ${HAND_EDIT_HINT}`,
      },
      text: record(["status: *a"]),
    },
    {
      description: "frontmatter that's a flow mapping",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the frontmatter isn't a block mapping; ${HAND_EDIT_HINT}`,
      },
      text: record(["{ status: stable }"]),
    },
    {
      description: "frontmatter that's a list",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the frontmatter isn't a block mapping; ${HAND_EDIT_HINT}`,
      },
      text: record(["- status"]),
    },
    {
      description: "frontmatter of only a comment",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the frontmatter isn't a block mapping; ${HAND_EDIT_HINT}`,
      },
      text: record(["# nothing"]),
    },
    {
      description: "a status that's a list",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `\`status\` isn't a single value; ${HAND_EDIT_HINT}`,
      },
      text: record(["status:", "  - stable"]),
    },
    {
      description: "a status that's an alias",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `\`status\` isn't a single value; ${HAND_EDIT_HINT}`,
      },
      text: record(["base: &s stable", "status: *s"]),
    },
    {
      description: "a quoted value its quotes can't hold as written",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the new \`status\` and \`superseded_by\` wouldn't be valid YAML; ${HAND_EDIT_HINT}`,
      },
      text: record(["status: deprecated", "superseded_by: '/a.md'"]),
      writes: [
        { key: "status", value: "deprecated" },
        { key: "superseded_by", value: "/it's.md" },
      ] satisfies FieldWrite[],
    },
    {
      description: "a value its quotes would read as an escape",
      expected: {
        isOk: false,
        kind: "unsupportedLayout",
        reason: `the new \`superseded_by\` would be read as something else; ${HAND_EDIT_HINT}`,
      },
      text: record(['superseded_by: "/a.md"']),
      writes: [
        { key: "superseded_by", value: "/a\\n.md" },
      ] satisfies FieldWrite[],
    },
  ])("refuses $description", ({ expected, text, writes }) => {
    // When - writing the fields
    const result = writeFields({ fields: writes ?? DEPRECATE, text });

    // Then - refused, saying why
    expect(result).toStrictEqual(expected);
  });
});
