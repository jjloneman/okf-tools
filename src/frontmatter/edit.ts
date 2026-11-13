/*
 * Signs a record off by editing its frontmatter in place.
 *
 * - Edits replace only the characters they change, at the positions the
 *   parser reports, never a YAML round-trip, so nothing else in the file is
 *   reformatted.
 *
 * - Every edit is planned against one parse and applied from the end of the
 *   text, and `checkMeaning` checks the result before it is returned.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import type { Scalar, YAMLMap, YAMLSeq } from "yaml";

import { stringify } from "yaml";

import type { EditableLayout, Entry } from "./layout.ts";
import type { FormatEntryParams } from "./meaning.ts";
import type { Placed, TextParams } from "./shared.ts";
import type { Timestamp, VerifyRecordParams } from "./types.ts";

import { readEditableLayout, readEntries } from "./layout.ts";
import { checkMeaning, createEntry, findAmbiguity } from "./meaning.ts";
import {
  describeYamlErrors,
  ENTRY_KEYS,
  findLineEnd,
  findPair,
  FRONTMATTER_KEYS,
  isSignersBy,
  parseFrontmatter,
  readContentEnd,
  readIndent,
  readLineBreak,
  readNodeEnd,
  splitFrontmatter,
} from "./shared.ts";
import { RECORD_STATUSES } from "./types.ts";

/** What a refusal of an unsupported layout tells the person to do instead. */
const HAND_EDIT_HINT = "edit the record by hand";

/** How far a list written under `verified` is indented past its key. */
const LIST_INDENT = "  ";

/**
 * The timestamp `findEditProblem` plans with; no refusal depends on it, since
 * a timestamp is always written the same way.
 */
const LISTING_AT = "1970-01-01T00:00:00Z";

/** The quote each quoted scalar style opens and closes with. */
const QUOTE_MARKS: ReadonlyMap<string | undefined, string> = new Map([
  ["QUOTE_DOUBLE", '"'],
  ["QUOTE_SINGLE", "'"],
]);

/** What `findEditProblem` needs: the record, and who would sign it. */
export type FindEditProblemParams = Pick<
  VerifyRecordParams,
  "text" | "verifiedBy"
>;

/** The outcome of verifying one record: its new text, or why it was refused. */
export type RecordVerification =
  | {
      /**
       * Whether the record was verified; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why the record can't be verified.
       *
       * @example "no frontmatter block"
       */
      reason: string;
    }
  | {
      /**
       * Whether the record was verified; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The record's new text.
       *
       * @example `"---\nstatus: stable\n---\n"`
       */
      text: string;
    };

/** What `addVerifiedField` needs: the top-level mapping, and the entry. */
type AddVerifiedFieldParams = {
  /**
   * The frontmatter's top-level mapping.
   *
   * @example `doc.contents`
   */
  map: Placed<YAMLMap>;
} & EntryEditParams;

/** What `appendToSequence` needs: the `verified` list, and the entry. */
type AppendToSequenceParams = {
  /**
   * The `verified` list, in flow or block style.
   *
   * @example `doc.get("verified", true)`
   */
  sequence: Placed<YAMLSeq>;
} & EntryEditParams;

/** What `applyEdits` needs: the edits, and the text they were planned on. */
type ApplyEditsParams = {
  /**
   * The edits, in any order, none overlapping another.
   *
   * @example `[{ end: 13, start: 8, text: "stable" }]`
   */
  edits: TextEdit[];
} & TextParams;

