/*
 * Property tests for `writeFields`: generate frontmatter as data, render it
 * in a random layout, and check the same promises on every one.
 *
 * - Every generated layout gets exactly the original plus the fields written,
 *   for both edits that use it: `okf deprecate`'s and `okf verify
 *   --stale-in`'s.
 *
 * - Every line that holds no written field, and everything after the
 *   frontmatter, is kept byte for byte, in order.
 *
 * - The seed is fixed so CI is deterministic; a failure prints its seed and
 *   path, which `RUN_OPTIONS` takes to replay it.
 */
import fc from "fast-check";
import { DateTime } from "luxon";
import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";

import type { FieldWrite } from "./fields.ts";

import { writeFields } from "./fields.ts";

/** A generated record: its fields as data, and how to lay them out. */
type RecordModel = {
  /**
   * The text after the closing fence.
   *
   * @example `"\n# Title\n"`
   */
  body: string;

  /**
   * The fields the edits never write.
   *
   * @example `[{ key: "title", value: "A" }]`
   */
  fields: { key: string; value: string }[];

  /**
   * How far every top-level key is indented.
   *
   * @example "  "
   */
  indent: string;

  /**
   * Whether the record carries a `verified` entry, after the other fields.
   *
   * @example true
   */
  isVerified: boolean;

  /**
   * The line break every line ends in.
   *
   * @example `"\r\n"`
   */
  lineBreak: string;

  /**
   * How `stale_after` is laid out, at the end.
   *
   * @example "double"
   */
  staleAfter: ValueLayout;

  /**
   * How `status` is laid out, first.
   *
   * @example "plain"
   */
  status: ValueLayout;

  /**
   * How `superseded_by` is laid out, after `status`.
   *
   * @example "absent"
   */
  supersededBy: ValueLayout;
};

/** How a field the edit writes is laid out, if the record has it. */
type ValueLayout =
  | "absent"
  | "double"
  | "doubleComment"
  | "empty"
  | "plain"
  | "plainComment"
  | "single"
  | "tilde";

/*
 * Runs per property, and the seed that makes them repeatable.
 *
 * - To replay a failure, add the `seed` and `path` it printed here.
 */
const RUN_OPTIONS = { numRuns: 300, seed: 55 };

const FIELD_KEYS = ["type", "title", "description", "note"];

const VALUE_LAYOUTS: readonly ValueLayout[] = [
  "absent",
  "double",
  "doubleComment",
  "empty",
  "plain",
  "plainComment",
  "single",
  "tilde",
];

/** Plain text that YAML reads as itself. */
const TEXT_ARB = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .]{0,10}[A-Za-z0-9]$/);

/** A path from the bundle root, as `okf deprecate` writes them. */
const PATH_ARB = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,8}(?:\/[a-z][a-z0-9-]{0,8})?$/)
  .map((name) => `/${name}.md`);

/** A whole-second UTC timestamp, as `okf verify --stale-in` writes them. */
const AT_ARB = fc
  .integer({ max: 4_102_444_800_000, min: 946_684_800_000 })
  .map((millis) =>
    DateTime.fromMillis(millis, { zone: "utc" }).toFormat(
      "yyyy-MM-dd'T'HH:mm:ss'Z'"
    )
  );

const RECORD_ARB: fc.Arbitrary<RecordModel> = fc
  .record({
    body: fc.constantFrom("", "\n# Title\n", "\n---\nnot: frontmatter\n---\n"),
    fieldKeys: fc.subarray(FIELD_KEYS, { minLength: 1 }),
    fieldValues: fc.array(TEXT_ARB, {
      maxLength: FIELD_KEYS.length,
      minLength: FIELD_KEYS.length,
    }),
    indent: fc.constantFrom("", "  "),
    isVerified: fc.boolean(),
    lineBreak: fc.constantFrom("\n", "\r\n"),
    staleAfter: fc.constantFrom(...VALUE_LAYOUTS),
    status: fc.constantFrom(...VALUE_LAYOUTS),
    supersededBy: fc.constantFrom(...VALUE_LAYOUTS),
  })
  .map(({ fieldKeys, fieldValues, ...rest }) => ({
    ...rest,
    fields: fieldKeys.map((key, index) => ({
      key,
      value: fieldValues[index] ?? "x",
    })),
  }));

