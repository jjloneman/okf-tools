/*
 * Property tests for `formatRecord`: generate frontmatter as data, render it
 * in a random layout, and check the same promises on every one.
 *
 * - Every generated layout formats to the original meaning, its tags sorted
 *   when asked, its keys in the order asked, and `tags` a block list when
 *   asked.
 *
 * - Every line outside `tags`, and everything after the frontmatter, is kept
 *   byte for byte, and `generated` and `verified` are never touched.
 *
 * - Formatting the result again changes nothing.
 *
 * - The seed is fixed so CI is deterministic; a failure prints its seed and
 *   path, which `RUN_OPTIONS` takes to replay it.
 */
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { isSeq, parseDocument } from "yaml";

import { formatRecord } from "./format.ts";

/** A generated record: its fields and tags as data, and how to lay them out. */
type RecordModel = {
  /**
   * The text after the closing fence.
   *
   * @example `"\n# Title\n"`
   */
  body: string;

  /**
   * The top-level fields other than `tags`, in the order written, each one
   * line.
   *
   * @example `["type: Decision", "x-acme-owner: data"]`
   */
  fields: string[];

  /**
   * The line break every line ends in.
   *
   * @example `"\r\n"`
   */
  lineBreak: string;

  /**
   * The keys `key-order` lists, or `undefined` to leave the order alone.
   *
   * @example `["type", "tags"]`
   */
  order: string[] | undefined;

  /**
   * Whether the fixes write `tags` as a block list.
   *
   * @example true
   */
  shouldBlockTags: boolean;

  /**
   * Whether the fixes sort `tags`.
   *
   * @example true
   */
  shouldSortTags: boolean;

  /**
   * The tags, each as written, quotes included.
   *
   * @example `["b", "'a'"]`
   */
  tags: string[];

  /**
   * Where `tags` sits among the fields.
   *
   * @example 1
   */
  tagsAt: number;

  /**
   * How `tags` is laid out.
   *
   * @example "flowComment"
   */
  tagsLayout: TagsLayout;
};

/** How a generated `tags` list is laid out. */
type TagsLayout = "block" | "flow" | "flowComment" | "wrapped";

/*
 * Runs per property, and the seed that makes them repeatable.
 *
 * - To replay a failure, add the `seed` and `path` it printed here.
 */
const RUN_OPTIONS = { numRuns: 300, seed: 47 };

/** Every top-level field a record may carry beside `tags`. */
const FIELDS = [
  "type: Decision",
  "title: A title",
  'description: "One sentence."',
  "status: draft",
  "x-acme-owner: data-team",
  "generated: { by: claude-code/1.0, at: 2026-11-25T10:00:00Z }",
  "verified: { by: human:a, at: 2026-11-25T11:00:00Z }",
];

/** A tag as written: kebab-case, plain or quoted. */
const TAG_ARB = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{0,6}(?:-[a-z0-9]{1,6})?$/),
    fc.constantFrom("plain", "double", "single")
  )
  .map(([tag, quoting]) => {
    const quotes = { double: '"', plain: "", single: "'" }[quoting];

    return `${quotes}${tag}${quotes}`;
  });

const RECORD_ARB: fc.Arbitrary<RecordModel> = fc
  .record({
    body: fc.constantFrom("", "\n# Title\n", "\n---\nnot: frontmatter\n---\n"),
    fields: fc.shuffledSubarray(FIELDS, { minLength: 1 }),
    lineBreak: fc.constantFrom("\n", "\r\n"),
    order: fc.option(
      fc.shuffledSubarray(["type", "title", "tags", "status", "x-acme-owner"], {
        minLength: 1,
      }),
      { nil: undefined }
    ),
    shouldBlockTags: fc.boolean(),
    shouldSortTags: fc.boolean(),
    tags: fc.array(TAG_ARB, { maxLength: 12, minLength: 1 }),
    tagsAt: fc.nat(),
    tagsLayout: fc.constantFrom<TagsLayout>(
      "block",
      "flow",
      "flowComment",
      "wrapped"
    ),
  })
  .map((model) => ({ ...model, tagsAt: model.tagsAt % model.fields.length }));

/** Read a record's frontmatter as plain data. */
function readMeaning(text: string): Record<string, unknown> {
  const [, frontmatter = ""] = text.split(/^---\r?$/mu);

  return parseDocument(frontmatter, { schema: "failsafe" }).toJS() as Record<
    string,
    unknown
  >;
}

/** Render the whole record. */
function renderRecord(model: RecordModel): string {
  const { body, fields, lineBreak, tagsAt } = model;
  const lines = [
    "---",
    ...fields.slice(0, tagsAt),
    ...renderTags(model),
    ...fields.slice(tagsAt),
    "---",
  ];

  return `${lines.join(lineBreak)}${lineBreak}${body}`;
}

/** Lay out the `tags` lines. */
function renderTags(model: RecordModel): string[] {
  const { tags, tagsLayout } = model;
  const rendered: Record<TagsLayout, string[]> = {
    block: ["tags:", ...tags.map((tag) => `  - ${tag}`)],
    flow: [`tags: [${tags.join(", ")}]`],
    flowComment: [`tags: [${tags.join(", ")}] # kept`],
    wrapped: ["tags:", "  [", ...tags.map((tag) => `    ${tag},`), "  ]"],
  };

  return rendered[tagsLayout];
}

describe("formatRecord", () => {
  test("formats every layout to exactly the intended meaning", () => {
    fc.assert(
      fc.property(RECORD_ARB, (model) => {
        const { body, fields, lineBreak, order } = model;
        const text = renderRecord(model);

        // When - formatting the record
        const result = formatRecord({
          keyOrder: order,
          shouldBlockTags: model.shouldBlockTags,
          shouldSortSources: false,
          shouldSortTags: model.shouldSortTags,
          text,
        });

        // Then - the meaning, the tags' order and layout, every other line
        if (!result.isOk) {
          throw new Error(result.reason);
        }

        const before = readMeaning(text);
        const after = readMeaning(result.text);
        const tags = before.tags as string[];

        expect(after).toStrictEqual({
          ...before,
          // The default sort compares by code unit, as `tags-sorted` does.
          tags: model.shouldSortTags ? [...tags].sort() : tags,
        });
        expect(result.text.endsWith(`---${lineBreak}${body}`)).toBe(true);

        const lines = result.text.split(lineBreak);

        for (const field of fields) {
          expect(lines).toContain(field);
        }

        if (order !== undefined) {
          const keys = Object.keys(after);
          const listed = keys.filter((key) => order.includes(key));

          expect(listed).toStrictEqual(
            order.filter((key) => listed.includes(key))
          );
        }

        if (model.shouldBlockTags) {
          const doc = parseDocument(result.text.split(/^---\r?$/mu)[1] ?? "");
          const node = doc.get("tags", true);

          expect(isSeq(node) && node.flow !== true).toBe(true);
        }

        expect(
          formatRecord({
            keyOrder: order,
            shouldBlockTags: model.shouldBlockTags,
            shouldSortSources: false,
            shouldSortTags: model.shouldSortTags,
            text: result.text,
          })
        ).toStrictEqual(result);
      }),
      RUN_OPTIONS
    );
  });
});
