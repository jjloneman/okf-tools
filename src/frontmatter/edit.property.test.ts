/*
 * Property tests for `verifyRecord`: generate frontmatter as data, render it in
 * a random layout, and check the same promises on every one.
 *
 * - Allowed layouts must always be edited, to exactly the intended meaning,
 *   with every other line kept byte for byte.
 *
 * - Refused layouts must always be refused with a reason, never edited.
 *
 * - The seed is fixed so CI is deterministic; a failure prints its seed and
 *   path, which `RUN_OPTIONS` takes to replay it.
 */
import fc from "fast-check";
import { DateTime } from "luxon";
import { afterEach, describe, expect, test, vi } from "vitest";
import { parseDocument } from "yaml";

import { currentTimestamp } from "../records.ts";
import { verifyRecord } from "./edit.ts";
import { getRecordState, readRecordSummary } from "./read.ts";
import { readTime } from "./shared.ts";

/** One `verified` entry, any of whose keys may be missing. */
type EntryModel = {
  /**
   * The entry's `at`.
   *
   * @example `{ style: "plain", value: "2026-09-01T00:00:00Z" }`
   */
  at: Scalar | undefined;

  /**
   * The entry's `by`.
   *
   * @example `{ style: "double", value: "human: x" }`
   */
  by: Scalar | undefined;

  /**
   * An anchor or tag on the first key, when written as a block mapping.
   *
   * @example "&k "
   */
  keyProperty: string;

  /**
   * A key the edits must leave alone.
   *
   * @example `{ style: "plain", value: "x" }`
   */
  note: Scalar | undefined;
};

/** A field other than `status` and `verified`. */
type FieldModel = {
  /**
   * The field's key.
   *
   * @example "title"
   */
  key: string;

  /**
   * An anchor or tag on the key, which the edits must indent past.
   *
   * @example "!!str "
   */
  keyProperty: string;

  /**
   * The field's value: a scalar, a `{ by, at }` mapping, or written raw.
   *
   * @example `{ style: "single", value: "Decision" }`
   */
  value: { at: Scalar; by: Scalar; isBlock: boolean } | RawValue | Scalar;
};

/** A value written as given, for layouts a `Scalar` can't describe. */
type RawValue = {
  /**
   * What follows the key on its line; `undefined` writes `? key` instead.
   *
   * @example " |"
   */
  head: string | undefined;

  /**
   * What the value means to YAML's failsafe schema.
   *
   * @example `"a\nb\n"`
   */
  meaning: null | string;

  /**
   * The value's further lines, indented past the key; `""` stays blank.
   *
   * @example `["  a", "  b"]`
   */
  tail: string[];
};