/** Check the promises every edit keeps, for one record and its fields. */
function checkEdit(params: {
  fields: readonly FieldWrite[];
  model: RecordModel;
}): void {
  const { fields, model } = params;
  const text = renderRecord(model);
  const written = new Set<string>(fields.map(({ key }) => key));

  // When - writing the fields
  const result = writeFields({ fields, text });

  // Then - it means the original plus the fields, keeping every other line
  if (!result.isOk) {
    throw new Error(result.reason);
  }

  const expected = {
    ...(readMeaning(text) as Record<string, unknown>),
    ...Object.fromEntries(fields.map(({ key, value }) => [key, value])),
  };

  expect(readMeaning(result.text)).toStrictEqual(expected);
  expect(result.text.endsWith(`---${model.lineBreak}${model.body}`)).toBe(true);

  const kept = renderLines(model).filter(
    (line) => !written.has(line.trim().split(":")[0] ?? "")
  );
  const editedLines = result.text.split(model.lineBreak);
  let cursor = 0;

  for (const line of kept) {
    cursor = editedLines.indexOf(line, cursor) + 1;
    expect(cursor).toBeGreaterThan(0);
  }
}

/** Read a record's frontmatter as plain data. */
function readMeaning(text: string): unknown {
  const [, frontmatter = ""] = text.split(/^---\r?$/mu);

  return parseDocument(frontmatter, { schema: "failsafe" }).toJS();
}

/** Lay out the record's frontmatter lines, without their line breaks. */
function renderLines(model: RecordModel): string[] {
  return [
    ...renderValue({ key: "status", layout: model.status, value: "stable" }),
    ...renderValue({
      key: "superseded_by",
      layout: model.supersededBy,
      value: "/old.md",
    }),
    ...model.fields.map(({ key, value }) => `${key}: ${value}`),
    ...(model.isVerified
      ? ["verified:", "  - by: human:a", "    at: 2026-10-02T13:30:00Z"]
      : []),
    ...renderValue({
      key: "stale_after",
      layout: model.staleAfter,
      value: "2026-01-01T00:00:00Z",
    }),
  ].map((line) => `${model.indent}${line}`);
}

/** Render the whole record. */
function renderRecord(model: RecordModel): string {
  const { body, lineBreak } = model;
  const lines = ["---", ...renderLines(model), "---"];

  return `${lines.join(lineBreak)}${lineBreak}${body}`;
}

/** Lay out one field the edits may write, or nothing when it's absent. */
function renderValue(params: {
  key: string;
  layout: ValueLayout;
  value: string;
}): string[] {
  const { key, layout, value } = params;
  const rendered: Record<ValueLayout, string[]> = {
    absent: [],
    double: [`${key}: "${value}"`],
    doubleComment: [`${key}: "${value}" # kept`],
    empty: [`${key}:`],
    plain: [`${key}: ${value}`],
    plainComment: [`${key}: ${value} # kept`],
    single: [`${key}: '${value}'`],
    tilde: [`${key}: ~`],
  };

  return rendered[layout];
}

describe("writeFields", () => {
  test("deprecates every layout to exactly the intended meaning", () => {
    fc.assert(
      fc.property(RECORD_ARB, PATH_ARB, (model, path) => {
        checkEdit({
          fields: [
            { key: "status", value: "deprecated" },
            { after: "status", key: "superseded_by", value: path },
          ],
          model,
        });
      }),
      RUN_OPTIONS
    );
  });

  test("writes stale_after in every layout to exactly the intended meaning", () => {
    fc.assert(
      fc.property(RECORD_ARB, AT_ARB, (model, staleAfter) => {
        checkEdit({
          fields: [
            { after: "verified", key: "stale_after", value: staleAfter },
          ],
          model,
        });
      }),
      RUN_OPTIONS
    );
  });
});
