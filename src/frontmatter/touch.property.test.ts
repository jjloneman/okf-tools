/*
 * Property tests for `touchRecord`: generate frontmatter as data, render it in
 * a random layout, and check the same promises on every one.
 *
 * - Every generated layout is re-stamped, to exactly the original plus the new
 *   `generated`, and `status: draft` when a `stable` record is drafted.
 *
 * - Everything outside the frontmatter is kept byte for byte, and `verified`
 *   is never added or changed.
 *
 * - The seed is fixed so CI is deterministic; a failure prints its seed and
 *   path, which `RUN_OPTIONS` takes to replay it.
 */
import fc from "fast-check";
import { DateTime } from "luxon";
import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";

import { touchRecord } from "./touch.ts";

/** How a record's `generated` is laid out, if it has one. */
type GeneratedLayout =
  | "absent"
  | "block"
  | "blockNoAt"
  | "blockNoBy"
  | "empty"
  | "emptyFlow"
  | "inline"
  | "inlineNoAt"
  | "inlineNoBy"
  | "tilde";

/** A generated record: its fields as data, and how to lay them out. */
type RecordModel = {
  /**
   * The text after the closing fence.
   *
   * @example `"\n# Title\n"`
   */
  body: string;

  /**
   * Whether a comment line precedes each top-level field, by its index.
   *
   * @example `[true, false]`
   */
  comments: boolean[];

  /**
   * The fields other than `status`, `generated`, and `verified`.
   *
   * @example `[{ key: "title", value: "A" }]`
   */
  fields: { key: string; value: string }[];

  /**
   * How `generated` is laid out.
   *
   * @example "inline"
   */
  generated: GeneratedLayout;

  /**
   * Where `generated` goes among the fields.
   *
   * @example 1
   */
  generatedIndex: number;

  /**
   * How far every top-level key is indented.
   *
   * @example "  "
   */
  indent: string;

  /**
   * Whether the record carries a `verified` entry, at the end.
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
   * The record's status and where it goes, if it has one.
   *
   * @example `{ index: 0, value: "stable" }`
   */
  status: { index: number; value: string } | undefined;
};

/*
 * Runs per property, and the seed that makes them repeatable.
 *
 * - To replay a failure, add the `seed` and `path` it printed here.
 */
const RUN_OPTIONS = { numRuns: 300, seed: 54 };

/** The old `generated` values every layout that holds them writes. */
const OLD_AT = "2026-10-01T15:00:00Z";
const OLD_BY = "claude-code/2.1.0";

/** The `verified` line a signed-off record carries. */
const VERIFIED_LINE =
  "verified: { by: human:jjloneman, at: 2026-10-02T13:30:00Z }";

const FIELD_KEYS = ["type", "title", "description", "tags", "note"];

const GENERATED_LAYOUTS: readonly GeneratedLayout[] = [
  "absent",
  "block",
  "blockNoAt",
  "blockNoBy",
  "empty",
  "emptyFlow",
  "inline",
  "inlineNoAt",
  "inlineNoBy",
  "tilde",
];

/** Plain text that YAML reads as itself, in flow and block context alike. */
const TEXT_ARB = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 .]{0,10}[A-Za-z0-9]$/);

/** A producer, as `<producer>/<version>`. */
const BY_ARB = fc.stringMatching(/^[a-z][a-z-]{0,8}\/[0-9]\.[0-9]{1,2}$/);

/** A whole-second UTC timestamp, as `okf touch` writes them. */
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
    fieldKeys: fc.subarray(FIELD_KEYS),
    fieldValues: fc.array(TEXT_ARB, {
      maxLength: FIELD_KEYS.length,
      minLength: FIELD_KEYS.length,
    }),
    generated: fc.constantFrom(...GENERATED_LAYOUTS),
    indent: fc.constantFrom("", "", "  "),
    isVerified: fc.boolean(),
    lineBreak: fc.constantFrom("\n", "\r\n"),
    positions: fc.tuple(fc.nat(), fc.nat()),
    status: fc.option(fc.constantFrom("draft", "stable", "deprecated"), {
      nil: undefined,
    }),
    withComments: fc.array(fc.boolean(), { maxLength: 8, minLength: 8 }),
  })
  .map(
    ({
      body,
      fieldKeys,
      fieldValues,
      generated,
      indent,
      isVerified,
      lineBreak,
      positions,
      status,
      withComments,
    }) => {
      const fields = fieldKeys.map((key, index) => ({
        key,
        value: fieldValues[index] ?? "x",
      }));
      const statusIndex = positions[0] % (fields.length + 1);
      const fieldCount = fields.length + (status === undefined ? 0 : 1);

      return {
        body,
        comments: withComments,
        fields,
        generated,
        generatedIndex: positions[1] % (fieldCount + 1),
        indent,
        isVerified,
        lineBreak,
        status:
          status === undefined
            ? undefined
            : { index: statusIndex, value: status },
      };
    }
  );

