/*
 * The fixer and Prettier must not fight: what `formatRecord` writes, Prettier
 * at its defaults leaves alone, and what Prettier writes, the fixer leaves
 * alone, so a repo can run both on every commit.
 */
import { format } from "prettier";
import { describe, expect, test } from "vitest";

import { formatRecord } from "./format.ts";

/** Nine tags, longer than one line of 80 as a flow list, even on its own. */
const NINE_TAGS = [
  "agent-instructions",
  "ai-models",
  "claude-code",
  "frontmatter-layout",
  "open-knowledge",
  "prettier-format",
  "record-keeping",
  "tag-vocabulary",
  "yaml-sequences",
] as const;

/** Every fix on, as a repo turning on every fixable house rule asks. */
const FIXES = {
  keyOrder: ["type", "title", "description", "tags", "status"],
  shouldBlockTags: true,
  shouldSortSources: true,
  shouldSortTags: true,
} as const;

/** Format a record as Prettier does at its defaults. */
async function prettify(text: string): Promise<string> {
  return format(text, { parser: "markdown" });
}

/** Build a fabricated record whose tags are written in the lines given. */
function record(tagLines: readonly string[]): string {
  return [
    "---",
    "status: draft",
    "type: Decision",
    "title: How tags are laid out",
    "description: A record with nine tags, as a fixture.",
    ...tagLines,
    "generated: { by: claude-code/1.0, at: 2026-11-25T10:00:00Z }",
    "x-acme-owner: data-team",
    "---",
    "",
    "# How tags are laid out",
    "",
    "Body text.",
    "",
  ].join("\n");
}

describe("formatRecord with Prettier", () => {
  test.each([
    {
      description: "a 9-tag flow list",
      tagLines: [`tags: [${[...NINE_TAGS].reverse().join(", ")}]`],
    },
    {
      description: "a 3-tag flow list on a line of its own",
      tagLines: ["tags:", "  [tag-vocabulary, ai-models, yaml-sequences]"],
    },
    {
      description: "a 9-tag block list",
      tagLines: [
        "tags:",
        ...[...NINE_TAGS].reverse().map((tag) => `  - ${tag}`),
      ],
    },
  ])("writes $description as Prettier leaves it", async ({ tagLines }) => {
    // Given - a record out of order in every way the fixes put right
    const text = record(tagLines);

    // When - fixing it, then running Prettier over the result
    const fixed = formatRecord({ ...FIXES, text });

    if (!fixed.isOk) {
      throw new Error(fixed.reason);
    }

    // Then - Prettier changes nothing, and the tags are one sorted block
    expect(await prettify(fixed.text)).toBe(fixed.text);
    expect(fixed.text).toMatch(/\ntags:\n(?: {2}- [a-z-]+\n)+status: draft\n/u);
  });

  test("fixes what Prettier wrapped, and leaves Prettier's own output", async () => {
    // Given - a 9-tag flow list, as Prettier wraps it
    const wrapped = await prettify(
      record([`tags: [${[...NINE_TAGS].reverse().join(", ")}]`])
    );

    expect(wrapped).toContain("tags:\n  [\n");

    // When - fixing it, then fixing Prettier's output of that
    const fixed = formatRecord({ ...FIXES, text: wrapped });

    if (!fixed.isOk) {
      throw new Error(fixed.reason);
    }

    // Then - each leaves the other's output as it is
    const prettified = await prettify(fixed.text);

    expect(prettified).toBe(fixed.text);
    expect(formatRecord({ ...FIXES, text: prettified })).toStrictEqual(fixed);
  });
});