/** A generated record: its fields as data, and how to lay them out. */
type RecordModel = {
  /**
   * Lines that are only a comment, by the field index they precede.
   *
   * @example [0, 2]
   */
  commentsBefore: number[];

  /**
   * Each field other than `status` and `verified`.
   *
   * @example `[{ key: "title", keyProperty: "", value }]`
   */
  fields: FieldModel[];

  /**
   * How far every top-level key is indented.
   *
   * @example "  "
   */
  indent: string;

  /**
   * The line break of each line, cycled; one entry means a uniform file.
   *
   * @example `["\n", "\r\n"]`
   */
  lineBreaks: string[];

  /**
   * Where `status` goes among the fields, if the record has one.
   *
   * @example `{ comment: true, index: 1, value }`
   */
  status: { comment: boolean; index: number; value: Scalar } | undefined;

  /**
   * Where `verified` goes among the fields, and its layout.
   *
   * @example `{ index: 0, layout: { kind: "absent" } }`
   */
  verified: { index: number; layout: VerifiedModel };

  /**
   * The signer, who must appear as an entry's `by` to be renewed.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
};

/** The rendered record and which of its lines an edit may touch. */
type Rendered = {
  /**
   * Each frontmatter line with its line break, fences included, no body.
   *
   * @example `["---\n", "status: draft\n", "---\n"]`
   */
  lines: string[];

  /**
   * Indexes into `lines` an edit may change.
   *
   * @example `new Set([1])`
   */
  touchable: Set<number>;
};

/** One rendered frontmatter line, and whether an edit may touch it. */
type RenderedLine = {
  /**
   * Whether an edit may rewrite the line.
   *
   * @example false
   */
  isTouchable: boolean;

  /**
   * The line, without its line break.
   *
   * @example "verified: # key"
   */
  line: string;
};

/** One value in the generated frontmatter, and how it's quoted. */
type Scalar = {
  /**
   * How the value is written.
   *
   * @example "plain"
   */
  style: Style;

  /**
   * The value as YAML's failsafe schema reads it.
   *
   * @example "draft"
   */
  value: string;
};

/** How a scalar is written; `tagged` is plain with a `!!str` tag. */
type Style = "double" | "plain" | "single" | "tagged";

/** The layouts of `verified` the edits support. */
type VerifiedModel =
  | {
      /**
       * How far items sit past the key.
       *
       * @example "  "
       */
      blockIndent: string;

      /**
       * The list's entries, in order.
       *
       * @example `[entry]`
       */
      entries: EntryModel[];

      /**
       * The layout.
       *
       * @example "blockList"
       */
      kind: "blockList";
    }
  | {
      /**
       * The layout.
       *
       * @example "absent"
       */
      kind: "absent";
    }
  | {
      /**
       * The list's entries, in order.
       *
       * @example `[entry]`
       */
      entries: EntryModel[];

      /**
       * The layout.
       *
       * @example "flowList"
       */
      kind: "flowList";
    }
  | {
      /**
       * The single entry.
       *
       * @example `entry`
       */
      entry: EntryModel;

      /**
       * Whether an indented comment line trails the entry.
       *
       * @example true
       */
      hasTrailingComment: boolean;

      /**
       * Whether it's a block mapping rather than inline.
       *
       * @example false
       */
      isBlock: boolean;

      /**
       * Whether an inline entry sits on the line after the key.
       *
       * @example false
       */
      isNextLine: boolean;

      /**
       * The layout.
       *
       * @example "entry"
       */
      kind: "entry";
    }
  | {
      /**
       * Whether a comment follows the null.
       *
       * @example true
       */
      comment: boolean;

      /**
       * Whether the null sits on the line after the key.
       *
       * @example false
       */
      isNextLine: boolean;

      /**
       * The layout.
       *
       * @example "null"
       */
      kind: "null";

      /**
       * How the null is written.
       *
       * @example "~"
       */
      spelling: string;
    };

const AT = "2026-10-02T13:30:00Z";
const BODY = "\n# Title\n\nBody text.\n";
const HAND_EDIT_HINT = "; edit the record by hand";
const LATER_AT = "2026-10-03T08:15:00Z";
const OLD_ATS = ["2026-09-01T00:00:00Z", "2026-09-28T09:00:00Z"];
const RUN_OPTIONS = { numRuns: 400, seed: 13 };

/** Ten years in milliseconds, the most the clock lags a generation by. */
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/** Names that are safe unquoted, in flow and block context alike. */
/** The comment line that trails an inline entry, in the generated layouts. */
const TRAILING_COMMENT = "  # theirs";

const SAFE_NAMES = ["claude-code/model", "human:jjloneman", "human:someone"];

/** Names YAML would misread unquoted, so they're always quoted. */
const UNSAFE_NAMES = ["- x", "#x", "'x'", "[x]", "human: x", "x # y", "x, y"];

const NULL_SPELLINGS = ["", "NULL", "Null", "null", "~"];

/** Characters that drive YAML's grammar, plus a few letters and digits. */
const YAMLISH_CHARACTERS = [
  "-",
  ":",
  "#",
  "&",
  "*",
  "!",
  "?",
  "|",
  ">",
  "{",
  "}",
  "[",
  "]",
  ",",
  "'",
  '"',
  " ",
  "\t",
  "\r",
  "\n",
  "a",
  "b",
  "d",
  "r",
  "s",
  "t",
  "v",
  "y",
  "~",
  "0",
  "1",
  "2",
  "9",
  "\u2028",
  "\uFEFF",
];

const STATUSES = ["deprecated", "draft", "draft", "stable", "wip"];

/** Fragments of `status` or `verified` the edits refuse, each whole. */
const REFUSED_FRAGMENTS: string[][] = [
  ["status: &s draft", "phase: *s"],
  ["status: !!str draft"],
  ["status: >-", "  draft"],
  ['"status": draft'],
  ["kind: &k draft", "status: *k"],
  ["? verified"],
  ["? verified", ": ~"],
  ["verified: &v ~", "copy: *v"],
  ["verified: !!seq []"],
  ["verified: someone"],
  ['verified: "null"'],
  ["verified: |", "  someone"],
  ["verified:", "  by: human:someone"],
  ["verified: { by: human:someone,", "  at: 2026-09-01T00:00:00Z }"],
  ["verified: [", "  { by: human:someone },", "  ]"],
  ["verified:", "  - { by: human:someone,", "      at: 2026-09-01T00:00:00Z }"],
  ["theirs: &e { by: human:someone }", "verified: [*e]"],
  ["verified: [someone]"],
  ["verified: [[a]]"],
  ["me: &m human:someone", "verified: { by: *m }"],
  ["verified: { by: human:jjloneman, at: [x] }"],
  ["verified: { by: human:jjloneman, at: &t 2026-09-01T00:00:00Z }"],
  ["verified: { by: human:jjloneman, at }"],
  ["verified:", "  - by: human:jjloneman", "    at: |", "      x"],
  ["? [status]", ": x", "status: &s draft"],
];

/** One of the given values, in any style it can be written in. */
function oneOfArb(values: string[]): fc.Arbitrary<Scalar> {
  return fc.constantFrom(...values).chain(scalarArb);
}

/** Write a scalar in its style. */
function renderScalar(scalar: Scalar): string {
  switch (scalar.style) {
    case "double": {
      return JSON.stringify(scalar.value);
    }

    case "single": {
      return `'${scalar.value.replaceAll("'", "''")}'`;
    }

    case "tagged": {
      return `!!str ${scalar.value}`;
    }

    default: {
      return scalar.value;
    }
  }
}

/** A value in any style it can be written in. */
function scalarArb(value: string): fc.Arbitrary<Scalar> {
  const styles: Style[] =
    SAFE_NAMES.includes(value) || !/[#,:[\]'-]/u.test(value)
      ? ["double", "plain", "single"]
      : ["double", "single"];

  return fc.constantFrom(...styles).map((style) => ({ style, value }));
}

/** An `at`: an old timestamp in any style, or a plain null. */
const AT_ARB: fc.Arbitrary<Scalar> = fc.oneof(
  oneOfArb(OLD_ATS),
  fc
    .constantFrom(...NULL_SPELLINGS)
    .map((value): Scalar => ({ style: "plain", value }))
);

/** An entry, which may be the signer's. */
function entryArb(verifiedBy: string): fc.Arbitrary<EntryModel> {
  const taggedAt = fc
    .constantFrom(...OLD_ATS)
    .map((value): Scalar => ({ style: "tagged", value }));

  return fc
    .record({
      at: fc.option(fc.oneof(AT_ARB, taggedAt), { nil: undefined }),
      by: fc.option(
        fc.oneof(
          scalarArb(verifiedBy),
          oneOfArb([...SAFE_NAMES, ...UNSAFE_NAMES])
        ),
        { nil: undefined }
      ),
      keyProperty: KEY_PROPERTY_ARB,
      note: fc.option(oneOfArb(["a note", "x"]), { nil: undefined }),
    })
    .map((entry) =>
      // Only another person's at may carry a tag; the signer's is refused.
      isOwn({ entry, verifiedBy }) && entry.at?.style === "tagged"
        ? { ...entry, at: { ...entry.at, style: "plain" } }
        : entry
    );
}

/**
 * Find the signer's entry a sign-off renews: the one whose `at` is the latest
 * timestamp, the first of any that tie, or the first when none is one; `-1`
 * when the signer has none.
 */
function findRenewedIndex(params: {
  entries: readonly EntryModel[];
  verifiedBy: string;
}): number {
  const { entries, verifiedBy } = params;
  const ownIndexes = entries.flatMap((entry, index) =>
    isOwn({ entry, verifiedBy }) ? [index] : []
  );

  const readMillis = (index: number): number => {
    const value = entries[index]?.at?.value ?? "";

    return OLD_ATS.includes(value)
      ? DateTime.fromISO(value).toMillis()
      : Number.NEGATIVE_INFINITY;
  };

  return ownIndexes.reduce(
    (latest, index) =>
      readMillis(index) > readMillis(latest) ? index : latest,
    ownIndexes[0] ?? -1
  );
}

/** Whether an entry is the signer's. */
function isOwn(params: { entry: EntryModel; verifiedBy: string }): boolean {
  return params.entry.by?.value === params.verifiedBy;
}

/** A `verified` layout the edits support. */
function verifiedArb(verifiedBy: string): fc.Arbitrary<VerifiedModel> {
  const entry = entryArb(verifiedBy);
  const entries = fc.array(entry, { maxLength: 3 });

  return fc.oneof(
    fc.constant<VerifiedModel>({ kind: "absent" }),
    fc.record({
      comment: fc.boolean(),
      isNextLine: fc.boolean(),
      kind: fc.constant("null" as const),
      spelling: fc.constantFrom(...NULL_SPELLINGS),
    }),
    fc.record({ entries, kind: fc.constant("flowList" as const) }),
    fc.record({
      blockIndent: fc.constantFrom("", "  ", "    "),
      entries: fc.array(entry, { maxLength: 3, minLength: 1 }),
      kind: fc.constant("blockList" as const),
    }),

    // Someone else's block mapping is refused, so only the signer's is here.
    fc
      .record({
        entry,
        hasTrailingComment: fc.boolean(),
        isBlock: fc.boolean(),
        isNextLine: fc.boolean(),
        kind: fc.constant("entry" as const),
      })
      .map((model) =>
        isOwn({ entry: model.entry, verifiedBy })
          ? model
          : { ...model, isBlock: false }
      )
  );
}

/** No mark on a key, mostly, or an anchor or tag the edits must indent past. */
const KEY_PROPERTY_ARB = fc.constantFrom("", "", "&k ", "!!str ");

/** A field other than `status` and `verified`. */
const FIELD_ARB: fc.Arbitrary<FieldModel> = fc.oneof(
  fc.record({
    key: fc.constantFrom("note", "title", "type"),
    keyProperty: KEY_PROPERTY_ARB,
    value: oneOfArb(["Decision", "What: every export", "x # not a comment"]),
  }),
  fc.record({
    key: fc.constantFrom("generated", "note", "title", "type"),
    keyProperty: KEY_PROPERTY_ARB,
    value: fc.constantFrom<RawValue>(
      { head: "", meaning: "", tail: [] },
      { head: undefined, meaning: null, tail: [] },
      { head: " a", meaning: "a b", tail: ["  b"] },
      { head: " |", meaning: "a\nb\n", tail: ["  a", "  b"] },
      { head: " >-", meaning: "a b", tail: ["  a", "  b"] },
      { head: " |+", meaning: "a\n\n", tail: ["  a", ""] }
    ),
  }),
  fc.record({
    key: fc.constant("generated"),
    keyProperty: KEY_PROPERTY_ARB,
    value: fc.record({
      at: oneOfArb(OLD_ATS),
      by: oneOfArb(["claude-code/model"]),
      isBlock: fc.boolean(),
    }),
  })
);

/** A record in a layout the edits support. */
const RECORD_ARB: fc.Arbitrary<RecordModel> = fc
  .constantFrom(...SAFE_NAMES, ...UNSAFE_NAMES)
  .chain((verifiedBy) =>
    fc.record({
      commentsBefore: fc.array(fc.nat(4), { maxLength: 2 }),
      fields: fc.uniqueArray(FIELD_ARB, {
        maxLength: 3,
        selector: ({ key }) => key,
      }),
      indent: fc.constantFrom("", "  "),
      lineBreaks: fc.oneof(
        fc.constantFrom<string[]>(["\n"], ["\r\n"]),
        fc.array(fc.constantFrom<string>("\n", "\r\n"), {
          maxLength: 4,
          minLength: 2,
        })
      ),
      status: fc.option(
        fc.record({
          comment: fc.boolean(),
          index: fc.nat(3),
          value: oneOfArb(STATUSES),
        }),
        { nil: undefined }
      ),
      verified: fc.record({
        index: fc.nat(3),
        layout: verifiedArb(verifiedBy),
      }),
      verifiedBy: fc.constant(verifiedBy),
    })
  );

/** Build the meaning the edited frontmatter must have, from the model alone. */
function expectedMeaning(model: RecordModel): Record<string, unknown> {
  const meaning: Record<string, unknown> = {};

  for (const { key, value } of model.fields) {
    if ("tail" in value) {
      meaning[key] = value.meaning;
    } else {
      meaning[key] =
        "by" in value
          ? { at: value.at.value, by: value.by.value }
          : value.value;
    }
  }

  if (model.status !== undefined) {
    const { value } = model.status.value;

    meaning.status = value === "draft" ? "stable" : value;
  }

  const toObject = (entry: EntryModel): Record<string, string> =>
    Object.fromEntries(
      (["by", "at", "note"] as const).flatMap((key) => {
        const value = entry[key];

        return value === undefined ? [] : [[key, value.value]];
      })
    );

  const newEntry = { at: AT, by: model.verifiedBy };
  const { layout } = model.verified;

  const entries = readModelEntries(layout);

  const objects = entries.map(toObject);
  const ownIndex = findRenewedIndex({
    entries,
    verifiedBy: model.verifiedBy,
  });

  if (ownIndex !== -1) {
    objects[ownIndex] = { ...objects[ownIndex], at: AT };
  }

  switch (layout.kind) {
    case "absent":
    case "null": {
      meaning.verified = newEntry;
      break;
    }

    case "entry": {
      meaning.verified = ownIndex === -1 ? [...objects, newEntry] : objects[0];
      break;
    }

    default: {
      meaning.verified = ownIndex === -1 ? [...objects, newEntry] : objects;
    }
  }

  return meaning;
}

/** Whether `needle` appears in `haystack` in order, with gaps allowed. */
function isSubsequence(params: {
  haystack: string[];
  needle: string[];
}): boolean {
  let position = 0;

  for (const line of params.haystack) {
    if (line === params.needle[position]) {
      position += 1;
    }
  }

  return position === params.needle.length;
}

/** Read a record's frontmatter as YAML's failsafe schema means it. */
function readMeaning(text: string): unknown {
  const frontmatter =
    /^---\r?\n(?<frontmatter>[\s\S]*?)^---\r?$/mu.exec(text)?.groups
      ?.frontmatter ?? "";
  const doc = parseDocument(frontmatter, { schema: "failsafe" });

  expect(doc.errors).toStrictEqual([]);

  return doc.toJS();
}

/** List the entries of a generated `verified` layout, in order. */
function readModelEntries(layout: VerifiedModel): EntryModel[] {
  if (layout.kind === "entry") {
    return [layout.entry];
  }

  return layout.kind === "flowList" || layout.kind === "blockList"
    ? layout.entries
    : [];
}

/** Render a record, and note which lines the edits may touch. */
function render(model: RecordModel): Rendered {
  const { fields, indent, status, verified } = model;
  const blocks: RenderedLine[][] = fields.map((field) =>
    renderField({ field, indent }).map((line) => ({
      isTouchable: false,
      line,
    }))
  );

  const verifiedLines = renderVerified({ indent, layout: verified.layout });

  if (verifiedLines.length > 0) {
    blocks.splice(Math.min(verified.index, blocks.length), 0, verifiedLines);
  }

  if (status !== undefined) {
    const comment = status.comment ? " # wip" : "";

    blocks.splice(Math.min(status.index, blocks.length), 0, [
      {
        isTouchable: true,
        line: `${indent}status: ${renderScalar(status.value)}${comment}`,
      },
    ]);
  }

  for (const before of [...model.commentsBefore].sort((a, b) => b - a)) {
    blocks.splice(Math.min(before, blocks.length), 0, [
      { isTouchable: false, line: `${indent}# a comment` },
    ]);
  }

  const body = blocks.flat();

  const all = [
    { isTouchable: false, line: "---" },
    ...body,
    { isTouchable: false, line: "---" },
  ];

  const touchable = new Set<number>();
  const lines = all.map(({ isTouchable, line }, index) => {
    if (isTouchable) {
      touchable.add(index);
    }

    return `${line}${model.lineBreaks[index % model.lineBreaks.length] ?? "\n"}`;
  });

  return { lines, touchable };
}

/** Write an entry as block mapping lines, each at `indent`. */
function renderBlockEntry(params: {
  entry: EntryModel;
  indent: string;
}): string[] {
  const { entry, indent } = params;
  const lines = (["by", "at", "note"] as const).flatMap((key) => {
    const value = entry[key];

    return value === undefined ? [] : [`${key}: ${renderScalar(value)}`];
  });

  return lines.length === 0
    ? [`${indent}{}`]
    : lines.map((line, index) =>
        index === 0
          ? `${indent}${entry.keyProperty}${line}`
          : `${indent}${line}`
      );
}

/** Write a field other than `status` and `verified`. */
function renderField(params: { field: FieldModel; indent: string }): string[] {
  const { field, indent } = params;
  const { value } = field;
  const key = `${field.keyProperty}${field.key}`;

  if ("tail" in value) {
    const head =
      value.head === undefined
        ? `${indent}? ${key}`
        : `${indent}${key}:${value.head}`;

    return [
      head,
      ...value.tail.map((line) => (line === "" ? "" : `${indent}${line}`)),
    ];
  }

  if (!("by" in value)) {
    return [`${indent}${key}:\t${renderScalar(value)}`];
  }

  return value.isBlock
    ? [
        `${indent}${key}:`,
        `${indent}  by: ${renderScalar(value.by)}`,
        `${indent}  at: ${renderScalar(value.at)}`,
      ]
    : [
        `${indent}${key}: { by: ${renderScalar(value.by)}, at: ${renderScalar(value.at)} }`,
      ];
}

/** Write an entry as a one-line flow mapping. */
function renderFlowEntry(entry: EntryModel): string {
  const pairs = (["by", "at", "note"] as const).flatMap((key) => {
    const value = entry[key];

    return value === undefined ? [] : [`${key}: ${renderScalar(value)}`];
  });

  return pairs.length === 0 ? "{}" : `{ ${pairs.join(", ")} }`;
}

/** Write the lines of a `verified` layout an edit may rewrite throughout. */
function renderTouchableVerified(params: {
  indent: string;
  key: string;
  layout: VerifiedModel;
}): string[] {
  const { indent, key, layout } = params;

  switch (layout.kind) {
    case "absent": {
      return [];
    }

    case "blockList": {
      const itemIndent = `${indent}${layout.blockIndent}`;

      return [
        key,
        ...layout.entries.flatMap((entry, index) => {
          const lines =
            index % 2 === 0
              ? [`${itemIndent}- ${renderFlowEntry(entry)}`]
              : renderBlockEntry({ entry, indent: `${itemIndent}  ` }).map(
                  (line, lineIndex) =>
                    lineIndex === 0
                      ? `${itemIndent}- ${line.trimStart()}`
                      : line
                );

          return index === 0
            ? lines
            : [`${itemIndent}# item ${index}`, ...lines];
        }),
      ];
    }

    case "entry": {
      return [
        key,
        ...renderBlockEntry({ entry: layout.entry, indent: `${indent}  ` }),
      ];
    }

    case "flowList": {
      return [`${key} [${layout.entries.map(renderFlowEntry).join(", ")}]`];
    }

    case "null": {
      const comment = layout.comment ? " # none yet" : "";

      return layout.isNextLine && layout.spelling !== ""
        ? [key, `${indent}  ${layout.spelling}${comment}`]
        : [
            `${key}${layout.spelling === "" ? "" : ` ${layout.spelling}`}${comment}`,
          ];
    }
  }
}

/**
 * Write the `verified` field's lines, marking which an edit may touch.
 *
 * - Turning an inline entry into a list may touch only the entry's own line,
 *   so a key line above it and the comment line trailing it must survive.
 */
function renderVerified(params: {
  indent: string;
  layout: VerifiedModel;
}): RenderedLine[] {
  const { indent, layout } = params;
  const key = `${indent}verified:`;

  if (layout.kind === "entry" && !layout.isBlock) {
    const entry = renderFlowEntry(layout.entry);
    const trailing = layout.hasTrailingComment
      ? [{ isTouchable: false, line: `${indent}${TRAILING_COMMENT}` }]
      : [];

    return layout.isNextLine
      ? [
          { isTouchable: false, line: `${key} # key` },
          { isTouchable: true, line: `${indent}  ${entry} # one` },
          ...trailing,
        ]
      : [{ isTouchable: true, line: `${key} ${entry} # one` }, ...trailing];
  }

  return renderTouchableVerified({ indent, key, layout }).map((line) => ({
    isTouchable: true,
    line,
  }));
}

/** Split text into lines that keep their line breaks. */
function splitLines(text: string): string[] {
  return text.split(/(?<=\n)/u);
}

describe("verifyRecord over generated layouts", () => {
  test("edits every allowed layout to exactly the intended meaning", () => {
    fc.assert(
      fc.property(RECORD_ARB, (model) => {
        // Given - a record rendered from the model
        const { lines, touchable } = render(model);
        const text = `${lines.join("")}${BODY}`;

        // When - verifying it
        const result = verifyRecord({
          at: AT,
          text,
          verifiedBy: model.verifiedBy,
        });

        // Then - edited, meaning the input plus the sign-off, and read back
        expect(result).toMatchObject({ isOk: true });

        const edited = result.isOk ? result.text : "";

        expect(readMeaning(edited)).toStrictEqual(expectedMeaning(model));
        expect(
          readRecordSummary({ text: edited, verifiedBy: model.verifiedBy })
            ?.verifiedAt
        ).toBe(AT);

        // Then - every line no edit had reason to touch kept, break included
        const untouched = lines.filter((_line, index) => !touchable.has(index));

        expect(edited.endsWith(`${lines.at(-1) ?? ""}${BODY}`)).toBe(true);
        expect(
          isSubsequence({
            haystack: splitLines(edited.slice(0, -BODY.length)),
            needle: untouched,
          })
        ).toBe(true);

        // Then - a comment trailing someone else's entry stays above the new one
        const { layout } = model.verified;
        const isAddedBelowComment =
          layout.kind === "entry" &&
          layout.hasTrailingComment &&
          !layout.isBlock &&
          !isOwn({ entry: layout.entry, verifiedBy: model.verifiedBy });

        expect(
          !isAddedBelowComment ||
            edited.indexOf(TRAILING_COMMENT) < edited.indexOf(AT)
        ).toBe(true);
      }),
      RUN_OPTIONS
    );
  });

  test("changes only the signer's at when verified again", () => {
    fc.assert(
      fc.property(RECORD_ARB, (model) => {
        // Given - a record already verified once
        const text = `${render(model).lines.join("")}${BODY}`;
        const first = verifyRecord({
          at: AT,
          text,
          verifiedBy: model.verifiedBy,
        });
        const verified = first.isOk ? first.text : "";

        // When - verifying it again, at the same time and later
        const same = verifyRecord({
          at: AT,
          text: verified,
          verifiedBy: model.verifiedBy,
        });
        const later = verifyRecord({
          at: LATER_AT,
          text: verified,
          verifiedBy: model.verifiedBy,
        });

        // Then - no change, then only the timestamp, which appears once
        expect(verified.split(AT)).toHaveLength(2);
        expect(same).toStrictEqual({ isOk: true, text: verified });
        expect(later).toStrictEqual({
          isOk: true,
          text: verified.replace(AT, LATER_AT),
        });
      }),
      RUN_OPTIONS
    );
  });

  test("refuses every layout outside the allowlist, with a reason", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REFUSED_FRAGMENTS),
        fc.array(FIELD_ARB, { maxLength: 3 }),
        fc.nat(3),
        fc.constantFrom("\n", "\r\n"),
        (fragment, fields, index, lineBreak) => {
          // Given - a refused fragment among ordinary fields
          const blocks = fields
            .filter(
              ({ key }, position) =>
                fields.findIndex((field) => field.key === key) === position
            )
            .map((field) => renderField({ field, indent: "" }));

          blocks.splice(Math.min(index, blocks.length), 0, fragment);

          const lines = blocks.flat();

          const text = `${["---", ...lines, "---"].join(lineBreak)}${BODY}`;

          // When - verifying it
          const result = verifyRecord({
            at: AT,
            text,
            verifiedBy: "human:jjloneman",
          });

          // Then - refused, asking for a hand edit
          expect(result).toMatchObject({ isOk: false });
          expect(result.isOk ? "" : result.reason).toMatch(
            new RegExp(`\`(?:status|verified)\`.*${HAND_EDIT_HINT}$`, "u")
          );
        }
      ),
      RUN_OPTIONS
    );
  });

  test("never throws, whatever the text", () => {
    const yamlish = fc.string({
      unit: fc.constantFrom(...YAMLISH_CHARACTERS),
    });

    const prefixed = fc.oneof(
      yamlish,
      yamlish.map((text) => `---\n${text}\n---\n`),
      yamlish.map((text) => `---\nstatus: draft\nverified: ${text}\n---\n`)
    );

    fc.assert(
      fc.property(prefixed, (text) => {
        // When - reading and verifying any text
        const read = (): unknown =>
          readRecordSummary({ text, verifiedBy: "human:jjloneman" });
        const verify = (): unknown =>
          verifyRecord({ at: AT, text, verifiedBy: "human:jjloneman" });

        // Then - a result or a refusal, never an exception
        expect(read).not.toThrow();
        expect(verify).not.toThrow();
      }),
      RUN_OPTIONS
    );
  });

  test("refuses every signer whose name spans lines", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.string(), fc.constantFrom("\n", "\r"), fc.string()),
        RECORD_ARB,
        ([before, lineBreak, after], model) => {
          // Given - any record, and a signer whose name holds a line break
          const text = `${render(model).lines.join("")}${BODY}`;
          const verifiedBy = `${before}${lineBreak}${after}`;

          // When - verifying it
          const result = verifyRecord({ at: AT, text, verifiedBy });

          // Then - refused before any edit is planned
          expect(result).toStrictEqual({
            isOk: false,
            kind: "invalidParams",
            reason: "the signer's name holds a line break",
          });
        }
      ),
      RUN_OPTIONS
    );
  });
});

