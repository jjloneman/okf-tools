/*
 * Re-stamps a record's `generated` after an edit, in place, as `verifyRecord`
 * edits `verified`.
 *
 * - Edits replace only the characters they change, at the positions the
 *   parser reports, and the result is checked to mean the original plus the
 *   new `generated`, and `status: draft` when asked, before it's returned.
 *
 * - It never adds or changes `verified`, so a signed-off record reads as
 *   changed until it's signed off again.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import type { YAMLMap } from "yaml";

import { isDeepStrictEqual } from "node:util";
import { isMap, isScalar, stringify } from "yaml";

import type { RecordVerification, TextEdit } from "./edit.ts";
import type { Frontmatter, Placed } from "./shared.ts";
import type { Timestamp } from "./types.ts";

import { applyEdits, writeScalar } from "./edit.ts";
import { createEntry, findAmbiguity } from "./meaning.ts";
import {
  describeYamlErrors,
  ENTRY_KEYS,
  findFenceProblem,
  findLineEnd,
  findPair,
  FRONTMATTER_KEYS,
  isNullScalar,
  isPlaced,
  isWritableTimestamp,
  parseFrontmatter,
  readIndent,
  readLineBreak,
  readNodeEnd,
  readString,
  splitFrontmatter,
} from "./shared.ts";
import { RECORD_STATUSES, REFUSAL_KINDS } from "./types.ts";

/** What a refusal of an unsupported layout tells the person to do instead. */
const HAND_EDIT_HINT = "edit the record by hand";

/** What `touchRecord` needs: the record, who edited it, and when. */
export type TouchRecordParams = {
  /**
   * The time to write as `generated.at`, as RFC 3339 profiles ISO 8601.
   *
   * @example "2026-11-25T21:24:51Z"
   */
  at: Timestamp;

  /**
   * Who edited the record, written as `generated.by`.
   *
   * @example "claude-code/claude-opus-5-5"
   */
  by: string;

  /**
   * Whether to set a `stable` record back to `status: draft`.
   *
   * @example true
   */
  shouldDraft: boolean;

  /**
   * The record's text, frontmatter included.
   *
   * @example `"---\ntype: Decision\ngenerated: { by: a/1, at: 2026-01-01T00:00:00Z }\n---\n"`
   */
  text: string;
};

/** The edits that re-stamp a record, or why they can't be made. */
type TouchPlan =
  | {
      /**
       * The edits to make, none overlapping another.
       *
       * @example `[{ end: 13, start: 8, text: "draft" }]`
       */
      edits: TextEdit[];

      /**
       * Whether a `stable` status is set back to `draft`.
       *
       * @example true
       */
      isDrafted: boolean;

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
       * @example "`generated` isn't a mapping"
       */
      reason: string;
    };

/**
 * Re-stamp a record's `generated`: `by` becomes `by`, and `at` becomes `at`,
 * each added when it's missing, and `generated` added after `status`, or at
 * the end, when the record has none.
 *
 * - With `shouldDraft`, a `stable` status becomes `draft`; any other status
 *   is left as it is.
 *
 * - The same refusals as `verifyRecord`'s guard it: no frontmatter, YAML
 *   that isn't valid or whose meaning is ambiguous, a lone carriage return,
 *   a `generated` that isn't a mapping, and an edit that would mean more
 *   than intended.
 *
 * - Everything outside the edited characters, line endings included, is kept
 *   byte for byte.
 */
