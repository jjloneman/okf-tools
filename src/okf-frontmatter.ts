/*
 * Pure helpers that read and edit the frontmatter of an OKF record.
 *
 * - Fields are read with a YAML parser, but edits replace only the characters
 *   they change, never a YAML round-trip, so nothing else in the file is
 *   reformatted.
 *
 * - The parser uses YAML's failsafe schema, so every value reads as the text
 *   written, such as a title of `0o17`, and nulls are recognized by spelling.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import type { Document, Range, YAMLMap } from "yaml";

import { isMap, isNode, isScalar, isSeq, parseDocument } from "yaml";

import { lineAt } from "./lines.ts";

/** The lifecycle statuses OKF defines for a record. */
export const RECORD_STATUSES = {
  deprecated: "deprecated",
  draft: "draft",
  stable: "stable",
} as const;

/** Where a YAML comment starts: whitespace, then `#`. */
const COMMENT = /\s+#/;

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

/** A line that continues the key above it: indented text. */
const INDENTED_LINE = /^\s+\S/;

/** A line that starts a list item. */
const LIST_ITEM_LINE = /^\s*-\s/;

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

/** A line that continues `verified`: a list item, or indented text. */
const VERIFIED_CONTINUATION = new RegExp(
  `${LIST_ITEM_LINE.source}|${INDENTED_LINE.source}`
);

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

/** What `appendToFlowSequence` needs: the sequence, and the entry to add. */
type AppendToFlowSequenceParams = {
  /**
   * The entry to add.
   *
   * @example `"{ by: human:jjloneman, at: 2026-10-02T13:30:00Z }"`
   */
  entry: string;

  /**
   * The existing flow sequence.
   *
   * @example `"[{ by: human:someone, at: 2026-09-01T00:00:00Z }]"`
   */
  sequence: string;
};

/** What `findKeyRange` needs: where to look, and which lines continue the key. */
type FindKeyRangeParams = {
  /**
   * Decides which following lines belong to the key.
   *
   * @example `/^\s+\S/`
   */
  isContinuation: RegExp;
} & KeyParams &
  LinesParams;

/** What `findOwnEntry` needs: the parsed frontmatter, and whose entry. */
type FindOwnEntryParams = {
  /**
   * The frontmatter, parsed.
   *
   * @example `parseFrontmatter(["verified: { by: human:jjloneman }"])`
   */
  doc: Frontmatter;
} & Pick<VerifyRecordParams, "verifiedBy">;

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
   * Frontmatter lines, without the `---` fences.
   *
   * @example ["status: draft"]
   */
  lines: string[];

  /**
   * Everything after the opening fence, including the closing one.
   *
   * @example ["---", "", "# Title"]
   */
  rest: string[];
};

/** A frontmatter key this module reads or writes. */
type FrontmatterKey = (typeof FRONTMATTER_KEYS)[keyof typeof FRONTMATTER_KEYS];

/** A top-level frontmatter key, named by itself. */
type KeyParams = {
  /**
   * The key, without its colon.
   *
   * @example "status"
   */
  key: FrontmatterKey;
};

/** A run of consecutive lines, both ends inclusive. */
type LineRange = {
  /**
   * Index of the run's last line.
   *
   * @example 4
   */
  endIndex: number;

  /**
   * Index of the run's first line.
   *
   * @example 3
   */
  startIndex: number;
};

/** The frontmatter lines a helper searches or edits. */
type LinesParams = Pick<FrontmatterBlock, "lines">;

/** The signer's `verified` entry: a mapping, and where it sits in the text. */
type OwnEntry = {
  /**
   * Where the mapping starts, where its content ends, and where it ends with
   * any trailing comment.
   *
   * @example [14, 28, 28]
   */
  range: Range;
} & YAMLMap;

/** What `readKeyValue` needs: the key, and the line it starts. */
type ReadKeyValueParams = {
  /**
   * A line that starts with `key:`.
   *
   * @example "status: draft"
   */
  line: string;
} & KeyParams;

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

  /**
   * The frontmatter's text, which the entry's ranges point into.
   *
   * @example `"verified: { by: human:jjloneman, at: 2026-09-28T09:00:00Z }"`
   */
  text: string;
};

/** What `upsertVerified` needs: the lines to edit, who signs, and when. */
type UpsertVerifiedParams = LinesParams &
  Pick<VerifyRecordParams, "at" | "verifiedBy">;

/** A value split from its trailing comment. */
type ValueWithComment = {
  /**
   * The comment, with the whitespace before it, or `""` when there is none.
   *
   * @example " # not settled"
   */
  comment: string;

  /**
   * The value without the comment.
   *
   * @example "draft"
   */
  value: string;
};

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
    : describeYamlErrors(parseFrontmatter(block.lines));
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

  const doc = parseFrontmatter(block.lines);
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
 * - Frontmatter that isn't valid YAML is refused, since where its fields end
 *   can't be known.
 *
 * - A new entry lands after the `generated` field, or after `status` when there
 *   is no `generated`; `generated` may be inline or a nested block.
 *
 * - A `status` other than `draft` is left alone, and an absent one counts as
 *   `stable`, as OKF defines it, so only the `verified` entry is added.
 */
