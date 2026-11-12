/*
 * Pure helpers that read and edit the frontmatter of an OKF record.
 *
 * - Fields are read with a YAML parser, but edits replace only the characters
 *   they change, at the positions the parser reports, never a YAML round-trip,
 *   so nothing else in the file is reformatted.
 *
 * - The parser uses YAML's failsafe schema, so every value reads as the text
 *   written, such as a title of `0o17`, and nulls are recognized by spelling.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import type { Document, Node, Pair, Range, Scalar } from "yaml";

import { isDeepStrictEqual } from "node:util";
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  YAMLMap,
  YAMLSeq,
} from "yaml";

/** The lifecycle statuses OKF defines for a record. */
export const RECORD_STATUSES = {
  deprecated: "deprecated",
  draft: "draft",
  stable: "stable",
} as const;

/** The keys of one `verified` or `generated` entry. */
const ENTRY_KEYS = {
  at: "at",
  by: "by",
} as const;

/** The line that opens and closes a frontmatter block. */
const FENCE = "---";

/**
 * The frontmatter keys this module reads or writes.
 *
 * - OKF v0.2 requires only `type` and lets producers add any key, so this is
 *   the module's working set, not the format's full list.
 */
const FRONTMATTER_KEYS = {
  generated: "generated",
  status: "status",
  title: "title",
  type: "type",
  verified: "verified",
} as const;

/** How far a list written under `verified` is indented past its key. */
const LIST_INDENT = "  ";

/** How YAML spells null, other than leaving a value empty. */
const NULL_SPELLINGS: ReadonlySet<string> = new Set([
  "~",
  "null",
  "Null",
  "NULL",
]);

/** The quote each quoted scalar style opens and closes with. */
const QUOTE_MARKS: ReadonlyMap<string | undefined, string> = new Map([
  ["QUOTE_DOUBLE", '"'],
  ["QUOTE_SINGLE", "'"],
]);

/**
 * The statuses OKF defines, as a set for the type guard to look values up in.
 *
 * - Typed as `ReadonlySet<string>`, so `has` accepts any string, not only a
 *   status already known to be one.
 */
const RECORD_STATUS_VALUES: ReadonlySet<string> = new Set(
  Object.values(RECORD_STATUSES)
);

/** What `checkMeaning` needs: the original and edited parses, who, and when. */
export type CheckMeaningParams = {
  /**
   * The frontmatter after the edits, parsed.
   *
   * @example `parseFrontmatter("status: stable")`
   */
  editedDoc: Frontmatter;
} & PlanEntryParams;

/** What `readRecordSummary` needs: the record, and whose sign-off counts. */
export type ReadRecordSummaryParams = Pick<
  VerifyRecordParams,
  "text" | "verifiedBy"
>;

/**
 * Where a record stands with the human sign-off.
 *
 * - `unverified` has no sign-off from the verifier yet.
 * - `changed` was regenerated after the sign-off, so it needs a fresh one.
 * - `verified` was signed off and left alone since.
 */
export type RecordState = "changed" | "unverified" | "verified";

/** A lifecycle status OKF defines, such as `draft`. */
export type RecordStatus =
  (typeof RECORD_STATUSES)[keyof typeof RECORD_STATUSES];