export function touchRecord(params: TouchRecordParams): RecordVerification {
  const { at, by, shouldDraft, text: recordText } = params;

  if (/[\n\r]/u.test(by)) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidParams,
      reason: "the producer's name holds a line break",
    };
  }

  if (!isWritableTimestamp(at)) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidParams,
      reason: `the timestamp ${JSON.stringify(at)} isn't an RFC 3339 date and time with a zone, such as 2026-10-02T13:30:00Z`,
    };
  }

  const block = splitFrontmatter(recordText);

  if (block === undefined) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.noFrontmatter,
      reason: findFenceProblem(recordText) ?? "no frontmatter block",
    };
  }

  const { lineBreak, text } = block;
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

  const plan = planTouch({ at, by, doc, lineBreak, shouldDraft, text });

  if (!plan.isOk) {
    return refuseLayout(plan.reason);
  }

  const edited = applyEdits({ edits: plan.edits, text });
  const meaningProblem = checkTouch({
    at,
    by,
    doc,
    edited,
    isDrafted: plan.isDrafted,
  });

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
 * Plan the edits that add `by` and `at` to a `generated` mapping lacking
 * them: after its last item when it's inline, or on lines of their own when
 * it's a block.
 */
function addFields(params: {
  fields: readonly string[];
  map: Placed<YAMLMap>;
  text: string;
}): TextEdit {
  const { fields, map, text } = params;

  if (map.flow === true) {
    if (map.items.length === 0) {
      const [open, close] = map.range;
      const inside = text.slice(open + 1, close - 1);
      const joined = fields.join(", ");

      // Spaces inside `{ }` are kept on both sides of the fields.
      return {
        end: close - 1,
        start: open + 1,
        text: inside === "" ? joined : ` ${joined} `,
      };
    }

    const insertAt = Math.max(
      ...map.items.flatMap(({ key, value }) => [
        readNodeEnd(key),
        readNodeEnd(value),
      ])
    );

    return {
      end: insertAt,
      start: insertAt,
      text: fields.map((field) => `, ${field}`).join(""),
    };
  }

  const insertAt = findLineEnd({ index: readNodeEnd(map), text });
  const lineBreak = readLineBreak({ index: insertAt, text });
  const indent = readIndent({ index: map.range[0], text });

  return {
    end: insertAt,
    start: insertAt,
    text: fields.map((field) => `${lineBreak}${indent}${field}`).join(""),
  };
}

/**
 * Check that the edited frontmatter means the original with only the
 * intended changes: `generated.by` and `generated.at`, and `status: draft`
 * when it was set back.
 *
 * @returns why it doesn't, or `undefined` when it does.
 */
function checkTouch(params: {
  at: Timestamp;
  by: string;
  doc: Frontmatter;
  edited: string;
  isDrafted: boolean;
}): string | undefined {
  const { at, by, doc, edited, isDrafted } = params;
  const editedDoc = parseFrontmatter(edited);

  if (editedDoc.errors.length > 0) {
    return "the new `generated` wouldn't be valid YAML";
  }

  // A `by` such as `*a` reads as an alias, which can't be compared, or even
  // read, unless it resolves.
  if (findAmbiguity(editedDoc) !== undefined) {
    return "the new `generated` would be read as something else";
  }

  const original: unknown = doc.toJS();
  const expected: Record<string, unknown> = isPlainRecord(original)
    ? { ...original }
    : {};
  const generated = expected[FRONTMATTER_KEYS.generated];

  expected[FRONTMATTER_KEYS.generated] = {
    ...(isPlainRecord(generated) ? generated : {}),
    [ENTRY_KEYS.at]: at,
    [ENTRY_KEYS.by]: by,
  };

  if (isDrafted) {
    expected[FRONTMATTER_KEYS.status] = RECORD_STATUSES.draft;
  }

  return isDeepStrictEqual(editedDoc.toJS(), expected)
    ? undefined
    : "the new `generated` would be read as something else";
}

/** Whether a value read from YAML is a mapping, as a plain object. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Plan the edits that write `by` and `at` into the `generated` mapping that
 * holds them, renewing each that's a single value and adding each missing.
 */