/** What `convertToList` needs: the `verified` value and key, and the entry. */
type ConvertToListParams = {
  /**
   * Where the `verified` key starts, so the new list is indented past it.
   *
   * @example 0
   */
  keyStart: number;

  /**
   * Someone else's one-line entry, the `verified` value.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<YAMLMap>;
} & EntryEditParams;

/** What an edit that writes the signer's new entry needs. */
type EntryEditParams = {
  /**
   * The new entry, as a flow mapping.
   *
   * @example `"{ by: human:jjloneman, at: 2026-10-02T13:30:00Z }"`
   */
  entry: string;
} & TextParams;

/** What `planVerifiedEdit` needs: the editable layout, who, and when. */
type PlanVerifiedEditParams = {
  /**
   * The frontmatter's `status` and `verified`, checked editable.
   *
   * @example `readEditableLayout({ doc, text }).layout`
   */
  layout: EditableLayout;

  /**
   * The opening fence's line break, for a line added to empty frontmatter.
   *
   * @example `"\n"`
   */
  lineBreak: string;
} & Pick<VerifyRecordParams, "at" | "verifiedBy"> &
  TextParams;

/** What `renewOwnEntry` needs: the entry, its text, and the new timestamp. */
type RenewOwnEntryParams = {
  /**
   * The timestamp to write.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  at: Timestamp;

  /**
   * The signer's entry.
   *
   * @example `readEntries(layout.verified)[0]`
   */
  entry: Entry;
} & TextParams;

/** One change to the frontmatter: a range of characters, and its new text. */
type TextEdit = {
  /**
   * Where the replaced characters end, exclusive.
   *
   * @example 13
   */
  end: number;

  /**
   * Where the replaced characters start; equal to `end` for an insertion.
   *
   * @example 8
   */
  start: number;

  /**
   * The text written in their place.
   *
   * @example "stable"
   */
  text: string;
};

/** An edit, or why it can't be made. */
type TextEditResult =
  | {
      /**
       * The edit to make.
       *
       * @example `{ end: 13, start: 8, text: "stable" }`
       */
      edit: TextEdit;

      /**
       * Whether the edit can be made; `true` here.
       *
       * @example true
       */
      isOk: true;
    }
  | {
      /**
       * Whether the edit can be made; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why the edit can't be made.
       *
       * @example "`verified` is a nested mapping, not a list"
       */
      reason: string;
    };

/** What `writeScalar` needs: the scalar, its text, and the new value. */
type WriteScalarParams = {
  /**
   * The scalar to overwrite.
   *
   * @example `doc.get("status", true)`
   */
  node: Placed<Scalar>;

  /**
   * The new value, without quotes.
   *
   * @example "stable"
   */
  value: string;
} & TextParams;

/**
 * Say why a record can't be signed off by `verifiedBy` as it stands, so a
 * listing can report it before anyone chooses it.
 *
 * @returns the refusal `verifyRecord` would give, or `undefined` when none.
 */
export function findEditProblem(
  params: FindEditProblemParams
): string | undefined {
  const result = verifyRecord({ ...params, at: LISTING_AT });

  return result.isOk ? undefined : result.reason;
}

/**
 * Mark a record verified: `draft` becomes `stable`, and `verifiedBy`'s entry
 * gets `at` as its timestamp.
 *
 * - An existing entry for `verifiedBy` has its `at` updated rather than
 *   gaining a second entry; one without an `at` gains one.
 *
 * - Only the layouts `readEditableLayout` allows are edited; any other, or
 *   frontmatter that isn't valid YAML, is refused for a person to edit by hand.
 *
 * - A new entry lands after the `generated` field, or after `status` when there
 *   is no `generated`, or at the end; `generated` may be inline or a nested
 *   block.
 *
 * - Everything outside the edited characters, line endings included, is kept
 *   byte for byte.
 */
export function verifyRecord(params: VerifyRecordParams): RecordVerification {
  const { at, text: recordText, verifiedBy } = params;

  // A name over several lines would be written as a multi-line entry, which
  // the next sign-off would then refuse.
  if (/[\n\r]/u.test(verifiedBy)) {
    return { isOk: false, reason: "the signer's name holds a line break" };
  }

  const block = splitFrontmatter(recordText);

  if (block === undefined) {
    return { isOk: false, reason: "no frontmatter block" };
  }

  const { lineBreak, text } = block;
  const doc = parseFrontmatter(text);
  const inputProblem = describeYamlErrors(doc);

  if (inputProblem !== undefined) {
    return { isOk: false, reason: inputProblem };
  }

  // YAML 1.2 ends a line at a lone carriage return, though the parser reads
  // it as text, so other tools could read the edited record differently.
  if (/\r(?!\n)/u.test(text)) {
    return {
      isOk: false,
      reason: `the frontmatter holds a carriage return that doesn't end a line; ${HAND_EDIT_HINT}`,
    };
  }

  const ambiguity = findAmbiguity(doc);

  if (ambiguity !== undefined) {
    return { isOk: false, reason: `${ambiguity}; ${HAND_EDIT_HINT}` };
  }

  const layout = readEditableLayout({ doc, text, verifiedBy });

  if (!layout.isOk) {
    return { isOk: false, reason: `${layout.reason}; ${HAND_EDIT_HINT}` };
  }

  const verifiedEdit = planVerifiedEdit({
    at,
    layout: layout.layout,
    lineBreak,
    text,
    verifiedBy,
  });

  if (!verifiedEdit.isOk) {
    return { isOk: false, reason: `${verifiedEdit.reason}; ${HAND_EDIT_HINT}` };
  }

  const edits = [verifiedEdit.edit];
  const { status } = layout.layout;

  if (status !== undefined) {
    edits.push(
      writeScalar({ node: status, text, value: RECORD_STATUSES.stable })
    );
  }

  const edited = applyEdits({ edits, text });

  const editedDoc = parseFrontmatter(edited);
  const meaningProblem = checkMeaning({ at, doc, editedDoc, verifiedBy });

  if (meaningProblem !== undefined) {
    return { isOk: false, reason: `${meaningProblem}; ${HAND_EDIT_HINT}` };
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

/** Plan the edit that adds an `at` to the signer's entry, which has none. */
function addTimestamp(params: RenewOwnEntryParams): TextEdit {
  const { at, entry, text } = params;
  const { node } = entry;
  const field = `${ENTRY_KEYS.at}: ${at}`;

  if (node.flow === true) {
    const insertAt = Math.max(
      ...node.items.flatMap(({ key, value }) => [
        readNodeEnd(key),
        readNodeEnd(value),
      ])
    );

    return { end: insertAt, start: insertAt, text: `, ${field}` };
  }

  const insertAt = findLineEnd({ index: readNodeEnd(node), text });
  const lineBreak = readLineBreak({ index: insertAt, text });
  const indent = readIndent({ index: node.range[0], text });

  return {
    end: insertAt,
    start: insertAt,
    text: `${lineBreak}${indent}${field}`,
  };
}

/**
 * Plan the edit that adds a `verified` field to a mapping that has none, after
 * `generated`, else after `status`, else at the end.
 */
function addVerifiedField(params: AddVerifiedFieldParams): TextEdit {
  const { entry, map, text } = params;
  const field = `${FRONTMATTER_KEYS.verified}: ${entry}`;
  const anchor =
    findPair({ key: FRONTMATTER_KEYS.generated, map }) ??
    findPair({ key: FRONTMATTER_KEYS.status, map });

  const indent = readIndent({ index: map.range[0], text });

  const insertAt = findLineEnd({
    index:
      anchor === undefined
        ? readNodeEnd(map)
        : Math.max(readNodeEnd(anchor.key), readNodeEnd(anchor.value)),
    text,
  });

  const lineBreak = readLineBreak({ index: insertAt, text });

  return {
    end: insertAt,
    start: insertAt,
    text: `${lineBreak}${indent}${field}`,
  };
}

/** Plan the edit that appends the signer's entry to the `verified` list. */
function appendToSequence(params: AppendToSequenceParams): TextEdit {
  const { entry, sequence, text } = params;

  if (sequence.flow === true) {
    if (sequence.items.length === 0) {
      const [open, close] = sequence.range;
      const inside = text.slice(open + 1, close - 1);

      // Spaces inside `[ ]` are kept on both sides of the entry.
      return {
        end: close - 1,
        start: open + 1,
        text: inside === "" ? entry : ` ${entry} `,
      };
    }

    const insertAt = Math.max(...sequence.items.map(readNodeEnd));

    return { end: insertAt, start: insertAt, text: `, ${entry}` };
  }

  const insertAt = findLineEnd({ index: readNodeEnd(sequence), text });
  const lineBreak = readLineBreak({ index: insertAt, text });
  const indent = readIndent({ index: sequence.range[0], text });

  return {
    end: insertAt,
    start: insertAt,
    text: `${lineBreak}${indent}- ${entry}`,
  };
}

/**
 * Plan the edit that adds a `verified` field to frontmatter with no mapping,
 * only comments or nothing at all.
 */
function appendVerifiedField(
  params: EntryEditParams & Pick<PlanVerifiedEditParams, "lineBreak">
): TextEdit {
  const { entry, text } = params;
  const lineBreak =
    text === ""
      ? params.lineBreak
      : readLineBreak({
          index: findLineEnd({ index: text.length, text }),
          text,
        });

  return {
    end: text.length,
    start: text.length,
    text: `${FRONTMATTER_KEYS.verified}: ${entry}${lineBreak}`,
  };
}

/**
 * Apply edits planned against one text, from the last to the first, so each
 * edit's positions still hold when it's applied.
 */
function applyEdits(params: ApplyEditsParams): string {
  const { edits, text } = params;

  return [...edits]
    .sort((first, second) => second.start - first.start)
    .reduce(
      (edited, { end, start, text: replacement }) =>
        `${edited.slice(0, start)}${replacement}${edited.slice(end)}`,
      text
    );
}

/**
 * Plan the edit that turns someone else's one-line entry into a block list of
 * that entry and the signer's, keeping any trailing comment on the key's line.
 */
function convertToList(params: ConvertToListParams): TextEdit {
  const { entry, keyStart, node, text } = params;
  const [start, end] = node.range;
  const value = text.slice(start, end);
  const keyEnd = readContentEnd({ index: start, text });
  const lineEnd = findLineEnd({ index: end, text });
  const lineBreak = readLineBreak({ index: lineEnd, text });
  const comment = text.slice(end, lineEnd);
  const indent = `${readIndent({ index: keyStart, text })}${LIST_INDENT}`;

  return {
    end: lineEnd,
    start: keyEnd,
    text: [
      comment,
      `${lineBreak}${indent}- ${value}`,
      `${lineBreak}${indent}- ${entry}`,
    ].join(""),
  };
}

/** Write the signer's new entry as YAML, quoting `verifiedBy` if it must be. */
function formatEntry(params: FormatEntryParams): string {
  return stringify(createEntry(params), { lineWidth: 0 }).trimEnd();
}

/** Plan the edit that adds or renews the signer's `verified` entry. */
function planVerifiedEdit(params: PlanVerifiedEditParams): TextEditResult {
  const { at, layout, lineBreak, text, verifiedBy } = params;
  const { map, verified } = layout;
  const ownEntry = readEntries(verified).find(
    ({ by }) => by !== undefined && isSignersBy({ by, verifiedBy })
  );

  if (ownEntry !== undefined) {
    return { edit: renewOwnEntry({ at, entry: ownEntry, text }), isOk: true };
  }

  const entry = formatEntry({ at, verifiedBy });

  switch (verified.kind) {
    case "absent": {
      return {
        edit:
          map === undefined
            ? appendVerifiedField({ entry, lineBreak, text })
            : addVerifiedField({ entry, map, text }),
        isOk: true,
      };
    }

    case "entry": {
      const { node } = verified.entry;

      // Re-indenting a block mapping into a list item is a rewrite, not an
      // edit, so it's left for a person.
      if (node.flow !== true) {
        return {
          isOk: false,
          reason: "`verified` is a nested mapping, not a list",
        };
      }

      return {
        edit: convertToList({
          entry,
          keyStart: verified.key.range[0],
          node,
          text,
        }),
        isOk: true,
      };
    }

    case "list": {
      return {
        edit: appendToSequence({ entry, sequence: verified.node, text }),
        isOk: true,
      };
    }

    case "null": {
      return {
        edit: writeScalar({ node: verified.node, text, value: entry }),
        isOk: true,
      };
    }
  }
}

/** Plan the edit that renews the signer's `at`, or adds one it lacks. */
function renewOwnEntry(params: RenewOwnEntryParams): TextEdit {
  const { at, entry, text } = params;

  return entry.at === undefined
    ? addTimestamp(params)
    : writeScalar({ node: entry.at, text, value: at });
}

/**
 * Plan the edit that overwrites a scalar, keeping its quotes, or fills an
 * empty one after its key.
 */
function writeScalar(params: WriteScalarParams): TextEdit {
  const { node, text, value } = params;
  const [start, end] = node.range;

  if (start === end) {
    const keyEnd = readContentEnd({ index: start, text });
    const gap = /^[#}]/.test(text.slice(end)) ? " " : "";

    return { end, start: keyEnd, text: ` ${value}${gap}` };
  }

  const quote = QUOTE_MARKS.get(node.type) ?? "";
  const contentEnd = readContentEnd({ index: end, text });

  return { end: contentEnd, start, text: `${quote}${value}${quote}` };
}
