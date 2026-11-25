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
import type { YAMLMap, YAMLSeq } from "yaml";

import { isMap, isScalar, Scalar, stringify } from "yaml";

import type { EditableLayout, Entry } from "./layout.ts";
import type { FormatEntryParams } from "./meaning.ts";
import type { Placed, TextParams } from "./shared.ts";
import type {
  EntryStyle,
  RefusalKind,
  Timestamp,
  VerifyRecordParams,
} from "./types.ts";

import { readEditableLayout, readEntries } from "./layout.ts";
import { checkMeaning, createEntry, findAmbiguity } from "./meaning.ts";
import {
  describeYamlErrors,
  ENTRY_KEYS,
  ENTRY_STYLE_NAMES,
  findFenceProblem,
  findLatestIndex,
  findLineEnd,
  findPair,
  FRONTMATTER_KEYS,
  isEntryStyle,
  isNullScalar,
  isSignersBy,
  isWritableTimestamp,
  LF,
  parseFrontmatter,
  readContentEnd,
  readIndent,
  readLineBreak,
  readLineStart,
  readNodeEnd,
  readTimestamp,
  splitFrontmatter,
} from "./shared.ts";
import { ENTRY_STYLES, RECORD_STATUSES, REFUSAL_KINDS } from "./types.ts";

/** What a refusal of an unsupported layout tells the person to do instead. */
const HAND_EDIT_HINT = "edit the record by hand";

/** How far a list written under `verified` is indented past its key. */
const LIST_INDENT = "  ";

/** What starts a list item's first line, and how far its later lines go. */
const LIST_MARKER = "- ";

/**
 * The timestamp `findEditProblem` plans with; no refusal depends on it, since
 * any valid timestamp is written as one value on one line.
 */
const LISTING_AT = "1970-01-01T00:00:00Z";

/** The quote each quoted scalar style opens and closes with. */
const QUOTE_MARKS: ReadonlyMap<string | undefined, string> = new Map([
  ["QUOTE_DOUBLE", '"'],
  ["QUOTE_SINGLE", "'"],
]);

