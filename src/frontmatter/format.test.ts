import { describe, expect, test } from "vitest";

import type { FormatRecordParams } from "./format.ts";

import { checkFormatted, formatRecord, orderKeyNames } from "./format.ts";
import { parseFrontmatter } from "./shared.ts";
import { REFUSAL_KINDS } from "./types.ts";

const BODY = "\n# Title\n\nBody text.\n";
const HAND_EDIT_HINT = "fix the record by hand";

/** Every fix off, for a test to turn on the ones it needs. */
const NO_FIXES: Omit<FormatRecordParams, "text"> = {
  shouldBlockTags: false,
  shouldSortTags: false,
};

/** The order the tests put keys in. */
const ORDER = ["type", "title", "tags"] as const;

/** Build a fabricated record from its frontmatter lines. */
function record(frontmatter: readonly string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

describe("formatRecord", () => {
  test.each([
    {
      after: ["tags: [a, b, 'b']"],
      before: ["tags: [b, a, 'b']"],
      description: "a tag given twice, keeping both in their order",
      fixes: { shouldSortTags: true },
    },
    {
      after: ["type: Decision", "tags: [a, b, c]"],
      before: ["type: Decision", "tags: [c, a, b]"],
      description: "a flow list, sorting it in place",
      fixes: { shouldSortTags: true },
    },
    {
      after: ["tags:", "  - a", '  - "b"', "  - 'c'", "type: Decision"],
      before: ["tags:", "  - 'c'", "  - a", '  - "b"', "type: Decision"],
      description: "a block list of quoted tags, keeping their quotes",
      fixes: { shouldSortTags: true },
    },
    {
      after: ["tags:", "  [", "    a,", "    b,", "  ]"],
      before: ["tags:", "  [", "    b,", "    a,", "  ]"],
      description: "a flow list Prettier wrapped, sorting it in place",
      fixes: { shouldSortTags: true },
    },
    {
      after: ["type: Decision", "tags:", "  - c", "  - a", "status: draft"],
      before: ["type: Decision", "tags: [c, a]", "status: draft"],
      description: "a flow list to write as a block list, in its order",
      fixes: { shouldBlockTags: true },
    },
    {
      after: ["tags: # why", "  - a", "  - b", "title: A"],
      before: ["tags: [b, a] # why", "title: A"],
      description: "a flow list with a comment, moving it to the tags line",
      fixes: { shouldBlockTags: true, shouldSortTags: true },
    },
    {
      after: ["tags:", "  - a", "  - b"],
      before: ["tags:", "  [", "    b,", "    a", "  ]"],
      description: "a flow list Prettier wrapped, written as a block list",
      fixes: { shouldBlockTags: true, shouldSortTags: true },
    },
    {
      after: ["tags:", "  - b", "  - a"],
      before: ["tags:", "  - b", "  - a"],
      description: "a block list, which needs no rewriting",
      fixes: { shouldBlockTags: true },
    },
    {
      after: ['"tags": [a, b]'],
      before: ['"tags": [b, a]'],
      description: "a quoted key, when only sorting",
      fixes: { shouldSortTags: true },
    },
    {
      after: ["tags: a", "type: Decision"],
      before: ["tags: a", "type: Decision"],
      description: "a single tag, which has no order",
      fixes: { shouldBlockTags: true, shouldSortTags: true },
    },
    {
      after: ["tags: []"],
      before: ["tags: []"],
      description: "an empty list",
      fixes: { shouldBlockTags: true, shouldSortTags: true },
    },
    {
      after: ["type: Decision"],
      before: ["type: Decision"],
      description: "no tags",
      fixes: { shouldBlockTags: true, shouldSortTags: true },
    },
    {
      after: [
        "type: Decision",
        "title: A",
        "tags: [a]",
        "status: draft",
        "x-acme-owner: data-team",
        "generated: { by: a/1, at: 2026-01-01T00:00:00Z }",
        "verified:",
        "  - by: human:a",
        "    at: 2026-01-02T00:00:00Z",
      ],
      before: [
        "status: draft",
        "tags: [a]",
        "x-acme-owner: data-team",
        "title: A",
        "generated: { by: a/1, at: 2026-01-01T00:00:00Z }",
        "verified:",
        "  - by: human:a",
        "    at: 2026-01-02T00:00:00Z",
        "type: Decision",
      ],
      description: "keys out of order, the unlisted keys after, as they were",
      fixes: { keyOrder: ORDER },
    },
    {
      after: ["type: Decision", "title: A", "2024: notes"],
      before: ["title: A", "2024: notes", "type: Decision"],
      description: "a key that looks like a number, in its place",
      fixes: { keyOrder: ORDER },
    },
    {
      after: [
        "# A comment before every key",
        "type: Decision",
        "description: >-",
        "  Folded",
        "  # not a comment, but text",
        "",
        "title: A # why",
      ],
      before: [
        "# A comment before every key",
        "description: >-",
        "  Folded",
        "  # not a comment, but text",
        "",
        "title: A # why",
        "type: Decision",
      ],
      description: "a block scalar, a blank line and comments, moved whole",
      fixes: { keyOrder: ["type"] },
    },
    {
      after: ["type: Decision", "title: A", "tags:", "  - a", "  - b"],
      before: ["title: A", "tags: [b, a]", "type: Decision"],
      description: "every fix at once",
      fixes: {
        keyOrder: ["type"],
        shouldBlockTags: true,
        shouldSortTags: true,
      },
    },
  ])("formats $description", ({ after, before, fixes }) => {
    // When - formatting the record
    const formatted = formatRecord({
      ...NO_FIXES,
      ...fixes,
      text: record(before),
    });

    // Then - the frontmatter as expected, the body untouched
    expect(formatted).toStrictEqual({ isOk: true, text: record(after) });
  });

  test("keeps CRLF line breaks and a byte order mark", () => {
    // Given - a Windows record, with a flow list out of order
    const text = "﻿---\r\ntitle: A\r\ntags: [b, a]\r\ntype: x\r\n---\r\n";

    // When - every fix
    const formatted = formatRecord({
      keyOrder: ORDER,
      shouldBlockTags: true,
      shouldSortTags: true,
      text,
    });

    // Then - CRLF on every new line, the mark kept
    expect(formatted).toStrictEqual({
      isOk: true,
      text: "﻿---\r\ntype: x\r\ntitle: A\r\ntags:\r\n  - a\r\n  - b\r\n---\r\n",
    });
  });

  test.each([
    {
      description: "a record with no frontmatter",
      kind: REFUSAL_KINDS.noFrontmatter,
      reason: "no frontmatter block",
      text: "# Title\n",
    },
    {
      description: "frontmatter that never closes",
      kind: REFUSAL_KINDS.noFrontmatter,
      reason: "the frontmatter has no closing `---` line",
      text: "---\ntype: Decision\n",
    },
    {
      description: "frontmatter that isn't valid YAML",
      kind: REFUSAL_KINDS.invalidYaml,
      reason: expect.stringMatching(
        /^frontmatter isn't valid YAML: Flow sequence/u
      ) as string,
      text: record(["tags: [a", "type: x"]),
    },
  ])("refuses $description", ({ kind, reason, text }) => {
    // When - formatting it
    const formatted = formatRecord({ ...NO_FIXES, shouldSortTags: true, text });

    // Then - refused, with the reason
    expect(formatted).toStrictEqual({ isOk: false, kind, reason });
  });

  test.each([
    {
      description: "a lone carriage return",
      fixes: { shouldSortTags: true },
      frontmatter: ["title: a\rb", "tags: [b, a]"],
      reason: "the frontmatter holds a carriage return that doesn't end a line",
    },
    {
      description: "two keys that mean the same",
      fixes: { shouldSortTags: true },
      frontmatter: ["~: a", "null: b"],
      reason: "the frontmatter has two keys that mean the same",
    },
    {
      description: "a flow mapping",
      fixes: { shouldSortTags: true },
      frontmatter: ["{ tags: [b, a] }"],
      reason: "the frontmatter isn't a block mapping",
    },
    {
      description: "a single value",
      fixes: { keyOrder: ORDER },
      frontmatter: ["just text"],
      reason: "the frontmatter isn't a block mapping",
    },
    {
      description: "tags that are an alias",
      fixes: { shouldSortTags: true },
      frontmatter: ["x: &t [b, a]", "tags: *t"],
      reason: "`tags` is an alias",
    },
    {
      description: "tags with an anchor",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags: &t [b, a]"],
      reason: "`tags` has an anchor or a tag",
    },
    {
      description: "tags with a YAML tag",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags: !!seq [b, a]"],
      reason: "`tags` has an anchor or a tag",
    },
    {
      description: "a tag with an anchor",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags: [b, &x a]"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a tag with a YAML tag",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags: [b, !!str a]"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "an alias in the list",
      fixes: { shouldSortTags: true },
      frontmatter: ["x: &x a", "tags: [b, *x]"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a nested list",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags: [b, [a]]"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a block scalar tag",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags:", "  - b", "  - |", "    a"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a quoted tag over two lines",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags:", '  - "b', '    c"', "  - a"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a comment after a tag",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags:", "  - b # why", "  - a"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a comment line between tags",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags:", "  - b", "  # why", "  - a"],
      reason:
        "`tags` holds something other than single values on one line each",
    },
    {
      description: "a comment inside a wrapped flow list",
      fixes: { shouldSortTags: true },
      frontmatter: ["tags: [b, a, # why", "  ]"],
      reason: "a comment sits inside `tags`",
    },
    {
      description: "a comment before a wrapped flow list, to write as a block",
      fixes: { shouldBlockTags: true },
      frontmatter: ["tags: # why", "  [b, a]"],
      reason: "something other than `:` sits between `tags` and its list",
    },
    {
      description: "a quoted tags key, to write as a block",
      fixes: { shouldBlockTags: true },
      frontmatter: ['"tags": [b, a]'],
      reason: "the `tags` key is quoted",
    },
    {
      description: "a comment line between two keys, to order",
      fixes: { keyOrder: ORDER },
      frontmatter: ["title: A", "# why", "type: Decision"],
      reason: "a comment line sits between two top-level keys",
    },
    {
      description: "an anchored key, to order",
      fixes: { keyOrder: ORDER },
      frontmatter: ["title: A", "&k type: Decision"],
      reason:
        "a top-level key is indented, or isn't a plain key at the start of its line",
    },
    {
      description: "a key that isn't a single value, to order",
      fixes: { keyOrder: ORDER },
      frontmatter: ["title: A", "? [a]", ": b"],
      reason:
        "a top-level key is indented, or isn't a plain key at the start of its line",
    },
    {
      description: "a document end marker, which would end it early",
      fixes: { keyOrder: ORDER },
      frontmatter: ["title: A", "type: Decision", "..."],
      reason: "the formatted frontmatter wouldn't be valid YAML",
    },
  ])("refuses $description", ({ fixes, frontmatter, reason }) => {
    // When - formatting it
    const formatted = formatRecord({
      ...NO_FIXES,
      ...fixes,
      text: record(frontmatter),
    });

    // Then - refused as a layout to fix by hand
    expect(formatted).toStrictEqual({
      isOk: false,
      kind: REFUSAL_KINDS.unsupportedLayout,
      reason: `${reason}; ${HAND_EDIT_HINT}`,
    });
  });
});

describe("checkFormatted", () => {
  test.each([
    {
      description: "a value that changed",
      edited: "title: B\ntype: x\n",
      expected: "the formatted frontmatter would be read as something else",
      keyOrder: undefined,
    },
    {
      description: "keys left out of order",
      edited: "title: A\ntype: x\n",
      expected: "the keys couldn't be put in order",
      keyOrder: ["type"],
    },
    {
      description: "an alias used too many times to expand",
      edited: `a: &a [x]\nb: [${Array.from({ length: 101 }, () => "*a").join(", ")}]\n`,
      expected: "the frontmatter uses an alias too many times to compare",
      keyOrder: undefined,
    },
    {
      description: "the same meaning, in order",
      edited: "type: x\ntitle: A\n",
      expected: undefined,
      keyOrder: ["type"],
    },
  ])(
    "says when the result means $description",
    ({ edited, expected, keyOrder }) => {
      // Given - the original frontmatter
      const doc = parseFrontmatter("title: A\ntype: x\n");

      // When - checking an edit of it
      const problem = checkFormatted({
        doc,
        edited,
        keyOrder,
        shouldSortTags: false,
      });

      // Then - the problem, if any
      expect(problem).toBe(expected);
    }
  );
});

describe("orderKeyNames", () => {
  test("puts the listed keys first, in order, then the rest as they were", () => {
    // When - ordering keys
    const names = orderKeyNames({
      keyOrder: ["type", "title"],
      names: ["status", "title", "x-a", "type", "tags"],
    });

    // Then - listed first, the rest in their own order
    expect(names).toStrictEqual(["type", "title", "status", "x-a", "tags"]);
  });
});