/** Whether a value read from YAML is a mapping, as a plain object. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read frontmatter as the edits do, with YAML's failsafe schema. */
function readYaml(text: string): unknown {
  return parseDocument(text, { schema: "failsafe" }).toJS();
}

/** Render a model's frontmatter lines, without fences or line breaks. */
function renderFrontmatter(model: RecordModel): string[] {
  const { comments, fields, generated, generatedIndex, indent, status } = model;
  const entries: string[][] = fields.map(({ key, value }) => [
    `${key}: ${value}`,
  ]);

  if (status !== undefined) {
    entries.splice(status.index, 0, [`status: ${status.value}`]);
  }

  const generatedLines = renderGenerated(generated);

  if (generatedLines.length > 0) {
    entries.splice(generatedIndex, 0, generatedLines);
  }

  if (model.isVerified) {
    entries.push([VERIFIED_LINE]);
  }

  return entries.flatMap((lines, index) => [
    ...(comments[index] === true ? [`${indent}# a comment`] : []),
    ...lines.map((line) => `${indent}${line}`),
  ]);
}

/** Render `generated`'s lines in a layout, before the indent. */
function renderGenerated(layout: GeneratedLayout): string[] {
  const layouts: Record<GeneratedLayout, string[]> = {
    absent: [],
    block: ["generated:", `  by: ${OLD_BY}`, `  at: ${OLD_AT}`],
    blockNoAt: ["generated:", `  by: ${OLD_BY}`],
    blockNoBy: ["generated:", `  at: ${OLD_AT}`],
    empty: ["generated:"],
    emptyFlow: ["generated: {}"],
    inline: [`generated: { by: ${OLD_BY}, at: ${OLD_AT} }`],
    inlineNoAt: [`generated: { by: ${OLD_BY} }`],
    inlineNoBy: [`generated: { at: ${OLD_AT} }`],
    tilde: ["generated: ~"],
  };

  return layouts[layout];
}

describe("touchRecord over generated layouts", () => {
  test("re-stamps every layout to exactly the intended meaning", () => {
    fc.assert(
      fc.property(
        RECORD_ARB,
        BY_ARB,
        AT_ARB,
        fc.boolean(),
        (model, by, at, shouldDraft) => {
          const { body, lineBreak } = model;
          const frontmatter = renderFrontmatter(model)
            .map((line) => `${line}${lineBreak}`)
            .join("");
          const opening = `---${lineBreak}`;
          const closing = `---${lineBreak}${body}`;
          const text = `${opening}${frontmatter}${closing}`;

          // When - re-stamping it
          const result = touchRecord({ at, by, shouldDraft, text });

          // Then - edited, inside the fences only
          expect(result.isOk).toBe(true);

          if (!result.isOk) {
            return;
          }

          expect(result.text.startsWith(opening)).toBe(true);
          expect(result.text.endsWith(closing)).toBe(true);

          const edited = result.text.slice(
            opening.length,
            result.text.length - closing.length
          );

          // Then - every line break the record's own
          expect(
            edited.split(lineBreak).some((line) => /[\r\n]/u.test(line))
          ).toBe(false);
          expect(edited.endsWith(lineBreak)).toBe(true);

          // Then - the original plus the new generated, verified untouched
          const original = readYaml(frontmatter);
          const before = isPlainRecord(original) ? original : {};
          const oldGenerated = before.generated;
          const expected: Record<string, unknown> = {
            ...before,
            generated: {
              ...(isPlainRecord(oldGenerated) ? oldGenerated : {}),
              at,
              by,
            },
          };

          if (shouldDraft && model.status?.value === "stable") {
            expected.status = "draft";
          }

          const after = readYaml(edited);
          expect(after).toStrictEqual(expected);
          expect(isPlainRecord(after) ? after.verified : {}).toStrictEqual(
            before.verified
          );
        }
      ),
      RUN_OPTIONS
    );
  });
});
