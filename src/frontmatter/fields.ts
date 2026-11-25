/*
 * Writes top-level frontmatter fields that each hold one value, in place, as
 * `verifyRecord` edits `verified`: `status` and `superseded_by` for
 * `okf deprecate`, and `stale_after` for `okf verify --stale-in`.
 *
 * - Edits replace only the characters they change, at the positions the
 *   parser reports, and the result is checked to mean the original plus the
 *   fields written, before it's returned.
 *
 * - Nothing here touches the file system or the clock.
 */
import type { YAMLMap } from "yaml";

import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, stringify } from "yaml";

import type { RecordVerification, TextEdit } from "./edit.ts";
import type { Frontmatter, FrontmatterKey, Placed } from "./shared.ts";

import { applyEdits, writeScalar } from "./edit.ts";
import { findAmbiguity } from "./meaning.ts";
import {
  describeYamlErrors,
  findFenceProblem,
  findLineEnd,
  findPair,
  isPlaced,
  parseFrontmatter,
  readIndent,
  readLineBreak,
  readNodeEnd,
  readString,
  splitFrontmatter,
} from "./shared.ts";
import { REFUSAL_KINDS } from "./types.ts";

/** What a refusal of an unsupported layout tells the person to do instead. */
const HAND_EDIT_HINT = "edit the record by hand";

/** One top-level field to write, and where it goes when it's missing. */
export type FieldWrite = {
  /**
   * The field a missing one is added after; at the end of the frontmatter
   * when that field is missing too, or when none is named.
   *
   * @example "status"
   */
  after?: FrontmatterKey | undefined;

  /**
   * The field's key.
   *
   * @example "superseded_by"
   */
  key: FrontmatterKey;

  /**
   * The value to write, as text.
   *
   * @example "/metrics/gross-margin.md"
   */
  value: string;
};

/** What `writeFields` needs: the fields, and the record they go in. */
export type WriteFieldsParams = {
  /**
   * The fields to write, each named once, in the order new ones are added.
   *
   * @example `[{ key: "status", value: "deprecated" }]`
   */
  fields: readonly FieldWrite[];

  /**
   * The record's text, frontmatter included.
   *
   * @example `"---\nstatus: stable\n---\n"`
   */
  text: string;
};

/** The edits that write the fields, or why they can't be made. */
type FieldsPlan =
  | {
      /**
       * The edits to make, none overlapping another.
       *
       * @example `[{ end: 14, start: 8, text: "deprecated" }]`
       */
      edits: TextEdit[];

      /**
       * Whether the edits can be made; `true` here.
       *
       * @example true
       */
      isOk: true;
    }
  | {
      /**
       * Whether the edits can be made; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not.
       *
       * @example "`stale_after` isn't a single value"
       */
      reason: string;
    };

/**
 * Write each field's value: a field that holds one value is overwritten,
 * keeping its quotes, and a missing one is added on a line of its own.
 *
 * - A field that already holds the value is left as written.
 *
 * - The same refusals as `verifyRecord`'s guard it: no frontmatter, YAML
 *   that isn't valid or whose meaning is ambiguous, a lone carriage return,
 *   frontmatter that isn't a block mapping, a field that holds more than one
 *   value, and an edit that would mean more than intended.
 *
 * - Everything outside the edited characters, line endings included, is kept
 *   byte for byte.
 */
export function writeFields(params: WriteFieldsParams): RecordVerification {
  const { fields, text: recordText } = params;
  const block = splitFrontmatter(recordText);

  if (block === undefined) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.noFrontmatter,
      reason: findFenceProblem(recordText) ?? "no frontmatter block",
    };
  }

  const { text } = block;
  const doc = parseFrontmatter(text);
  const inputProblem = describeYamlErrors(doc);

  if (inputProblem !== undefined) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidYaml,
      reason: inputProblem,
    };
  }

  // YAML 1.2 ends a line at a lone carriage return, though the parser reads
  // it as text, so other tools could read the edited record differently.
  if (/\r(?!\n)/u.test(text)) {
    return refuseLayout(
      "the frontmatter holds a carriage return that doesn't end a line"
    );
  }

  const ambiguity = findAmbiguity(doc);

  if (ambiguity !== undefined) {
    return refuseLayout(ambiguity);
  }

  const map = doc.contents;

  if (!isMap(map) || !isPlaced(map) || map.flow === true) {
    return refuseLayout("the frontmatter isn't a block mapping");
  }

  const plan = planFields({ fields, map, text });

  if (!plan.isOk) {
    return refuseLayout(plan.reason);
  }

  const edited = applyEdits({ edits: plan.edits, text });
  const meaningProblem = checkFields({ doc, edited, fields });

  if (meaningProblem !== undefined) {
    return refuseLayout(meaningProblem);
  }

  return {
    isOk: true,
    text: [
      recordText.slice(0, block.start),
      edited,
      recordText.slice(block.end),
    ].join(""),
  };
}