/** What `applyEdits` needs: the edits, and the text they were planned on. */
export type ApplyEditsParams = {
  /**
   * The edits, in any order, none overlapping another.
   *
   * @example `[{ end: 13, start: 8, text: "stable" }]`
   */
  edits: TextEdit[];
} & TextParams;

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
       * Why the record can't be verified, as a code to switch on.
       *
       * @example "noFrontmatter"
       */
      kind: RefusalKind;

      /**
       * Why the record can't be verified, in words.
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

/** One change to the frontmatter: a range of characters, and its new text. */
export type TextEdit = {
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

/** What `writeScalar` needs: the scalar, its text, and the new value. */
export type WriteScalarParams = {
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
   * The new entry, written out.
   *
   * @example `formatEntry({ at, form, verifiedBy })`
   */
  entry: NewEntry;
} & TextParams;

/** How the signer's new entry is written, as `readEntryForm` decides it. */
type EntryForm = {
  /**
   * How the new `at` is quoted, as the record's other timestamps are.
   *
   * @example "PLAIN"
   */
  atType: Scalar.Type;

  /**
   * Whether `by` and `at` go on lines of their own, in a `-` list.
   *
   * @example false
   */
  isBlock: boolean;
};

/** What `formatEntry` needs: who signs, when, and in what form. */
type FormatNewEntryParams = {
  /**
   * How the entry is written.
   *
   * @example `{ atType: "PLAIN", isBlock: false }`
   */
  form: EntryForm;
} & FormatEntryParams;

/** The signer's new entry, written out. */
type NewEntry = {
  /**
   * Whether it's a block mapping, written only as a `-` list item.
   *
   * @example false
   */
  isBlock: boolean;

  /**
   * Its text, unindented: one line inline, or one line each for `by` and
   * `at`, split by `\n`, as a block.
   *
   * @example `"{ by: human:jjloneman, at: 2026-10-02T13:30:00Z }"`
   */
  text: string;
};

/** What `planVerifiedEdit` needs: the editable layout, who, and when. */
type PlanVerifiedEditParams = {
  /**
   * How a new entry is written.
   *
   * @example `readEntryForm({ layout, style: "match" })`
   */
  form: EntryForm;

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

/** What `readEntryForm` needs: the editable layout, and the style asked for. */
type ReadEntryFormParams = {
  /**
   * The frontmatter's `status` and `verified`, checked editable.
   *
   * @example `readEditableLayout({ doc, text }).layout`
   */
  layout: EditableLayout;

  /**
   * The style asked for.
   *
   * @example "match"
   */
  style: EntryStyle;
};

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

/** What `replaceNull` needs: the null `verified`, its key, the entry. */
type ReplaceNullParams = {
  /**
   * Where the `verified` key starts, so the new list is indented past it.
   *
   * @example 0
   */
  keyStart: number;

  /**
   * The null `verified` value.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<Scalar>;
} & EntryEditParams;

/** The edits, or why they can't be made. */
type TextEditResult =
  | {
      /**
       * The edits to make, none overlapping another.
       *
       * @example `[{ end: 13, start: 8, text: "stable" }]`
       */
      edits: TextEdit[];

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

/** What `writeField` and `writeListItem` need: the entry, break, and indent. */
type WriteFieldParams = {
  /**
   * The new entry.
   *
   * @example `formatEntry({ at, form, verifiedBy })`
   */
  entry: NewEntry;

  /**
   * The indent the field's key, or the list item's marker, starts at.
   *
   * @example ""
   */
  indent: string;

  /**
   * The line break a block entry's lines are split by.
   *
   * @example `"\n"`
   */
  lineBreak: string;
};

/**
 * Apply edits planned against one text, from the last to the first, so each
 * edit's positions still hold when it's applied.
 */
export function applyEdits(params: ApplyEditsParams): string {
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
 * Say why a record can't be signed off by `verifiedBy` as it stands, so a
 * listing can report it before anyone chooses it.
 *
 * - It plans with a fixed, valid timestamp, so it never reports the refusal
 *   `verifyRecord` gives for a caller's own `at`.
 *
 * - It plans in the default style, `match`, since no refusal depends on the
 *   style; the property tests check every style against every layout.
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
 *   gaining a second entry; one without an `at` gains one. With several, the
 *   one with the latest readable `at` is updated, as the reads judge by it.
 *
 * - Only the layouts `readEditableLayout` allows are edited; any other, or
 *   frontmatter that isn't valid YAML, is refused for a person to edit by hand.
 *
 * - An `at` that isn't a timestamp as `VerifyRecordParams` describes is
 *   refused, so every sign-off it writes can be dated; it reads as `verified`
 *   unless `at` is earlier than the record's `generated.at`.
 *
 * - A refusal carries a `kind` to switch on, beside its `reason`.
 *
 * - A new entry lands after the `generated` field, or after `status` when there
 *   is no `generated`, or at the end; `generated` may be inline or a nested
 *   block.
 *
 * - A new entry is laid out as `style` says, `match` by default, and its `at`
 *   quoted as `generated.at` is, else as the first other entry's `at`; see
 *   `readEntryForm`.
 *
 * - Everything outside the edited characters, line endings included, is kept
 *   byte for byte.
 */
export function verifyRecord(params: VerifyRecordParams): RecordVerification {
  const {
    at,
    style = ENTRY_STYLES.match,
    text: recordText,
    verifiedBy,
  } = params;

  // A name over several lines would be written as a multi-line entry, which
  // the next sign-off would then refuse.
  if (/[\n\r]/u.test(verifiedBy)) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidParams,
      reason: "the signer's name holds a line break",
    };
  }

  // Any other `at` would be written as a sign-off the reads can't date, or
  // one other tools date differently.
  if (!isWritableTimestamp(at)) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidParams,
      reason: `the timestamp ${JSON.stringify(at)} isn't an RFC 3339 date and time with a zone, such as 2026-10-02T13:30:00Z`,
    };
  }

  // A caller without the types could pass any value, which would otherwise
  // write inline without a word.
  if (!isEntryStyle(style)) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidParams,
      reason: `the style ${JSON.stringify(style)} isn't one of ${ENTRY_STYLE_NAMES}`,
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

  const layout = readEditableLayout({ doc, text, verifiedBy });

  if (!layout.isOk) {
    return refuseLayout(layout.reason);
  }

  const form = readEntryForm({ layout: layout.layout, style });
  const verifiedEdit = planVerifiedEdit({
    at,
    form,
    layout: layout.layout,
    lineBreak,
    text,
    verifiedBy,
  });

  if (!verifiedEdit.isOk) {
    return refuseLayout(verifiedEdit.reason);
  }

  const edits = [...verifiedEdit.edits];
  const { status } = layout.layout;

  if (status !== undefined) {
    edits.push(
      writeScalar({ node: status, text, value: RECORD_STATUSES.stable })
    );
  }

  const edited = applyEdits({ edits, text });

  const editedDoc = parseFrontmatter(edited);
  const meaningProblem = checkMeaning({
    at,
    doc,
    editedDoc,
    isBlock: form.isBlock,
    verifiedBy,
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
 * Plan the edit that overwrites a scalar, keeping its quotes, or fills an
 * empty one after its key.
 */
export function writeScalar(params: WriteScalarParams): TextEdit {
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
  const field = writeField({ entry, indent, lineBreak });

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
        text: inside === "" ? entry.text : ` ${entry.text} `,
      };
    }

    const insertAt = Math.max(...sequence.items.map(readNodeEnd));

    return { end: insertAt, start: insertAt, text: `, ${entry.text}` };
  }

  const insertAt = findLineEnd({ index: readNodeEnd(sequence), text });
  const lineBreak = readLineBreak({ index: insertAt, text });
  const indent = readIndent({ index: sequence.range[0], text });

  return {
    end: insertAt,
    start: insertAt,
    text: writeListItem({ entry, indent, lineBreak }),
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
    text: `${writeField({ entry, indent: "", lineBreak })}${lineBreak}`,
  };
}

/**
 * Plan the edits that turn someone else's one-line entry into a block list of
 * that entry and the signer's, keeping every line break and comment in place.
 *
 * - An entry on a later line than the key gains its list marker where it
 *   stands, so the key's line, with its comment and line break, is untouched.
 *
 * - An entry on the key's line moves to the line after it, behind the key
 *   line's own line break, and any comment after it stays on the key's line.
 *
 * - The signer's entry goes after the comment lines the parser reads as
 *   trailing the entry, so it never comes between the entry and them.
 */
function convertToList(params: ConvertToListParams): TextEdit[] {
  const { entry, keyStart, node, text } = params;
  const [start, end, nodeEnd] = node.range;
  const keyEnd = readContentEnd({ index: start, text });
  const insertAt = findLineEnd({
    index: readContentEnd({ index: nodeEnd, text }),
    text,
  });
  const lineBreak = readLineBreak({ index: insertAt, text });

  if (text.slice(keyEnd, start).includes(LF)) {
    const indent = readIndent({ index: start, text });

    return [
      { end: start, start, text: LIST_MARKER },
      {
        end: insertAt,
        start: insertAt,
        text: writeListItem({ entry, indent, lineBreak }),
      },
    ];
  }

  const lineEnd = findLineEnd({ index: end, text });
  const comment = text.slice(end, lineEnd);
  const indent = `${readIndent({ index: keyStart, text })}${LIST_INDENT}`;
  const value = text.slice(start, end);

  return [
    {
      end: lineEnd,
      start: keyEnd,
      text: `${comment}${readLineBreak({ index: lineEnd, text })}${indent}${LIST_MARKER}${value}`,
    },
    {
      end: insertAt,
      start: insertAt,
      text: writeListItem({ entry, indent, lineBreak }),
    },
  ];
}

/**
 * Write the signer's new entry as YAML in the form given, quoting `verifiedBy`
 * if it must be.
 */
function formatEntry(params: FormatNewEntryParams): NewEntry {
  const { at, form } = params;
  const entry = createEntry(params);
  const atNode = new Scalar(at);

  atNode.type = form.atType;
  entry.set(ENTRY_KEYS.at, atNode);
  entry.flow = !form.isBlock;

  return {
    isBlock: form.isBlock,
    text: stringify(entry, { lineWidth: 0 }).trimEnd(),
  };
}

/** Plan the edit that adds or renews the signer's `verified` entry. */
function planVerifiedEdit(params: PlanVerifiedEditParams): TextEditResult {
  const { at, form, layout, lineBreak, text, verifiedBy } = params;
  const { map, verified } = layout;
  const ownEntries = readEntries(verified).filter(
    ({ by }) => by !== undefined && isSignersBy({ by, verifiedBy })
  );

  // The entry the state is judged by, as `findOwnEntry` picks it, so the
  // meaning check expects this one renewed.
  const ownEntry =
    ownEntries[findLatestIndex(ownEntries.map(({ at }) => readTimestamp(at)))];

  if (ownEntry !== undefined) {
    return {
      edits: [renewOwnEntry({ at, entry: ownEntry, text })],
      isOk: true,
    };
  }

  const entry = formatEntry({ at, form, verifiedBy });

  switch (verified.kind) {
    case "absent": {
      return {
        edits: [
          map === undefined
            ? appendVerifiedField({ entry, lineBreak, text })
            : addVerifiedField({ entry, map, text }),
        ],
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
        edits: convertToList({
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
        edits: [appendToSequence({ entry, sequence: verified.node, text })],
        isOk: true,
      };
    }

    case "null": {
      return {
        edits: entry.isBlock
          ? replaceNull({
              entry,
              keyStart: verified.key.range[0],
              node: verified.node,
              text,
            })
          : [writeScalar({ node: verified.node, text, value: entry.text })],
        isOk: true,
      };
    }
  }
}

/**
 * Decide how the signer's new entry is written.
 *
 * - `block` asks for a block mapping, and `match` asks for one when
 *   `generated` is written as a block mapping; an inline list can't hold one,
 *   so it gets an inline entry whatever the style.
 *
 * - The new `at` is quoted as `generated.at` is, else as the first other
 *   entry's `at`, so the record keeps one way of writing a timestamp; an
 *   `at` that's an alias or null is passed over, and with none left it's
 *   plain.
 */
function readEntryForm(params: ReadEntryFormParams): EntryForm {
  const { layout, style } = params;
  const { map, verified } = layout;
  const generated =
    map === undefined
      ? undefined
      : findPair({ key: FRONTMATTER_KEYS.generated, map })?.value;
  const generatedMap = isMap(generated) ? generated : undefined;
  const isInlineList = verified.kind === "list" && verified.node.flow === true;
  const isBlockAsked =
    style === ENTRY_STYLES.block ||
    (style === ENTRY_STYLES.match &&
      generatedMap !== undefined &&
      generatedMap.flow !== true);

  const timestamp = [
    generatedMap,
    ...readEntries(verified).map(({ node }) => node),
  ]
    .map((node) => node?.get(ENTRY_KEYS.at, true))
    .find((node) => isScalar(node) && !isNullScalar(node));

  return {
    atType:
      timestamp?.type !== undefined && QUOTE_MARKS.has(timestamp.type)
        ? timestamp.type
        : Scalar.PLAIN,
    isBlock: isBlockAsked && !isInlineList,
  };
}

/** Refuse a layout that needs a hand edit, saying so. */
function refuseLayout(problem: string): RecordVerification {
  return {
    isOk: false,
    kind: REFUSAL_KINDS.unsupportedLayout,
    reason: `${problem}; ${HAND_EDIT_HINT}`,
  };
}

/** Plan the edit that renews the signer's `at`, or adds one it lacks. */
function renewOwnEntry(params: RenewOwnEntryParams): TextEdit {
  const { at, entry, text } = params;

  return entry.at === undefined
    ? addTimestamp(params)
    : writeScalar({ node: entry.at, text, value: at });
}

/**
 * Plan the edits that replace a null `verified` with a `-` list of the
 * signer's block entry, on the lines after the key.
 *
 * - An empty null has no characters, so the key's line is left as it is.
 *
 * - A null on the key's line goes with the spaces before it, so a comment
 *   after it stays on the key's line.
 *
 * - A null on a later line goes with its whole line when nothing else is on
 *   it, or alone when a comment follows it, so that comment keeps its line.
 */
function replaceNull(params: ReplaceNullParams): TextEdit[] {
  const { entry, keyStart, node, text } = params;
  const [start, end] = node.range;
  const keyEnd = readContentEnd({ index: start, text });
  const insertAt = findLineEnd({
    index: start === end ? keyEnd : end,
    text,
  });

  const lineBreak = readLineBreak({ index: insertAt, text });
  const indent = `${readIndent({ index: keyStart, text })}${LIST_INDENT}`;
  const item = {
    end: insertAt,
    start: insertAt,
    text: writeListItem({ entry, indent, lineBreak }),
  };

  if (start === end) {
    return [item];
  }

  if (!text.slice(keyEnd, start).includes(LF)) {
    return [{ end, start: keyEnd, text: "" }, item];
  }

  const hasComment = text.slice(end, insertAt).trim() !== "";
  const previousLineEnd = findLineEnd({
    index: readLineStart({ index: start, text }) - 1,
    text,
  });

  return [
    hasComment
      ? { end, start, text: "" }
      : { end: insertAt, start: previousLineEnd, text: "" },
    item,
  ];
}

/**
 * Write a new `verified` field holding the entry, from the key on.
 *
 * - A block entry goes in a one-item list on the lines after the key, since a
 *   bare block mapping can't take a second signer's entry.
 */
function writeField(params: WriteFieldParams): string {
  const { entry, indent, lineBreak } = params;
  const key = `${FRONTMATTER_KEYS.verified}:`;

  return entry.isBlock
    ? `${key}${writeListItem({ entry, indent: `${indent}${LIST_INDENT}`, lineBreak })}`
    : `${key} ${entry.text}`;
}

/**
 * Write the entry as a `-` list item, each line on a line of its own after
 * the line break, with a block entry's later lines aligned under its first.
 */
function writeListItem(params: WriteFieldParams): string {
  const { entry, indent, lineBreak } = params;
  const continuation = " ".repeat(LIST_MARKER.length);

  return entry.text
    .split(LF)
    .map(
      (line, index) =>
        `${lineBreak}${indent}${index === 0 ? LIST_MARKER : continuation}${line}`
    )
    .join("");
}