export function verifyRecord(params: VerifyRecordParams): RecordVerification {
  const { at, text, verifiedBy } = params;
  const block = splitFrontmatter(text);

  if (block === undefined) {
    return { isOk: false, reason: "no frontmatter block" };
  }

  const lines = [...block.lines];
  const doc = parseFrontmatter(lines);
  const inputProblem = describeYamlErrors(doc);

  if (inputProblem !== undefined) {
    return { isOk: false, reason: inputProblem };
  }

  if (readStatus(doc) === RECORD_STATUSES.draft) {
    const statusIndex = findKeyIndex({ key: FRONTMATTER_KEYS.status, lines });
    const { comment } = splitTrailingComment(
      lineAt({ index: statusIndex, lines })
    );

    lines[statusIndex] =
      `${FRONTMATTER_KEYS.status}: ${RECORD_STATUSES.stable}${comment}`;
  }

  const layoutProblem = upsertVerified({ at, lines, verifiedBy });

  if (layoutProblem !== undefined) {
    return { isOk: false, reason: layoutProblem };
  }

  // A last check that no edit, whatever the layout, left the YAML broken.
  if (describeYamlErrors(parseFrontmatter(lines)) !== undefined) {
    return {
      isOk: false,
      reason: "the edit would leave the frontmatter invalid YAML",
    };
  }

  return {
    isOk: true,
    text: [FENCE, ...lines, ...block.rest].join(block.lineBreak),
  };
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
function addTimestamp(params: RenewOwnEntryParams): string {
  const { at, entry, text } = params;
  const [start, contentEnd] = entry.range;
  const field = `${ENTRY_KEYS.at}: ${at}`;

  // After the last key or value, so a trailing comma or comment stays after it.
  if (entry.flow === true) {
    const insertAt = Math.max(
      ...entry.items.flatMap(({ key, value }) => [
        readNodeEnd(key),
        readNodeEnd(value),
      ])
    );

    return `${text.slice(0, insertAt)}, ${field}${text.slice(insertAt)}`;
  }

  // A block mapping's content can end at the next line's start, past its own.
  const lastCharEnd = text.slice(0, contentEnd).trimEnd().length;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", lastCharEnd);
  const insertAt = lineEnd === -1 ? text.length : lineEnd;
  const indent = " ".repeat(start - lineStart);

  return `${text.slice(0, insertAt)}\n${indent}${field}${text.slice(insertAt)}`;
}

/** Add an entry to the end of a flow sequence such as `[{ … }]`. */
function appendToFlowSequence(params: AppendToFlowSequenceParams): string {
  const { entry, sequence } = params;
  const items = sequence.replace(/^\[\s*/, "").replace(/\s*\]$/, "");

  return items === "" ? `[${entry}]` : `[${items}, ${entry}]`;
}

/** Describe a parsed frontmatter's YAML errors, if it has any. */
function describeYamlErrors(doc: Frontmatter): string | undefined {
  const messages = doc.errors.map(({ message }) => message);

  return messages.length === 0
    ? undefined
    : `frontmatter isn't valid YAML: ${messages.join("\n")}`;
}

/**
 * Find the top-level line that starts with `key:`.
 *
 * @returns its index, or `-1` when there is none.
 */
function findKeyIndex(params: KeyParams & LinesParams): number {
  const { key, lines } = params;

  return lines.findIndex((line) => line.startsWith(`${key}:`));
}

/** Locate a key and the lines that continue it, if the key is present. */
function findKeyRange(params: FindKeyRangeParams): LineRange | undefined {
  const { isContinuation, key, lines } = params;
  const startIndex = findKeyIndex({ key, lines });

  if (startIndex === -1) {
    return undefined;
  }

  let endIndex = startIndex;

  while (isContinuation.test(lineAt({ index: endIndex + 1, lines }))) {
    endIndex += 1;
  }

  return { endIndex, startIndex };
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
      Array.isArray(entry.range) &&
      readString(entry.get(ENTRY_KEYS.by, true)) === verifiedBy
  );
}

/** Locate the `verified` key and every line that continues it. */
function findVerifiedRange(lines: string[]): LineRange | undefined {
  return findKeyRange({
    isContinuation: VERIFIED_CONTINUATION,
    key: FRONTMATTER_KEYS.verified,
    lines,
  });
}

/** Whether a value is one of the statuses OKF defines. */
function isRecordStatus(value: string): value is RecordStatus {
  return RECORD_STATUS_VALUES.has(value);
}

/** Parse frontmatter lines with every value read as text. */
function parseFrontmatter(lines: string[]): Frontmatter {
  return parseDocument(lines.join("\n"), { schema: "failsafe" });
}

/** Read the raw text after `key:` on a line, trimmed. */
function readKeyValue(params: ReadKeyValueParams): string {
  const { key, line } = params;

  return line.slice(`${key}:`.length).trim();
}

