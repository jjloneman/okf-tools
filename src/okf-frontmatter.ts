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

import { DateTime } from "luxon";
import { isDeepStrictEqual } from "node:util";
import {
  isAlias,
  isCollection,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
  visit,
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

/** The byte order mark some Windows editors write before the first line. */
const BYTE_ORDER_MARK = "\uFEFF";

/** A Windows line break, which records may use for some lines or all. */
const CRLF = "\r\n";

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

/** What a refusal of an unsupported layout tells the person to do instead. */
const HAND_EDIT_HINT = "edit the record by hand";

/** A Unix line break, which also ends each line of a CRLF record. */
const LF = "\n";

/** How far a list written under `verified` is indented past its key. */
const LIST_INDENT = "  ";

/**
 * What a null reads as in the meaning check, so it differs from an empty
 * string, which the failsafe schema would otherwise make it.
 */
const NULL_MEANING = Symbol("null");

/** Why a record whose aliases resolve past the parser's limit is refused. */
const TOO_MANY_ALIASES =
  "the frontmatter has too many aliases to check the edit";

/**
 * The timestamp `findEditProblem` plans with; no refusal depends on it, since
 * a timestamp is always written the same way.
 */
const LISTING_AT = "1970-01-01T00:00:00Z";

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

/** What `findEditProblem` needs: the record, and who would sign it. */
export type FindEditProblemParams = Pick<
  VerifyRecordParams,
  "text" | "verifiedBy"
>;

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

/** An ISO 8601 timestamp as a record writes it: `2026-10-02T13:30:00Z`. */
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
   * Someone else's one-line entry, the `verified` value.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<YAMLMap>;
} & EntryEditParams;

/** The frontmatter's `status` and `verified`, in a layout the edits support. */
type EditableLayout = {
  /**
   * The top-level mapping, or `undefined` for frontmatter of only comments or
   * nothing.
   *
   * @example `doc.contents`
   */
  map: Placed<YAMLMap> | undefined;

  /**
   * The `status` value, when the record has one.
   *
   * @example `doc.get("status", true)`
   */
  status: Placed<Scalar> | undefined;

  /**
   * The `verified` field's layout.
   *
   * @example `{ kind: "absent" }`
   */
  verified: VerifiedLayout;
};