function planGeneratedFields(params: {
  at: Timestamp;
  by: string;
  map: Placed<YAMLMap>;
  text: string;
}): TouchPlan {
  const { map, text } = params;
  const edits: TextEdit[] = [];
  const missing: string[] = [];

  for (const key of [ENTRY_KEYS.by, ENTRY_KEYS.at]) {
    const value = params[key];
    const pair = findPair({ key, map });

    if (pair === undefined) {
      missing.push(`${key}: ${value}`);
      continue;
    }

    if (!isScalar(pair.value) || !isPlaced(pair.value)) {
      return {
        isOk: false,
        reason: `\`generated.${key}\` isn't a single value`,
      };
    }

    edits.push(writeScalar({ node: pair.value, text, value }));
  }

  if (missing.length > 0) {
    edits.push(addFields({ fields: missing, map, text }));
  }

  return { edits, isDrafted: false, isOk: true };
}

/** Plan every edit: the status, when asked, and `generated`. */
function planTouch(params: {
  at: Timestamp;
  by: string;
  doc: Frontmatter;
  lineBreak: string;
  shouldDraft: boolean;
  text: string;
}): TouchPlan {
  const { at, by, doc, shouldDraft, text } = params;
  const field = `${FRONTMATTER_KEYS.generated}: ${stringify(
    createEntry({ at, verifiedBy: by }),
    { lineWidth: 0 }
  ).trimEnd()}`;
  const map = doc.contents;

  // Frontmatter of only comments, or nothing, parses to no mapping, so the
  // field can only go at its end.
  if (map === null) {
    const lineBreak =
      text === ""
        ? params.lineBreak
        : readLineBreak({
            index: findLineEnd({ index: text.length, text }),
            text,
          });

    return {
      edits: [
        { end: text.length, start: text.length, text: `${field}${lineBreak}` },
      ],
      isDrafted: false,
      isOk: true,
    };
  }

  if (!isMap(map) || !isPlaced(map)) {
    return { isOk: false, reason: "the frontmatter isn't a mapping" };
  }

  const statusPair = findPair({ key: FRONTMATTER_KEYS.status, map });
  const status = statusPair?.value;
  const stableStatus =
    shouldDraft &&
    isScalar(status) &&
    isPlaced(status) &&
    readString(status) === RECORD_STATUSES.stable
      ? status
      : undefined;
  const isDrafted = stableStatus !== undefined;
  const statusEdits =
    stableStatus === undefined
      ? []
      : [
          writeScalar({
            node: stableStatus,
            text,
            value: RECORD_STATUSES.draft,
          }),
        ];

  const generatedPair = findPair({ key: FRONTMATTER_KEYS.generated, map });
  const generated = generatedPair?.value;

  if (generatedPair === undefined) {
    const insertAt = findLineEnd({
      index:
        statusPair === undefined
          ? readNodeEnd(map)
          : Math.max(readNodeEnd(statusPair.key), readNodeEnd(status)),
      text,
    });
    const lineBreak = readLineBreak({ index: insertAt, text });
    const indent = readIndent({ index: map.range[0], text });

    return {
      edits: [
        ...statusEdits,
        {
          end: insertAt,
          start: insertAt,
          text: `${lineBreak}${indent}${field}`,
        },
      ],
      isDrafted,
      isOk: true,
    };
  }

  if (isScalar(generated) && isPlaced(generated) && isNullScalar(generated)) {
    return {
      edits: [
        ...statusEdits,
        writeScalar({
          node: generated,
          text,
          value: field.slice(`${FRONTMATTER_KEYS.generated}: `.length),
        }),
      ],
      isDrafted,
      isOk: true,
    };
  }

  if (!isMap(generated) || !isPlaced(generated)) {
    return { isOk: false, reason: "`generated` isn't a mapping" };
  }

  const fields = planGeneratedFields({ at, by, map: generated, text });

  return fields.isOk
    ? { edits: [...statusEdits, ...fields.edits], isDrafted, isOk: true }
    : fields;
}

/** Refuse a layout that needs a hand edit, saying so. */
function refuseLayout(problem: string): RecordVerification {
  return {
    isOk: false,
    kind: REFUSAL_KINDS.unsupportedLayout,
    reason: `${problem}; ${HAND_EDIT_HINT}`,
  };
}