/** Read where a node's text ends, or `0` for a missing node. */
function readNodeEnd(node: unknown): number {
  return isNode(node) && Array.isArray(node.range) ? node.range[1] : 0;
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
 * Write a new timestamp into the signer's entry, in place.
 *
 * - The old value's quotes are kept, and an empty value is written as
 *   `at: <timestamp>`, a space apart from any comment or closing brace.
 *
 * @returns the new text, or why the entry can't be renewed.
 */
function renewOwnEntry(params: RenewOwnEntryParams): RecordVerification {
  const { at, entry, text } = params;
  const atNode = entry.get(ENTRY_KEYS.at, true);

  if (atNode === undefined) {
    return { isOk: true, text: addTimestamp(params) };
  }

  if (!isScalar(atNode) || !Array.isArray(atNode.range)) {
    return { isOk: false, reason: "the signer's `at` isn't a single value" };
  }

  const [start, end] = atNode.range;
  const tail = text.slice(end);

  // An empty value has no characters to replace, so the spacing is rebuilt.
  if (start === end) {
    const head = text.slice(0, start).trimEnd();
    const gap = /^[#}]/.test(tail) ? " " : "";

    return { isOk: true, text: `${head} ${at}${gap}${tail}` };
  }

  const quote = QUOTE_MARKS.get(atNode.type) ?? "";

  return {
    isOk: true,
    text: `${text.slice(0, start)}${quote}${at}${quote}${tail}`,
  };
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
    lines: remaining.slice(0, closingIndex),
    rest: remaining.slice(closingIndex),
  };
}

/** Split a value from a trailing YAML comment. */
function splitTrailingComment(text: string): ValueWithComment {
  const commentIndex = text.search(COMMENT);

  return commentIndex === -1
    ? { comment: "", value: text }
    : { comment: text.slice(commentIndex), value: text.slice(0, commentIndex) };
}

/**
 * Add or renew `verifiedBy`'s entry in place.
 *
 * @returns why the `verified` field can't be edited safely, or `undefined`.
 */
function upsertVerified(params: UpsertVerifiedParams): string | undefined {
  const { at, lines, verifiedBy } = params;
  const entry = `{ by: ${verifiedBy}, at: ${at} }`;
  const range = findVerifiedRange(lines);

  if (range === undefined) {
    const anchor =
      findKeyRange({
        isContinuation: INDENTED_LINE,
        key: FRONTMATTER_KEYS.generated,
        lines,
      }) ??
      findKeyRange({
        isContinuation: INDENTED_LINE,
        key: FRONTMATTER_KEYS.status,
        lines,
      });

    lines.splice(
      anchor === undefined ? lines.length : anchor.endIndex + 1,
      0,
      `${FRONTMATTER_KEYS.verified}: ${entry}`
    );

    return undefined;
  }

  const text = lines.join("\n");
  const ownEntry = findOwnEntry({ doc: parseFrontmatter(lines), verifiedBy });

  if (ownEntry !== undefined) {
    const renewed = renewOwnEntry({ at, entry: ownEntry, text });

    if (!renewed.isOk) {
      return renewed.reason;
    }

    lines.splice(0, lines.length, ...renewed.text.split("\n"));

    return undefined;
  }

  const { comment, value: inlineValue } = splitTrailingComment(
    readKeyValue({
      key: FRONTMATTER_KEYS.verified,
      line: lineAt({ index: range.startIndex, lines }),
    })
  );

  const continuationLines = lines.slice(
    range.startIndex + 1,
    range.endIndex + 1
  );

  // New items match the existing ones' indent, so the list stays one list.
  const itemIndent =
    continuationLines
      .map((line) => /^(?<indent>\s*)-\s/.exec(line)?.groups?.indent)
      .find((indent) => indent !== undefined) ?? "  ";

  if (NULL_SPELLINGS.has(inlineValue)) {
    lines[range.startIndex] =
      `${FRONTMATTER_KEYS.verified}: ${entry}${comment}`;

    return undefined;
  }

  if (inlineValue.startsWith("[") && !inlineValue.endsWith("]")) {
    return "`verified` is a flow sequence spread over several lines";
  }

  if (
    inlineValue === "" &&
    continuationLines.length > 0 &&
    !continuationLines.some((line) => LIST_ITEM_LINE.test(line))
  ) {
    return "`verified` is a nested mapping, not a list";
  }

  if (inlineValue === "") {
    lines.splice(range.endIndex + 1, 0, `${itemIndent}- ${entry}`);
  } else if (inlineValue.startsWith("[")) {
    lines[range.startIndex] =
      `${FRONTMATTER_KEYS.verified}: ${appendToFlowSequence({ entry, sequence: inlineValue })}${comment}`;
  } else {
    // Someone else signed off in the inline form; keep theirs as a list item.
    lines.splice(
      range.startIndex,
      1,
      `${FRONTMATTER_KEYS.verified}:${comment}`,
      `  - ${inlineValue}`,
      `  - ${entry}`
    );
  }

  return undefined;
}