/** One `verified` entry in an editable layout, with its `by` and `at`. */
type Entry = {
  /**
   * The entry's `at`, or `undefined` when it has none.
   *
   * @example `entry.get("at", true)`
   */
  at: Placed<Scalar> | undefined;

  /**
   * The entry's `by`, or `undefined` when it has none.
   *
   * @example `entry.get("by", true)`
   */
  by: Placed<Scalar> | undefined;

  /**
   * The entry's mapping, flow or block.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<YAMLMap>;
};

/** What an edit that writes the signer's new entry needs. */
type EntryEditParams = {
  /**
   * The new entry, as a flow mapping.
   *
   * @example `"{ by: human:jjloneman, at: 2026-10-02T13:30:00Z }"`
   */
  entry: string;
} & TextParams;

/** A key of a `verified` or `generated` entry. */
type EntryKey = (typeof ENTRY_KEYS)[keyof typeof ENTRY_KEYS];

/** What a layout check on one node needs: the node, its name, the text. */
type FieldNodeParams = {
  /**
   * The field as a refusal names it.
   *
   * @example "`verified`"
   */
  field: string;

  /**
   * The node to check, which may be missing.
   *
   * @example `doc.get("status", true)`
   */
  node: unknown;
} & TextParams;

/** What a check on a top-level key needs: the pair, its name, the text. */
type FieldPairParams = {
  /**
   * The pair whose key is checked.
   *
   * @example `findPair({ key: "status", map })`
   */
  pair: KeyedPair;
} & Pick<FieldNodeParams, "field"> &
  TextParams;

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
  key: EntryKey | FrontmatterKey;

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

/** Where a record's frontmatter sits in its text, and the frontmatter. */
type FrontmatterBlock = {
  /**
   * Where the frontmatter ends: the start of the closing fence's line.
   *
   * @example 24
   */
  end: number;

  /**
   * The opening fence's line break, for a line added to empty frontmatter.
   *
   * @example `"\n"`
   */
  lineBreak: string;

  /**
   * Where the frontmatter starts: just past the opening fence's line break.
   *
   * @example 4
   */
  start: number;

  /**
   * The frontmatter without its fences, line breaks as written, ending with
   * the one before the closing fence unless it's empty.
   *
   * @example `"type: Decision\nstatus: draft\n"`
   */
  text: string;
};

/** A frontmatter key this module reads or writes. */
type FrontmatterKey = (typeof FRONTMATTER_KEYS)[keyof typeof FRONTMATTER_KEYS];

/** What `isOneLine` needs: the node, and the text its range points into. */
type IsOneLineParams = {
  /**
   * The parsed node.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<Node>;
} & TextParams;

/** What `isSignersBy` needs: an entry's `by`, and the signer. */
type IsSignersByParams = {
  /**
   * The entry's `by`, resolved, or anything else, which names nobody.
   *
   * @example `entry.get("by", true)`
   */
  by: unknown;
} & Pick<VerifyRecordParams, "verifiedBy">;

/** A mapping's pair whose key is a single value, with where it sits. */
type KeyedPair = Pair<Placed<Scalar>>;

/** A checked part of the layout, or why it isn't editable. */
type LayoutPartResult<T> =
  | {
      /**
       * Whether the part is editable; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why it isn't.
       *
       * @example "`status` is an alias"
       */
      reason: string;
    }
  | {
      /**
       * Whether the part is editable; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The part, typed for the edits.
       *
       * @example `{ kind: "absent" }`
       */
      value: T;
    };

/** The editable layout, or why the frontmatter's isn't. */
type LayoutResult =
  | {
      /**
       * Whether the layout is editable; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why it isn't.
       *
       * @example "`verified` is an alias"
       */
      reason: string;
    }
  | {
      /**
       * Whether the layout is editable; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The layout, typed for the edits.
       *
       * @example `{ map, status, verified: { kind: "absent" } }`
       */
      layout: EditableLayout;
    };

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

/** What a helper that reads a position in the frontmatter needs. */
type PositionParams = {
  /**
   * The position, as an index into the text.
   *
   * @example 14
   */
  index: number;
} & TextParams;

/** What `readEditableLayout` needs: the parse, its text, and the signer. */
type ReadEditableLayoutParams = {
  /**
   * The frontmatter, parsed.
   *
   * @example `parseFrontmatter(text)`
   */
  doc: Frontmatter;
} & Pick<VerifyRecordParams, "verifiedBy"> &
  TextParams;

/** What `readEntryField` needs: the entry, which key, and what to call it. */
type ReadEntryFieldParams = {
  /**
   * The key to check.
   *
   * @example "at"
   */
  key: EntryKey;

  /**
   * The entry's mapping.
   *
   * @example `doc.get("verified", true)`
   */
  map: YAMLMap;
} & Pick<FieldNodeParams, "field"> &
  TextParams;

/** What `readEntry` needs: the entry, what to call it, the text, the signer. */
type ReadEntryParams = {
  /**
   * The entry's mapping, already checked for an anchor, alias, or tag.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<YAMLMap>;
} & Pick<FieldNodeParams, "field"> &
  Pick<VerifyRecordParams, "verifiedBy"> &
  TextParams;

/** What `readField` needs: the document, the mapping, and which key. */
type ReadFieldParams = {
  /**
   * The key to read.
   *
   * @example "at"
   */
  key: EntryKey | FrontmatterKey;

  /**
   * The mapping, or an alias of one, or anything else, which reads as nothing.
   *
   * @example `doc.contents`
   */
  map: unknown;
} & Pick<ResolveAliasParams, "doc">;

/** What `readKeyMeaning` needs: the key, and the document it's in. */
type ReadKeyMeaningParams = {
  /**
   * The key, which may be an alias or missing.
   *
   * @example `pair.key`
   */
  key: unknown;
} & Pick<ResolveAliasParams, "doc">;

/** What a top-level layout reader needs: the parse, its mapping, the signer. */
type ReadLayoutPartParams = {
  /**
   * The top-level mapping.
   *
   * @example `doc.contents`
   */
  map: YAMLMap;
} & Pick<ReadEditableLayoutParams, "doc" | "text" | "verifiedBy">;

/** What `readVerifiedList` needs: the list, what to call it, and the signer. */
type ReadVerifiedListParams = {
  /**
   * The `verified` list.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<YAMLSeq>;
} & Pick<FieldNodeParams, "field"> &
  Pick<VerifyRecordParams, "verifiedBy"> &
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

/** What `resolveAlias` needs: the document holding the anchor, the node. */
type ResolveAliasParams = {
  /**
   * The document to look the anchor up in.
   *
   * @example `parseFrontmatter("a: &x 1\nb: *x")`
   */
  doc: Document;

  /**
   * The node, which may be an alias.
   *
   * @example `doc.get("b", true)`
   */
  node: unknown;
};

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

/** The `verified` field, in one of the layouts the edits support. */
type VerifiedLayout =
  | {
      /**
       * The layout: a null value, such as `~` or nothing.
       *
       * @example "null"
       */
      kind: "null";

      /**
       * The null value.
       *
       * @example `doc.get("verified", true)`
       */
      node: Placed<Scalar>;
    }
  | {
      /**
       * The layout: no `verified` field.
       *
       * @example "absent"
       */
      kind: "absent";
    }
  | {
      /**
       * The list's entries, in order.
       *
       * @example `[{ at, by, node }]`
       */
      entries: Entry[];

      /**
       * The layout: a list, flow on one line or block.
       *
       * @example "list"
       */
      kind: "list";

      /**
       * The list.
       *
       * @example `doc.get("verified", true)`
       */
      node: Placed<YAMLSeq>;
    }
  | {
      /**
       * The single entry, someone's or the signer's.
       *
       * @example `{ at, by, node }`
       */
      entry: Entry;

      /**
       * The `verified` key, so a list made from the entry is indented past it.
       *
       * @example `pair.key`
       */
      key: Placed<Scalar>;

      /**
       * The layout: one entry.
       *
       * @example "entry"
       */
      kind: "entry";
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
 * - Exported for its own tests: no edit `verifyRecord` plans today reaches the
 *   mismatch, so it's checked directly.
 *
 * @returns why the edit is refused, or `undefined` when it means what's meant.
 */
export function checkMeaning(params: CheckMeaningParams): string | undefined {
  const { at, doc, editedDoc, verifiedBy } = params;

  // A last check that no edit, whatever the layout, left the YAML broken.
  if (describeYamlErrors(editedDoc) !== undefined) {
    return "the edit would leave the frontmatter invalid YAML";
  }

  const intended = doc.clone();
  const status = intended.get(FRONTMATTER_KEYS.status, true);

  if (isScalar(status) && status.value === RECORD_STATUSES.draft) {
    status.value = RECORD_STATUSES.stable;
  }

  addIntendedEntry({ at, doc: intended, verifiedBy });

  // Resolving aliases throws past the parser's limit, which guards against
  // alias bombs, so such a record is refused rather than ending the run.
  try {
    return isDeepStrictEqual(
      readMeaning(editedDoc.clone()),
      readMeaning(intended)
    )
      ? undefined
      : "the edit would change more than the status and the sign-off";
  } catch {
    return TOO_MANY_ALIASES;
  }
}

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
 * - `verified` means it was signed off and not touched since, or that the
 *   generation time can't be read, since no sign-off could ever follow it.
 */
export function getRecordState(summary: RecordSummary): RecordState {
  if (summary.verifiedAt === undefined) {
    return "unverified";
  }

  if (summary.generatedAt === undefined) {
    return "verified";
  }

  const generatedTime = readTime(summary.generatedAt);

  // An unreadable generation time can't be compared, and treating it as
  // "changed" would ask for a sign-off no sign-off could satisfy.
  if (!generatedTime.isValid) {
    return "verified";
  }

  const verifiedTime = readTime(summary.verifiedAt);

  // An unreadable sign-off time reads as "changed", so it's signed again.
  return verifiedTime.isValid &&
    generatedTime.toMillis() <= verifiedTime.toMillis()
    ? "verified"
    : "changed";
}

/**
 * Read the fields the verify flow shows and decides on.
 *
 * - Reads every layout YAML allows, aliases included, unlike the edits.
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
  const { contents } = doc;
  const ownEntry = findOwnEntry({ doc, verifiedBy });

  const generated = readField({
    doc,
    key: FRONTMATTER_KEYS.generated,
    map: contents,
  });

  const status = readString(
    readField({ doc, key: FRONTMATTER_KEYS.status, map: contents })
  );

  return {
    generatedAt: readTimestamp(
      readField({ doc, key: ENTRY_KEYS.at, map: generated })
    ),
    status: status !== undefined && isRecordStatus(status) ? status : undefined,
    title: readString(
      readField({ doc, key: FRONTMATTER_KEYS.title, map: contents })
    ),
    type: readString(
      readField({ doc, key: FRONTMATTER_KEYS.type, map: contents })
    ),
    verifiedAt: readTimestamp(
      readField({ doc, key: ENTRY_KEYS.at, map: ownEntry })
    ),
  };
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
  } else if (
    verified === undefined ||
    (isScalar(verified) && isNullScalar(verified))
  ) {
    doc.set(FRONTMATTER_KEYS.verified, entry);
  } else {
    const list = new YAMLSeq();

    list.items = [verified, entry];
    doc.set(FRONTMATTER_KEYS.verified, list);
  }
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

/** Build the signer's new entry as a flow mapping of `by`, then `at`. */
function createEntry(params: FormatEntryParams): YAMLMap {
  const { at, verifiedBy } = params;
  const entry = new YAMLMap();

  // Set one at a time, since `by` before `at` is the order records read in.
  entry.set(ENTRY_KEYS.by, verifiedBy);
  entry.set(ENTRY_KEYS.at, at);
  entry.flow = true;

  return entry;
}

/**
 * Say why a top-level key can't be edited around: it must be a plain key that
 * opens its line, not a quoted key or one after `?`, an anchor, or a tag.
 */
function describeKeyProblem(params: FieldPairParams): string | undefined {
  const { field, pair, text } = params;
  const { key } = pair;
  const lineStart = readLineStart({ index: key.range[0], text });
  const beforeKey = text.slice(lineStart, key.range[0]);

  return key.type === "PLAIN" && beforeKey.trim() === ""
    ? undefined
    : `${field} isn't a plain key at the start of its line`;
}

/**
 * Say why a node the edits touch can't be edited safely: it's missing, an
 * alias, or carries an anchor or a tag, any of which ties its meaning to
 * another part of the document.
 */
function describeNodeProblem(params: FieldNodeParams): string | undefined {
  const { field, node } = params;

  if (!isNode(node)) {
    return `${field} has no value`;
  }

  if (isAlias(node)) {
    return `${field} is an alias`;
  }

  return node.anchor === undefined && node.tag === undefined
    ? undefined
    : `${field} has an anchor or a tag`;
}

/** Join the parser's errors into one reason, or `undefined` for none. */
function describeYamlErrors(doc: Frontmatter): string | undefined {
  const messages = doc.errors.map(({ message }) => message);

  return messages.length === 0
    ? undefined
    : `frontmatter isn't valid YAML: ${messages.join("\n")}`;
}

/**
 * Say why a frontmatter's meaning is ambiguous before any edit: an alias
 * whose anchor isn't set before it, or a mapping with two keys that mean the
 * same, such as an alias key repeating another, or `~` beside `null`.
 */
function findAmbiguity(doc: Document): string | undefined {
  const unresolved = findUnresolvedAlias(doc);

  if (unresolved !== undefined) {
    return `the alias \`*${unresolved}\` names no anchor set before it`;
  }

  try {
    return hasEqualKeys(doc)
      ? "the frontmatter has two keys that mean the same"
      : undefined;
  } catch {
    return TOO_MANY_ALIASES;
  }
}

/**
 * Find where the line holding `index` ends, before its `\n` or `\r\n`, so
 * an insert there keeps the line's own line break after it.
 *
 * - An index just past a line break belongs to the line that break ends,
 *   since a node's range often ends there.
 *
 * - Frontmatter that isn't empty always ends with a line break, the one before
 *   the closing fence, so a line end is always found.
 */
function findLineEnd(params: PositionParams): number {
  const { index, text } = params;
  const lineFeed = text.indexOf("\n", index - 1);

  return text[lineFeed - 1] === "\r" ? lineFeed - 1 : lineFeed;
}

/**
 * Find `verifiedBy`'s entry, resolving aliases, for the reads and the meaning
 * check; the edits find it in the editable layout instead.
 */
function findOwnEntry(params: FindOwnEntryParams): undefined | YAMLMap {
  const { doc, verifiedBy } = params;

  const verified = readField({
    doc,
    key: FRONTMATTER_KEYS.verified,
    map: doc.contents,
  });

  const entries: unknown[] = isSeq(verified) ? verified.items : [verified];

  return entries
    .map((entry) => resolveAlias({ doc, node: entry }))
    .find(
      (entry): entry is YAMLMap =>
        isMap(entry) &&
        isSignersBy({
          by: readField({ doc, key: ENTRY_KEYS.by, map: entry }),
          verifiedBy,
        })
    );
}

/** Find a mapping's pair whose key is the given single value. */
function findPair(params: FindPairParams): KeyedPair | undefined {
  const { key, map } = params;

  return map.items.find(
    (pair): pair is KeyedPair =>
      isScalar(pair.key) && isPlaced(pair.key) && pair.key.value === key
  );
}

/** Find an alias whose anchor isn't set before it, which can't be read. */
function findUnresolvedAlias(doc: Document): string | undefined {
  let source: string | undefined;

  visit(doc, {
    Alias(_key, node) {
      if (node.resolve(doc) === undefined) {
        source = node.source;

        return visit.BREAK;
      }

      return undefined;
    },
  });

  return source;
}

/** Write the signer's new entry as YAML, quoting `verifiedBy` if it must be. */
function formatEntry(params: FormatEntryParams): string {
  return stringify(createEntry(params), { lineWidth: 0 }).trimEnd();
}

/** Whether any mapping in a document has two keys that mean the same. */
function hasEqualKeys(doc: Document): boolean {
  let isFound = false;

  visit(doc, {
    Map(_key, map) {
      const keys = map.items.map(({ key }) => readKeyMeaning({ doc, key }));

      isFound = keys.some((key, index) =>
        keys.slice(index + 1).some((other) => isDeepStrictEqual(key, other))
      );

      return isFound ? visit.BREAK : undefined;
    },
  });

  return isFound;
}

/**
 * Whether a scalar is YAML's null: `~`, `null`, `Null`, `NULL`, or nothing,
 * unquoted, as in YAML 1.2's core schema.
 *
 * - The one rule for both the reads and the edits; a quoted `"null"` is the
 *   string `null`.
 */
function isNullScalar(node: Scalar): boolean {
  const value = readString(node);

  return (
    node.type === "PLAIN" &&
    value !== undefined &&
    (value === "" || NULL_SPELLINGS.has(value))
  );
}

/** Whether a node's content, not its trailing comment, is on one line. */
function isOneLine(params: IsOneLineParams): boolean {
  const { node, text } = params;
  const [start, end] = node.range;

  return !text.slice(start, end).includes("\n");
}

/** Whether a parsed node carries its position in the text. */
function isPlaced<T extends Node>(node: T): node is Placed<T> {
  return Array.isArray(node.range);
}

/** Whether a value is a status OKF defines. */
function isRecordStatus(value: string): value is RecordStatus {
  return RECORD_STATUS_VALUES.has(value);
}

/**
 * Whether an entry's `by` names the signer; a null `by` names nobody, even a
 * signer whose name is spelled `null`.
 */
function isSignersBy(params: IsSignersByParams): boolean {
  const { by, verifiedBy } = params;

  return isScalar(by) && !isNullScalar(by) && readString(by) === verifiedBy;
}

/** Parse frontmatter with every value as text, positions included. */
function parseFrontmatter(text: string): Frontmatter {
  return parseDocument(text, { schema: "failsafe" });
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

/** Find how far a position sits from the start of its line. */
function readColumn(params: PositionParams): number {
  return params.index - readLineStart(params);
}

/** Find where the content before a position ends, skipping whitespace back. */
function readContentEnd(params: PositionParams): number {
  const { index, text } = params;

  return text.slice(0, index).trimEnd().length;
}

/**
 * Check that the frontmatter's `status` and `verified` are in a layout the
 * edits support, and return them typed for the edits.
 *
 * - An allowlist: each node must have an allowed shape, so a layout nobody
 *   planned for is refused rather than edited.
 *
 * - Fields other than `status` and `verified`, and keys inside an entry other
 *   than `by` and `at`, may take any form.
 */
function readEditableLayout(params: ReadEditableLayoutParams): LayoutResult {
  const { doc, text, verifiedBy } = params;
  const { contents } = doc;

  if (contents === null) {
    return {
      isOk: true,
      layout: {
        map: undefined,
        status: undefined,
        verified: { kind: "absent" },
      },
    };
  }

  if (!isMap(contents) || contents.flow === true || !isPlaced(contents)) {
    return { isOk: false, reason: "the frontmatter isn't a block mapping" };
  }

  const status = readStatusLayout({ doc, map: contents, text, verifiedBy });

  if (!status.isOk) {
    return status;
  }

  const verified = readVerifiedLayout({
    doc,
    map: contents,
    text,
    verifiedBy,
  });

  if (!verified.isOk) {
    return verified;
  }

  return {
    isOk: true,
    layout: {
      map: contents,
      status: status.value,
      verified: verified.value,
    },
  };
}

/** List the entries of an editable `verified` field, in order. */
function readEntries(verified: VerifiedLayout): Entry[] {
  switch (verified.kind) {
    case "entry": {
      return [verified.entry];
    }

    case "list": {
      return verified.entries;
    }

    default: {
      return [];
    }
  }
}

/**
 * Check that a `verified` entry is in an editable layout, and read its `by`,
 * and its `at` when it's the signer's.
 *
 * - Every entry's `by` is checked, since it decides whose entry is whose; only
 *   the signer's `at` is, since no other entry's is edited.
 */
function readEntry(params: ReadEntryParams): LayoutPartResult<Entry> {
  const { field, node, text, verifiedBy } = params;

  if (node.flow === true && !isOneLine({ node, text })) {
    return { isOk: false, reason: spansLines(field) };
  }

  const by = readEntryField({ field, key: ENTRY_KEYS.by, map: node, text });

  if (!by.isOk) {
    return by;
  }

  if (!isSignersBy({ by: by.value, verifiedBy })) {
    return { isOk: true, value: { at: undefined, by: by.value, node } };
  }

  const at = readEntryField({ field, key: ENTRY_KEYS.at, map: node, text });

  if (!at.isOk) {
    return at;
  }

  return { isOk: true, value: { at: at.value, by: by.value, node } };
}

/** Check one of an entry's `by` and `at`, which may be absent. */
function readEntryField(
  params: ReadEntryFieldParams
): LayoutPartResult<Placed<Scalar> | undefined> {
  const { field, key, map, text } = params;
  const pair = findPair({ key, map });

  if (pair === undefined) {
    return { isOk: true, value: undefined };
  }

  return readScalar({ field: `${field}'s \`${key}\``, node: pair.value, text });
}

/**
 * Read a key's value from a mapping, resolving an alias for either, so the
 * reads see what the YAML means.
 */
function readField(params: ReadFieldParams): unknown {
  const { doc, key, map } = params;
  const resolved = resolveAlias({ doc, node: map });

  return isMap(resolved)
    ? resolveAlias({ doc, node: resolved.get(key, true) })
    : undefined;
}

/** Find how far a position's line is indented, as spaces. */
function readIndent(params: PositionParams): string {
  const { index, text } = params;
  const beforeNode = text.slice(readLineStart(params), index);

  // The parser starts a mapping after its first key's anchor or tag, which
  // the new line's indent must not count.
  const properties = /(?:[!&]\S*[\t ]+)+$/u.exec(beforeNode)?.[0] ?? "";

  return " ".repeat(readColumn(params) - properties.length);
}

/**
 * Read what a key means, with its alias resolved and a null or missing key
 * read as null, so two spellings of one key compare equal.
 */
function readKeyMeaning(params: ReadKeyMeaningParams): unknown {
  const resolved = resolveAlias({ doc: params.doc, node: params.key });

  if (!isNode(resolved) || (isScalar(resolved) && isNullScalar(resolved))) {
    return NULL_MEANING;
  }

  return resolved.toJS(params.doc, { mapAsMap: true });
}

/** Read the line break that starts at a line end `findLineEnd` found. */
function readLineBreak(params: PositionParams): string {
  const { index, text } = params;

  return text.startsWith(CRLF, index) ? CRLF : LF;
}

/** Find where the line holding a position starts. */
function readLineStart(params: PositionParams): number {
  const { index, text } = params;

  return text.lastIndexOf("\n", index - 1) + 1;
}

/**
 * Read what a throwaway copy of a document means, for the meaning check:
 * nulls kept apart from empty text, and collection keys kept as keys.
 */
function readMeaning(doc: Document): unknown {
  // Marks the document in place, so pass a copy that can be thrown away.
  visit(doc, {
    Scalar(_key, node) {
      if (isNullScalar(node)) {
        node.value = NULL_MEANING;
      }
    },
  });

  return doc.toJS({ mapAsMap: true });
}

/**
 * Find where a node's content ends, or `0` for no node.
 *
 * - A block collection's own range can run on to the next field's first
 *   character, past comment lines, when its last value is empty, so its end is
 *   taken from its last value instead.
 */
function readNodeEnd(node: unknown): number {
  if (!isNode(node) || !isPlaced(node)) {
    return 0;
  }

  if (!isCollection(node) || node.flow === true) {
    return node.range[1];
  }

  return Math.max(
    node.range[0],
    ...node.items.flatMap((item: unknown) =>
      isPair(item)
        ? [readNodeEnd(item.key), readNodeEnd(item.value)]
        : [readNodeEnd(item)]
    )
  );
}

/**
 * Check that a node the edits read or write is a single value on one line,
 * without an anchor, alias, or tag, and return it typed.
 */
function readScalar(params: FieldNodeParams): LayoutPartResult<Placed<Scalar>> {
  const { field, node, text } = params;
  const problem = describeNodeProblem(params);

  if (problem !== undefined) {
    return { isOk: false, reason: problem };
  }

  if (!isScalar(node) || !isPlaced(node)) {
    return { isOk: false, reason: `${field} isn't a single value` };
  }

  return isOneLine({ node, text })
    ? { isOk: true, value: node }
    : { isOk: false, reason: spansLines(field) };
}

/**
 * Check that `status`, when it's a draft to promote, is a value the edits can
 * overwrite.
 *
 * - Any other status is left as written, so it may take any form.
 */
function readStatusLayout(
  params: ReadLayoutPartParams
): LayoutPartResult<Placed<Scalar> | undefined> {
  const { doc, map, text } = params;
  const field = `\`${FRONTMATTER_KEYS.status}\``;
  const pair = findPair({ key: FRONTMATTER_KEYS.status, map });

  if (pair === undefined) {
    return { isOk: true, value: undefined };
  }

  const { value } = pair;
  const resolved = resolveAlias({ doc, node: value });

  if (readString(resolved) !== RECORD_STATUSES.draft) {
    return { isOk: true, value: undefined };
  }

  const problem = describeKeyProblem({ field, pair, text });

  return problem === undefined
    ? readScalar({ field, node: value, text })
    : { isOk: false, reason: problem };
}

/** Read a value as text, or `undefined` when it isn't a single value. */
function readString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === "string"
    ? node.value
    : undefined;
}

/** Read a timestamp as ISO 8601, or with a space before the time, in UTC. */
function readTime(value: Timestamp): DateTime {
  const iso = DateTime.fromISO(value, { zone: "utc" });

  return iso.isValid ? iso : DateTime.fromSQL(value, { zone: "utc" });
}

/** Read a timestamp, or `undefined` when it's missing, empty, or null. */
function readTimestamp(node: unknown): Timestamp | undefined {
  if (!isScalar(node) || isNullScalar(node)) {
    return undefined;
  }

  const value = readString(node);

  return value === "" ? undefined : value;
}

/**
 * Check that `verified`, if present, is in a layout the edits support: null,
 * one entry, or a list of entries.
 */
function readVerifiedLayout(
  params: ReadLayoutPartParams
): LayoutPartResult<VerifiedLayout> {
  const { map, text, verifiedBy } = params;
  const field = `\`${FRONTMATTER_KEYS.verified}\``;
  const pair = findPair({ key: FRONTMATTER_KEYS.verified, map });

  if (pair === undefined) {
    return { isOk: true, value: { kind: "absent" } };
  }

  const { key, value } = pair;
  const problem =
    describeKeyProblem({ field, pair, text }) ??
    describeNodeProblem({ field, node: value, text });

  if (problem !== undefined) {
    return { isOk: false, reason: problem };
  }

  if (isMap(value) && isPlaced(value)) {
    const entry = readEntry({ field, node: value, text, verifiedBy });

    return entry.isOk
      ? { isOk: true, value: { entry: entry.value, key, kind: "entry" } }
      : entry;
  }

  return isSeq(value) && isPlaced(value)
    ? readVerifiedList({ field, node: value, text, verifiedBy })
    : readVerifiedScalar({ field, node: value });
}

/**
 * Check that every item of a `verified` list is an entry in an editable
 * layout, and that a flow list sits on one line.
 */
function readVerifiedList(
  params: ReadVerifiedListParams
): LayoutPartResult<VerifiedLayout> {
  const { field, node, text, verifiedBy } = params;

  if (node.flow === true && !isOneLine({ node, text })) {
    return { isOk: false, reason: spansLines(field) };
  }

  const entries: Entry[] = [];

  const itemField = `a ${field} item`;

  for (const item of node.items) {
    const problem = describeNodeProblem({ field: itemField, node: item, text });

    if (problem !== undefined) {
      return { isOk: false, reason: problem };
    }

    if (!isMap(item) || !isPlaced(item)) {
      return { isOk: false, reason: `${itemField} isn't a mapping` };
    }

    const entry = readEntry({ field: itemField, node: item, text, verifiedBy });

    if (!entry.isOk) {
      return entry;
    }

    entries.push(entry.value);
  }

  return { isOk: true, value: { entries, kind: "list", node } };
}

/**
 * Check that a single-value `verified` is null, the one scalar the edits
 * replace with an entry.
 */
function readVerifiedScalar(
  params: Pick<FieldNodeParams, "field" | "node">
): LayoutPartResult<VerifiedLayout> {
  const { field, node } = params;

  // A null is never more than a word, so it can't span lines.
  return isScalar(node) && isPlaced(node) && isNullScalar(node)
    ? { isOk: true, value: { kind: "null", node } }
    : {
        isOk: false,
        reason: `${field} holds a single value, not an entry or a list`,
      };
}

/** Plan the edit that renews the signer's `at`, or adds one it lacks. */
function renewOwnEntry(params: RenewOwnEntryParams): TextEdit {
  const { at, entry, text } = params;

  return entry.at === undefined
    ? addTimestamp(params)
    : writeScalar({ node: entry.at, text, value: at });
}

/** Follow an alias to the node its anchor names, or return the node as is. */
function resolveAlias(params: ResolveAliasParams): unknown {
  const { doc, node } = params;

  return isAlias(node) ? node.resolve(doc) : node;
}

/** Say that a field spans several lines, which the edits don't handle. */
function spansLines(field: string): string {
  return `${field} spans several lines`;
}

/**
 * Find a record's frontmatter: the text between a `---` first line and the
 * next `---` line, by position, so the rest of the record is never rewritten.
 *
 * - The text keeps its line breaks as written, LF or CRLF, mixed or not, and
 *   ends with the one before the closing fence, unless it's empty.
 */
function splitFrontmatter(text: string): FrontmatterBlock | undefined {
  const byteOrderMark = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : "";
  const lineBreak = [LF, CRLF].find((candidate) =>
    text.startsWith(`${byteOrderMark}${FENCE}${candidate}`)
  );

  if (lineBreak === undefined) {
    return undefined;
  }

  const start = byteOrderMark.length + FENCE.length + lineBreak.length;
  let lineStart = start;

  for (const line of text.slice(start).split(LF)) {
    if (line === FENCE || line === `${FENCE}\r`) {
      // A byte order mark after the fence isn't indentation, so it stays out
      // of the frontmatter the parser reads.
      const contentStart = text.startsWith(BYTE_ORDER_MARK, start)
        ? start + BYTE_ORDER_MARK.length
        : start;

      return {
        end: lineStart,
        lineBreak,
        start: contentStart,
        text: text.slice(contentStart, lineStart),
      };
    }

    lineStart += line.length + LF.length;
  }

  return undefined;
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