describe("the state right after a sign-off", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Any time from 2000 to 2100, to the millisecond. */
  const timeArb = fc.date({
    max: DateTime.fromISO("2100-01-01T00:00:00Z").toJSDate(),
    min: DateTime.fromISO("2000-01-01T00:00:00Z").toJSDate(),
    noInvalidDate: true,
  });

  test("is verified, for any record the listing accepts", () => {
    fc.assert(
      fc.property(
        RECORD_ARB,
        timeArb,
        fc.integer({ max: TEN_YEARS_MS, min: 0 }),
        fc.boolean(),
        (model, generatedAt, lagMs, isBlock) => {
          // Given - a record generated at any time, and the clock no earlier,
          // since the listing refuses a record ahead of it
          const now = new Date(generatedAt.getTime() + lagMs);
          const generated: FieldModel = {
            key: "generated",
            keyProperty: "",
            value: {
              at: { style: "plain", value: generatedAt.toISOString() },
              by: { style: "plain", value: "claude-code/model" },
              isBlock,
            },
          };
          const text = `${render({
            ...model,
            fields: [
              ...model.fields.filter(({ key }) => key !== "generated"),
              generated,
            ],
          }).lines.join("")}${BODY}`;

          vi.useFakeTimers({ now, toFake: ["Date"] });

          // When - signing it off at the time the CLI stamps
          const result = verifyRecord({
            at: currentTimestamp(),
            text,
            verifiedBy: model.verifiedBy,
          });

          // Then - it reads as verified
          const summary = readRecordSummary({
            text: result.isOk ? result.text : "",
            verifiedBy: model.verifiedBy,
          });

          expect(summary && getRecordState(summary)).toBe("verified");
        }
      ),
      RUN_OPTIONS
    );
  });

  /** Two digits, out of range as often as not. */
  const pairArb = fc
    .integer({ max: 99, min: 0 })
    .map((value) => String(value).padStart(2, "0"));

  /** A real time, written in each form the timestamp check accepts. */
  const writableAtArb = fc
    .tuple(
      timeArb,
      fc.constantFrom(
        "yyyy-MM-dd'T'HH:mm'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ssZZ",
        "yyyy-MM-dd'T'HH:mmZZ"
      ),
      fc.constantFrom("UTC", "UTC+5:30", "UTC-11")
    )
    .map(([time, format, zone]) =>
      DateTime.fromJSDate(time, { zone }).toFormat(format)
    );

  /**
   * Strings shaped like timestamps, valid or not, beside any string at all, so
   * both sides of the timestamp check are reached.
   */
  const atArb: fc.Arbitrary<string> = fc.oneof(
    fc.string(),
    writableAtArb,
    fc
      .tuple(
        fc.integer({ max: 9999, min: 0 }),
        pairArb,
        pairArb,
        fc.constantFrom("", "T", " ", "t"),
        fc.array(pairArb, { maxLength: 3, minLength: 1 }),
        fc.constantFrom("", ".5", ",5", ".123456789"),
        fc.constantFrom("", "Z", "z", "+02:00", "-0530", "-11", " # utc")
      )
      .map(([year, month, day, separator, times, fraction, zone]) => {
        const date = `${String(year).padStart(4, "0")}-${month}-${day}`;

        return separator === ""
          ? date
          : `${date}${separator}${times.join(":")}${fraction}${zone}`;
      })
  );

  test("accepts every timestamp in a writable form", () => {
    fc.assert(
      fc.property(writableAtArb, (at) => {
        // When - signing off a plain draft at that timestamp
        const result = verifyRecord({
          at,
          text: `---\nstatus: draft\n---\n${BODY}`,
          verifiedBy: "human:jjloneman",
        });

        // Then - accepted
        expect(result.isOk).toBe(true);
      }),
      RUN_OPTIONS
    );
  });

  test("is verified, for any timestamp it accepts", () => {
    fc.assert(
      fc.property(RECORD_ARB, atArb, (model, at) => {
        // Given - any record and any timestamp
        const text = `${render(model).lines.join("")}${BODY}`;

        // When - signing it off at that timestamp
        const result = verifyRecord({
          at,
          text,
          verifiedBy: model.verifiedBy,
        });

        // Then - when accepted, it reads as signed off no earlier than `at`
        if (!result.isOk) {
          return;
        }

        const summary = readRecordSummary({
          text: result.text,
          verifiedBy: model.verifiedBy,
        });

        expect({
          isReadable: readTime(at).isValid,
          state: summary && getRecordState({ ...summary, generatedAt: at }),
        }).toStrictEqual({ isReadable: true, state: "verified" });
      }),
      RUN_OPTIONS
    );
  });
});