/** The frontmatter fields the verify flow shows and decides on. */
export type RecordSummary = {
  /**
   * When the record was last generated, if it says.
   *
   * @example "2026-10-01T15:00:00Z"
   */
  generatedAt: Timestamp | undefined;

  /**
   * The record's `status`, when it is one OKF defines.
   *
   * - Absent means `stable`, as OKF defines it.
   *
   * @example "draft"
   */
  status: RecordStatus | undefined;

  /**
   * The record's `title`, without its quotes.
   *
   * @example "What every export promises"
   */
  title: string | undefined;

  /**
   * The record's `type`.
   *
   * @example "Decision"
   */
  type: string | undefined;

  /**
   * When `verifiedBy` last signed the record off, if they did.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  verifiedAt: Timestamp | undefined;
};

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

/** An ISO 8601 timestamp as a record writes it, such as `2026-10-02T13:30:00Z`. */
export type Timestamp = string;

/** What `verifyRecord` needs: the record, who signs it, and when. */
export type VerifyRecordParams = {
  /**
   * The UTC timestamp to record.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  at: Timestamp;

  /**
   * The record's text, frontmatter included.
   *
   * @example `"---\nstatus: draft\n---\n"`
   */
  text: string;

  /**
   * Who is signing off.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
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
   * The `verified` value, which isn't a list.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<Node>;
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

/** What `findOwnEntry` needs: the parsed frontmatter, and whose entry. */
type FindOwnEntryParams = {
  /**
   * The frontmatter, parsed, or a copy of it.
   *
   * @example `parseFrontmatter("verified: { by: human:jjloneman }")`
   */
  doc: Document;
} & Pick<VerifyRecordParams, "verifiedBy">;

/** What `findPair` needs: the mapping, and which key. */
type FindPairParams = {
  /**
   * The key, without its colon.
   *
   * @example "status"
   */
  key: FrontmatterKey;

  /**
   * The mapping to search.
   *
   * @example `doc.contents`
   */
  map: YAMLMap;
};

/** What `formatEntry` needs: who signs, and when. */
type FormatEntryParams = Pick<VerifyRecordParams, "at" | "verifiedBy">;

/** A record's frontmatter, parsed with every value as text. */
type Frontmatter = Document.Parsed;

/** A record's text split around its frontmatter. */
type FrontmatterBlock = {
  /**
   * The line break the file uses, kept for every line written back.
   *
   * @example `"\n"`
   */
  lineBreak: string;

  /**
   * Everything after the opening fence, including the closing one.
   *
   * @example ["---", "", "# Title"]
   */
  rest: string[];

  /**
   * The frontmatter without its `---` fences, its lines joined by line feeds.
   *
   * @example `"type: Decision\nstatus: draft"`
   */
  text: string;
};

/** A frontmatter key this module reads or writes. */
type FrontmatterKey = (typeof FRONTMATTER_KEYS)[keyof typeof FRONTMATTER_KEYS];

/** A mapping's pair whose key is a single value, with where it sits. */
type KeyedPair = Pair<Placed<Scalar>>;

/** The signer's `verified` entry: a mapping, and where it sits in the text. */
type OwnEntry = Placed<YAMLMap>;

/** A parsed node, with where it sits in the text. */
type Placed<T extends Node> = {
  /**
   * Where the node starts, where its content ends, and where it ends with any
   * trailing comment.
   *
   * @example [14, 28, 28]
   */
  range: Range;
} & T;

/** The parsed frontmatter, who signs, and when. */
type PlanEntryParams = Pick<FindOwnEntryParams, "doc"> &
  Pick<VerifyRecordParams, "at" | "verifiedBy">;

/** What `planVerifiedEdit` needs: the parsed frontmatter, who, and when. */
type PlanVerifiedEditParams = PlanEntryParams & TextParams;

/** What a helper that reads a position in the frontmatter needs. */
type PositionParams = {
  /**
   * The position, as an index into the text.
   *
   * @example 14
   */
  index: number;
} & TextParams;

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
   * @example `findOwnEntry({ doc, verifiedBy })`
   */
  entry: OwnEntry;
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

/** The frontmatter's text, which every parsed range points into. */
type TextParams = {
  /**
   * The frontmatter, without its fences.
   *
   * @example `"status: draft\nverified:"`
   */
  text: string;
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
 * Check that the edited frontmatter means exactly what the edits intend: the
 * original, with a draft made stable and the signer's entry added or renewed.
 *
 * - The intended meaning is built on a copy of the original with the `yaml`
 *   package's own API, independently of the text edits, so a layout the edits
 *   get wrong is refused even when the result is still valid YAML.
 *
 * - Values are changed in place, so an alias of a changed value changes with
 *   it, as it does in the edited text.
 *
 * @returns why the meanings differ, or `undefined` when they match.
 */
export function checkMeaning(params: CheckMeaningParams): string | undefined {
  const { at, doc, editedDoc, verifiedBy } = params;
  const intended = doc.clone();
  const status = intended.get(FRONTMATTER_KEYS.status, true);

  if (isScalar(status) && status.value === RECORD_STATUSES.draft) {
    status.value = RECORD_STATUSES.stable;
  }

  addIntendedEntry({ at, doc: intended, verifiedBy });

  // Resolving aliases throws past the parser's limit, which guards against
  // alias bombs, so such a record is refused rather than ending the run.
  try {
    return isDeepStrictEqual(editedDoc.toJS(), intended.toJS())
      ? undefined
      : "the edit would change more than the status and the sign-off";
  } catch {
    return "the frontmatter has too many aliases to check the edit";
  }
}

/**
 * Check that a record's frontmatter is valid YAML, so it can be read and
 * edited safely.
 *
 * @returns why it isn't, or `undefined` when it is or there's no frontmatter.
 */
export function findFrontmatterProblem(text: string): string | undefined {
  const block = splitFrontmatter(text);

  return block === undefined
    ? undefined
    : describeYamlErrors(parseFrontmatter(block.text));
}

/**
 * Judge whether a record still needs a human sign-off.
 *
 * - `changed` means it was generated after `verifiedBy` last signed it off, or
 *   that the sign-off's timestamp can't be read.
 *
 * - `verified` means it was signed off and not touched since.
 */
export function getRecordState(summary: RecordSummary): RecordState {
  if (summary.verifiedAt === undefined) {
    return "unverified";
  }

  if (summary.generatedAt === undefined) {
    return "verified";
  }

  const generatedTime = Date.parse(summary.generatedAt);
  const verifiedTime = Date.parse(summary.verifiedAt);

  // Written so an unreadable timestamp (`NaN`) reads as "changed".
  return generatedTime <= verifiedTime ? "verified" : "changed";
}

/**
 * Read the fields the verify flow shows and decides on.
 *
 * @returns the summary, or `undefined` when the text has no frontmatter block.
 */
export function readRecordSummary(
  params: ReadRecordSummaryParams
): RecordSummary | undefined {
  const { text, verifiedBy } = params;
  const block = splitFrontmatter(text);

  if (block === undefined) {
    return undefined;
  }

  const doc = parseFrontmatter(block.text);
  const ownEntry = findOwnEntry({ doc, verifiedBy });

  return {
    generatedAt: readTimestamp(
      doc.getIn([FRONTMATTER_KEYS.generated, ENTRY_KEYS.at], true)
    ),
    status: readStatus(doc),
    title: readString(doc.get(FRONTMATTER_KEYS.title, true)),
    type: readString(doc.get(FRONTMATTER_KEYS.type, true)),
    verifiedAt: readTimestamp(ownEntry?.get(ENTRY_KEYS.at, true)),
  };
}

/**
 * Mark a record verified: `draft` becomes `stable`, and `verifiedBy`'s entry
 * gets `at` as its timestamp.
 *
 * - An existing entry for `verifiedBy` has its `at` updated, in any form YAML
 *   allows, rather than gaining a second entry; one without an `at` gains one.
 *
 * - Frontmatter that isn't valid YAML, or isn't a block mapping, is refused,
 *   since where its fields end can't be known.
 *
 * - A new entry lands after the `generated` field, or after `status` when there
 *   is no `generated`, or at the end; `generated` may be inline or a nested
 *   block.
 *
 * - A `status` other than `draft` is left alone, and an absent one counts as
 *   `stable`, as OKF defines it, so only the `verified` entry is added.
 *
 * - Every edit is planned against one parse and applied from the end of the
 *   text toward the start, so no edit moves another's position.
 */
export function verifyRecord(params: VerifyRecordParams): RecordVerification {
  const { at, text: recordText, verifiedBy } = params;
  const block = splitFrontmatter(recordText);

  if (block === undefined) {
    return { isOk: false, reason: "no frontmatter block" };
  }

  const { text } = block;
  const doc = parseFrontmatter(text);
  const inputProblem = describeYamlErrors(doc);

  if (inputProblem !== undefined) {
    return { isOk: false, reason: inputProblem };
  }

  const status = doc.get(FRONTMATTER_KEYS.status, true);

  // An alias can't be promoted alone, and its anchor may name other fields.
  if (isAlias(status)) {
    return { isOk: false, reason: "`status` is an alias" };
  }

  const verifiedEdit = planVerifiedEdit({ at, doc, text, verifiedBy });

  if (!verifiedEdit.isOk) {
    return { isOk: false, reason: verifiedEdit.reason };
  }

  const edits = [verifiedEdit.edit];

  if (
    isScalar(status) &&
    isPlaced(status) &&
    status.value === RECORD_STATUSES.draft
  ) {
    edits.push(
      writeScalar({ node: status, text, value: RECORD_STATUSES.stable })
    );
  }

  const edited = applyEdits({ edits, text });

  const editedDoc = parseFrontmatter(edited);

  // A last check that no edit, whatever the layout, left the YAML broken.
  if (describeYamlErrors(editedDoc) !== undefined) {
    return {
      isOk: false,
      reason: "the edit would leave the frontmatter invalid YAML",
    };
  }

  const meaningProblem = checkMeaning({ at, doc, editedDoc, verifiedBy });

  if (meaningProblem !== undefined) {
    return { isOk: false, reason: meaningProblem };
  }

  return {
    isOk: true,
    text: [FENCE, ...edited.split("\n"), ...block.rest].join(block.lineBreak),
  };
}

/**
 * Add or renew the signer's entry in a parsed copy of the frontmatter, as the
 * meaning check expects to find it.
 */
function addIntendedEntry(params: PlanEntryParams): void {
  const { at, doc, verifiedBy } = params;
  const ownEntry = findOwnEntry({ doc, verifiedBy });

  if (ownEntry !== undefined) {
    const atNode = ownEntry.get(ENTRY_KEYS.at, true);

    if (isScalar(atNode)) {
      atNode.value = at;
    } else {
      ownEntry.set(ENTRY_KEYS.at, at);
    }

    return;
  }

  const entry = createEntry({ at, verifiedBy });
  const verified = doc.get(FRONTMATTER_KEYS.verified, true);

  if (isSeq(verified)) {
    verified.add(entry);
  } else if (verified === undefined) {
    doc.set(FRONTMATTER_KEYS.verified, entry);
  } else if (isScalar(verified) && isNullScalar(verified)) {
    // The edit keeps the null's anchor, so an alias of it reads the entry too.
    if (verified.anchor !== undefined) {
      entry.anchor = verified.anchor;
    }

    doc.set(FRONTMATTER_KEYS.verified, entry);
  } else {
    const list = new YAMLSeq();

    list.items = [verified, entry];
    doc.set(FRONTMATTER_KEYS.verified, list);
  }
}

/**
 * Add an `at` to the signer's entry, which has none.
 *
 * - In a flow mapping it goes right after the last key or value, so the
 *   spacing, any trailing comma, and any comment stay as written.
 *
 * - In a block mapping it goes on a line of its own after the entry's last,
 *   indented like the entry's first key.
 */
function addTimestamp(params: RenewOwnEntryParams): TextEdit {
  const { at, entry, text } = params;
  const field = `${ENTRY_KEYS.at}: ${at}`;

  if (entry.flow === true) {
    const insertAt = Math.max(
      ...entry.items.flatMap(({ key, value }) => [
        readNodeEnd(key),
        readNodeEnd(value),
      ])
    );

    return { end: insertAt, start: insertAt, text: `, ${field}` };
  }

  const insertAt = findLineEnd({ index: entry.range[1], text });
  const indent = readIndent({ index: entry.range[0], text });

  return { end: insertAt, start: insertAt, text: `\n${indent}${field}` };
}

/**
 * Add a `verified` field holding the signer's entry, on a line of its own.
 *
 * - It follows `generated`, or `status` when there is no `generated`, so the
 *   provenance fields stay together; with neither, it follows the mapping's
 *   last line, before any blank lines that end the frontmatter.
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
        ? map.range[1]
        : Math.max(anchor.key.range[1], readNodeEnd(anchor.value)),
    text,
  });

  return { end: insertAt, start: insertAt, text: `\n${indent}${field}` };
}

/**
 * Add the signer's entry to the end of the `verified` list.
 *
 * - A flow sequence gains it after its last item, wherever that sits, so a
 *   sequence spread over lines keeps its layout; an empty one, after `[`.
 *
 * - A block sequence gains a `- ` item after its last line, indented like its
 *   first item, so the list stays one list.
 */
function appendToSequence(params: AppendToSequenceParams): TextEdit {
  const { entry, sequence, text } = params;

  if (sequence.flow === true) {
    if (sequence.items.length === 0) {
      const insertAt = sequence.range[0] + 1;

      return { end: insertAt, start: insertAt, text: entry };
    }

    const insertAt = Math.max(...sequence.items.map(readNodeEnd));

    return { end: insertAt, start: insertAt, text: `, ${entry}` };
  }

  const insertAt = findLineEnd({ index: sequence.range[1], text });
  const indent = readIndent({ index: sequence.range[0], text });

  return { end: insertAt, start: insertAt, text: `\n${indent}- ${entry}` };
}

/**
 * Apply edits planned against the same text.
 *
 * - They're applied from the end toward the start, so each one's positions
 *   still point at the characters it was planned against.
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
 * Turn another person's `verified` value into a list that also holds the
 * signer's entry.
 *
 * - A value on one line becomes the first item of a block list, and any
 *   comment after it stays on the `verified:` line.
 *
 * - A value spread over lines, such as a flow mapping, is wrapped in a flow
 *   sequence instead, since moving it into a block list would mean
 *   re-indenting its lines.
 */
function convertToList(params: ConvertToListParams): TextEdit {
  const { entry, keyStart, node, text } = params;
  const [start, end] = node.range;
  const value = text.slice(start, end);

  if (value.includes("\n")) {
    return { end, start, text: `[${value}, ${entry}]` };
  }

  const keyEnd = readContentEnd({ index: start, text });
  const lineEnd = findLineEnd({ index: end, text });
  const comment = text.slice(end, lineEnd);
  const indent = `${readIndent({ index: keyStart, text })}${LIST_INDENT}`;

  return {
    end: lineEnd,
    start: keyEnd,
    text: `${comment}\n${indent}- ${value}\n${indent}- ${entry}`,
  };
}

/** Build a new `verified` entry, `by` first. */
function createEntry(params: FormatEntryParams): YAMLMap {
  const { at, verifiedBy } = params;
  const entry = new YAMLMap();

  // Set one at a time, since `by` before `at` is the order records read in.
  entry.set(ENTRY_KEYS.by, verifiedBy);
  entry.set(ENTRY_KEYS.at, at);
  entry.flow = true;

  return entry;
}

/** Describe a parsed frontmatter's YAML errors, if it has any. */
function describeYamlErrors(doc: Frontmatter): string | undefined {
  const messages = doc.errors.map(({ message }) => message);

  return messages.length === 0
    ? undefined
    : `frontmatter isn't valid YAML: ${messages.join("\n")}`;
}

/**
 * Find where the line a node ends on ends, past any trailing comment.
 *
 * - A block node's range can end at the next line's start, after the line
 *   break and any blank lines it owns, such as a `|+` scalar's; the break
 *   just before that position is the line end, so those lines stay with it.
 */
function findLineEnd(params: PositionParams): number {
  const { index, text } = params;

  if (text[index - 1] === "\n") {
    return index - 1;
  }

  const lineEnd = text.indexOf("\n", index);

  return lineEnd === -1 ? text.length : lineEnd;
}

/**
 * Find `verifiedBy`'s `verified` entry: the field itself, or an item of a
 * list, whose own `by` is `verifiedBy`.
 *
 * - Only the entry's own `by` counts, not one nested under a child key, and the
 *   actor is compared whole, so `human:jjloneman2` is no one's alias.
 */
function findOwnEntry(params: FindOwnEntryParams): OwnEntry | undefined {
  const { doc, verifiedBy } = params;
  const verified = doc.get(FRONTMATTER_KEYS.verified, true);
  const entries: unknown[] = isSeq(verified) ? verified.items : [verified];

  return entries.find(
    (entry): entry is OwnEntry =>
      isMap(entry) &&
      isPlaced(entry) &&
      readString(entry.get(ENTRY_KEYS.by, true)) === verifiedBy
  );
}

/** Find a mapping's pair for a key, however the key is quoted. */
function findPair(params: FindPairParams): KeyedPair | undefined {
  const { key, map } = params;

  return map.items.find(
    (pair): pair is KeyedPair =>
      isScalar(pair.key) && isPlaced(pair.key) && pair.key.value === key
  );
}

/**
 * Write the signer's new entry as a one-line flow mapping.
 *
 * - The `yaml` package writes it, so a value holding YAML syntax, such as
 *   `, ` or ` #`, is quoted rather than read back as other keys or a comment.
 */
function formatEntry(params: FormatEntryParams): string {
  return stringify(createEntry(params), { lineWidth: 0 }).trimEnd();
}

/** Whether a scalar is YAML's null: empty, or a null spelling, unquoted. */
function isNullScalar(node: Scalar): boolean {
  const value = readString(node);

  return (
    node.type === "PLAIN" &&
    value !== undefined &&
    (value === "" || NULL_SPELLINGS.has(value))
  );
}

/** Whether a parsed node knows where it sits in the text. */
function isPlaced<T extends Node>(node: T): node is Placed<T> {
  return Array.isArray(node.range);
}

/** Whether a value is one of the statuses OKF defines. */
function isRecordStatus(value: string): value is RecordStatus {
  return RECORD_STATUS_VALUES.has(value);
}

/** Parse frontmatter text with every value read as text. */
function parseFrontmatter(text: string): Frontmatter {
  return parseDocument(text, { schema: "failsafe" });
}

/**
 * Plan the edit that adds or renews `verifiedBy`'s `verified` entry.
 *
 * @returns the edit, or why the `verified` field can't be edited safely.
 */
function planVerifiedEdit(params: PlanVerifiedEditParams): TextEditResult {
  const { at, doc, text, verifiedBy } = params;
  const ownEntry = findOwnEntry({ doc, verifiedBy });

  if (ownEntry !== undefined) {
    return renewOwnEntry({ at, entry: ownEntry, text });
  }

  const entry = formatEntry({ at, verifiedBy });
  const { contents } = doc;

  // Frontmatter of only comments, or nothing, has no mapping to add to.
  if (contents === null) {
    const separator = text === "" ? "" : "\n";
    const field = `${separator}${FRONTMATTER_KEYS.verified}: ${entry}`;

    return {
      edit: { end: text.length, start: text.length, text: field },
      isOk: true,
    };
  }

  if (!isMap(contents) || contents.flow === true || !isPlaced(contents)) {
    return { isOk: false, reason: "the frontmatter isn't a block mapping" };
  }

  const pair = findPair({ key: FRONTMATTER_KEYS.verified, map: contents });

  if (pair === undefined) {
    return {
      edit: addVerifiedField({ entry, map: contents, text }),
      isOk: true,
    };
  }

  const { key, value } = pair;

  if (!isNode(value) || !isPlaced(value)) {
    return { isOk: false, reason: "`verified` has no value to add to" };
  }

  if (isScalar(value) && isNullScalar(value)) {
    return {
      edit: writeScalar({ node: value, text, value: entry }),
      isOk: true,
    };
  }

  if (isSeq(value)) {
    return {
      edit: appendToSequence({ entry, sequence: value, text }),
      isOk: true,
    };
  }

  if (isMap(value) && value.flow !== true) {
    return {
      isOk: false,
      reason: "`verified` is a nested mapping, not a list",
    };
  }

  // Its anchor or tag would stay on the `verified:` line and name the list.
  if (value.anchor !== undefined || value.tag !== undefined) {
    return { isOk: false, reason: "`verified` has an anchor or a tag" };
  }

  return {
    edit: convertToList({
      entry,
      keyStart: key.range[0],
      node: value,
      text,
    }),
    isOk: true,
  };
}

/** Read the column a position sits at, counted from its line's start. */
function readColumn(params: PositionParams): number {
  const { index, text } = params;

  return index - (text.lastIndexOf("\n", index - 1) + 1);
}

/** Read where the text before a position ends, ignoring whitespace. */
function readContentEnd(params: PositionParams): number {
  const { index, text } = params;

  return text.slice(0, index).trimEnd().length;
}

/** Read the spaces that indent a position, as text to write before a line. */
function readIndent(params: PositionParams): string {
  return " ".repeat(readColumn(params));
}

/** Read where a node's text ends, or `0` for a missing node. */
function readNodeEnd(node: unknown): number {
  return isNode(node) && isPlaced(node) ? node.range[1] : 0;
}

/** Read `status`, when it is one of the statuses OKF defines. */
function readStatus(doc: Frontmatter): RecordStatus | undefined {
  const status = readString(doc.get(FRONTMATTER_KEYS.status, true));

  return status !== undefined && isRecordStatus(status) ? status : undefined;
}

/** Read a node's text, when it is a single value rather than a collection. */
function readString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === "string"
    ? node.value
    : undefined;
}

/** Read an `at` as a timestamp, or `undefined` when it holds none. */
function readTimestamp(node: unknown): Timestamp | undefined {
  const value = readString(node);

  return value === undefined || value === "" || NULL_SPELLINGS.has(value)
    ? undefined
    : value;
}

/**
 * Plan writing a new timestamp into the signer's entry, in place.
 *
 * @returns the edit, or why the entry can't be renewed.
 */
function renewOwnEntry(params: RenewOwnEntryParams): TextEditResult {
  const { at, entry, text } = params;
  const atNode = entry.get(ENTRY_KEYS.at, true);

  if (atNode === undefined) {
    return { edit: addTimestamp(params), isOk: true };
  }

  if (!isScalar(atNode) || !isPlaced(atNode)) {
    return { isOk: false, reason: "the signer's `at` isn't a single value" };
  }

  return { edit: writeScalar({ node: atNode, text, value: at }), isOk: true };
}

/**
 * Split a record around its frontmatter, remembering its line breaks.
 *
 * @returns the parts, or `undefined` when there is no closed `---` block.
 */
function splitFrontmatter(text: string): FrontmatterBlock | undefined {
  const lineBreak = text.includes("\r\n") ? "\r\n" : "\n";
  const [first, ...remaining] = text.split(lineBreak);

  if (first !== FENCE) {
    return undefined;
  }

  const closingIndex = remaining.indexOf(FENCE);

  if (closingIndex === -1) {
    return undefined;
  }

  return {
    lineBreak,
    rest: remaining.slice(closingIndex),
    text: remaining.slice(0, closingIndex).join("\n"),
  };
}

/**
 * Plan overwriting a scalar's value, in place.
 *
 * - The old value's quotes are kept, as is any whitespace its range ends with,
 *   such as a block scalar's closing line break; a block scalar's range starts
 *   at its `|` or `>` header, so it becomes a plain value.
 *
 * - An empty value has no characters to replace, so it's written as
 *   `key: value`, a space apart from any comment or closing brace.
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