/**
 * Check that the edited frontmatter means the original with only the fields
 * written.
 *
 * @returns why it doesn't, or `undefined` when it does.
 */
function checkFields(params: {
  doc: Frontmatter;
  edited: string;
  fields: readonly FieldWrite[];
}): string | undefined {
  const { doc, edited, fields } = params;
  const names = fields.map(({ key }) => `\`${key}\``).join(" and ");
  const editedDoc = parseFrontmatter(edited);

  // A value such as `*a` reads as an alias, which can't be compared, or even
  // read, unless it resolves.
  if (editedDoc.errors.length > 0 || findAmbiguity(editedDoc) !== undefined) {
    return `the new ${names} wouldn't be valid YAML`;
  }

  // The frontmatter was checked to be a mapping, so it reads as an object.
  const expected = { ...(doc.toJS() as Record<string, unknown>) };

  for (const { key, value } of fields) {
    expected[key] = value;
  }

  return isDeepStrictEqual(editedDoc.toJS(), expected)
    ? undefined
    : `the new ${names} would be read as something else`;
}

/**
 * Write a value as a plain scalar where YAML reads it back as the same text,
 * else quoted.
 */
function formatValue(value: string): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

/**
 * Plan every field's edit: an overwrite of the value it holds, or a new line
 * after the field it follows, or at the end.
 *
 * - New lines at the same place are joined into one edit, in the order the
 *   fields are given, so none overlaps another.
 *
 * - New lines come first in the list: an empty value's overwrite starts
 *   where a line after it is added, and `applyEdits` applies edits that
 *   start together in the order given, from the end, so the line lands after
 *   the value.
 */
function planFields(params: {
  fields: readonly FieldWrite[];
  map: Placed<YAMLMap>;
  text: string;
}): FieldsPlan {
  const { fields, map, text } = params;
  const overwrites: TextEdit[] = [];
  const insertions = new Map<number, string[]>();

  for (const { after, key, value } of fields) {
    const pair = findPair({ key, map });

    if (pair !== undefined) {
      const node = pair.value;

      if (!isScalar(node) || !isPlaced(node)) {
        return { isOk: false, reason: `\`${key}\` isn't a single value` };
      }

      if (readString(node) !== value) {
        // A quoted value keeps its quotes, and the meaning check refuses one
        // that would need escaping inside them.
        const isQuoted =
          node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE";

        overwrites.push(
          writeScalar({
            node,
            text,
            value: isQuoted ? value : formatValue(value),
          })
        );
      }

      continue;
    }

    const anchor =
      after === undefined ? undefined : findPair({ key: after, map });
    const insertAt = findLineEnd({
      index:
        anchor === undefined
          ? readNodeEnd(map)
          : Math.max(readNodeEnd(anchor.key), readNodeEnd(anchor.value)),
      text,
    });
    const lineBreak = readLineBreak({ index: insertAt, text });
    const indent = readIndent({ index: map.range[0], text });
    const lines = insertions.get(insertAt) ?? [];

    lines.push(`${lineBreak}${indent}${key}: ${formatValue(value)}`);
    insertions.set(insertAt, lines);
  }

  const added = [...insertions].map(([insertAt, lines]): TextEdit => ({
    end: insertAt,
    start: insertAt,
    text: lines.join(""),
  }));

  return { edits: [...added, ...overwrites], isOk: true };
}

/** Refuse a layout that needs a hand edit, saying so. */
function refuseLayout(problem: string): RecordVerification {
  return {
    isOk: false,
    kind: REFUSAL_KINDS.unsupportedLayout,
    reason: `${problem}; ${HAND_EDIT_HINT}`,
  };
}
