/*
 * The types, constants, and helpers that reading and editing a record's
 * frontmatter share.
 *
 * - The parser uses YAML's failsafe schema, so every value reads as the text
 *   written, such as a title of `0o17`, and nulls are recognized by spelling.
 *
 * - The frontmatter is sliced out by position, so line endings and a byte
 *   order mark are kept as written.
 */
import type { Document, Node, Pair, Range, Scalar, YAMLMap } from "yaml";

import { DateTime } from "luxon";
import {
  isAlias,
  isCollection,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from "yaml";

import type {
  EntryStyle,
  RecordStatus,
  Timestamp,
  VerifyRecordParams,
} from "./types.ts";

import { ENTRY_STYLES, RECORD_STATUSES } from "./types.ts";

/** The keys of one `verified` or `generated` entry. */
export const ENTRY_KEYS = {
  at: "at",
  by: "by",
} as const;

/** The byte order mark some Windows editors write before the first line. */
const BYTE_ORDER_MARK = "\uFEFF";

/** A Windows line break, which records may use for some lines or all. */
const CRLF = "\r\n";

/** The YAML document end marker, which some tools close frontmatter with. */
const DOCUMENT_END = "...";

/** The line that opens and closes a frontmatter block. */
const FENCE = "---";

/**
 * The frontmatter keys the frontmatter modules read or write.
 *
 * - OKF v0.2 requires only `type` and lets producers add any key, so this is
 *   their working set, not the format's full list.
 */
export const FRONTMATTER_KEYS = {
  generated: "generated",
  staleAfter: "stale_after",
  status: "status",
  title: "title",
  type: "type",
  verified: "verified",
} as const;

/** A Unix line break, which also ends each line of a CRLF record. */
export const LF = "\n";

/** Any line break, lone carriage returns included, for finding fence lines. */
const LINE_BREAK = /\r\n|\n|\r/u;

/** How YAML spells null, other than leaving a value empty. */
const NULL_SPELLINGS: ReadonlySet<string> = new Set([
  "~",
  "null",
  "Null",
  "NULL",
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

/** The styles a new entry can take, as a refusal lists them. */
export const ENTRY_STYLE_NAMES: string = Object.values(ENTRY_STYLES).join(", ");

/** The styles a new entry can take, to check a value against. */
const ENTRY_STYLE_VALUES: ReadonlySet<unknown> = new Set(
  Object.values(ENTRY_STYLES)
);

/** The spaces and tabs that start or end a line, if any. */
const SURROUNDING_BLANKS = /^[\t ]+|[\t ]+$/gu;

/**
 * The shape of a timestamp `verifyRecord` writes: RFC 3339's profile of ISO
 * 8601, a date and a time to the minute or finer, in a stated zone.
 *
 * - A date alone, or a time on its own, which luxon reads as today's, can't
 *   say when on the day the sign-off was made.
 *
 * - A time with no zone is UTC here but local time to ISO 8601 and to
 *   JavaScript, so other tools would date it differently.
 *
 * - A decimal comma would end the value inside `{ by, at }`, so a fraction
 *   takes a period; hours, minutes, and offsets are range-checked here, since
 *   luxon reads `+99:99` and `24:00`.
 */
const WRITABLE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

/** The run of YAML whitespace and line breaks that ends a string, if any. */
const YAML_WHITESPACE_END = /[\t\n\r ]+$/u;

/** A key of a `verified` or `generated` entry. */
export type EntryKey = (typeof ENTRY_KEYS)[keyof typeof ENTRY_KEYS];

/** What a layout check on one node needs: the node, its name, the text. */
export type FieldNodeParams = {
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

/** What `findOwnEntry` needs: the parsed frontmatter, and whose entry. */
export type FindOwnEntryParams = {
  /**
   * The frontmatter, parsed, or a copy of it.
   *
   * @example `parseFrontmatter("verified: { by: human:jjloneman }")`
   */
  doc: Document;
} & Pick<VerifyRecordParams, "verifiedBy">;

/** A record's frontmatter, parsed with every value as text. */
export type Frontmatter = Document.Parsed;

/** A mapping's pair whose key is a single value, with where it sits. */
export type KeyedPair = Pair<Placed<Scalar>>;

/** A parsed node, with where it sits in the text. */
export type Placed<T extends Node> = {
  /**
   * Where the node starts, where its content ends, and where it ends with any
   * trailing comment.
   *
   * @example [14, 28, 28]
   */
  range: Range;
} & T;

/** What `resolveAlias` needs: the document holding the anchor, the node. */
export type ResolveAliasParams = {
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

/** The frontmatter's text, which every parsed range points into. */
export type TextParams = {
  /**
   * The frontmatter, without its fences.
   *
   * @example `"status: draft\nverified:"`
   */
  text: string;
};

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

/** A frontmatter key the frontmatter modules read or write. */
type FrontmatterKey = (typeof FRONTMATTER_KEYS)[keyof typeof FRONTMATTER_KEYS];

/** What `isSignersBy` needs: an entry's `by`, and the signer. */
type IsSignersByParams = {
  /**
   * The entry's `by`, resolved, or anything else, which names nobody.
   *
   * @example `entry.get("by", true)`
   */
  by: unknown;
} & Pick<VerifyRecordParams, "verifiedBy">;

/** What a helper that reads a position in the frontmatter needs. */
type PositionParams = {
  /**
   * The position, as an index into the text.
   *
   * @example 14
   */
  index: number;
} & TextParams;

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

/** Join the parser's errors into one reason, or `undefined` for none. */
export function describeYamlErrors(doc: Frontmatter): string | undefined {
  const messages = doc.errors.map(({ message }) => message);

  return messages.length === 0
    ? undefined
    : `frontmatter isn't valid YAML: ${messages.join("\n")}`;
}

/**
 * Explain a frontmatter block that is almost right, in text that
 * `splitFrontmatter` found no block in, so its record isn't taken for one
 * with no frontmatter and left out unseen.
 *
 * - It's one whose first non-blank line starts with `---`, indented or not:
 *   a blank line before the opening fence, blanks around a fence, a `...` or lone-CR
 *   close, or no close.
 *
 * - A file that opens with a Markdown rule counts too, since it can't be
 *   told from a fence with a typo.
 *
 * @returns why the block can't be read, or `undefined` when there's none at
 * all.
 */
export function findFenceProblem(text: string): string | undefined {
  const lines = (
    text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  ).split(LINE_BREAK);
  const trimmed = lines.map((line) => line.replace(SURROUNDING_BLANKS, ""));
  const openingIndex = trimmed.findIndex((line) => line !== "");
  const opening = lines[openingIndex] ?? "";

  if (!(trimmed[openingIndex] ?? "").startsWith(FENCE)) {
    return undefined;
  }

  if (openingIndex > 0) {
    return "the opening `---` must be the first line, with no blank line before it";
  }

  if (opening !== FENCE) {
    return `the opening fence must be \`---\` alone on its line, not ${JSON.stringify(opening)}`;
  }

  const closingIndex = trimmed.indexOf(FENCE, 1);
  const closing = lines[closingIndex];

  if (closing === undefined) {
    return trimmed.includes(DOCUMENT_END)
      ? "the frontmatter has no closing `---` line; a `...` line can't close it"
      : "the frontmatter has no closing `---` line";
  }

  // Both fences read clean once lone carriage returns count as line breaks,
  // so one ends a line between the opening fence and the closing one's end.
  return closing === FENCE
    ? "a line in the frontmatter or its fences ends in a lone carriage return; only LF and CRLF line breaks are read"
    : `the closing fence must be \`---\` alone on its line, not ${JSON.stringify(closing)}`;
}

/**
 * Find which of the signer's entries counts: the one whose `at` is latest
 * once read, the first of any that tie, or the first entry when none reads.
 *
 * - The reads, the edits, and the meaning check all pick with this, so the
 *   entry an edit renews is the one the state is judged by.
 */
export function findLatestIndex(
  timestamps: readonly (Timestamp | undefined)[]
): number {
  let latestIndex = 0;
  let latestMillis = Number.NEGATIVE_INFINITY;

  timestamps.forEach((timestamp, index) => {
    const time = timestamp === undefined ? undefined : readTime(timestamp);

    if (time?.isValid === true && time.toMillis() > latestMillis) {
      latestIndex = index;
      latestMillis = time.toMillis();
    }
  });

  return latestIndex;
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
export function findLineEnd(params: PositionParams): number {
  const { index, text } = params;
  const lineFeed = text.indexOf("\n", index - 1);

  return text[lineFeed - 1] === "\r" ? lineFeed - 1 : lineFeed;
}

/**
 * Find `verifiedBy`'s entry, resolving aliases, for the reads and the meaning
 * check; the edits find it in the editable layout instead.
 *
 * - With several entries by the signer, the one with the latest readable `at`
 *   counts, as OKF reads `verified`; `findLatestIndex` picks it for both.
 */
export function findOwnEntry(params: FindOwnEntryParams): undefined | YAMLMap {
  const { doc, verifiedBy } = params;

  const verified = readField({
    doc,
    key: FRONTMATTER_KEYS.verified,
    map: doc.contents,
  });

  const entries: unknown[] = isSeq(verified) ? verified.items : [verified];

  const ownEntries = entries
    .map((entry) => resolveAlias({ doc, node: entry }))
    .filter(
      (entry): entry is YAMLMap =>
        isMap(entry) &&
        isSignersBy({
          by: readField({ doc, key: ENTRY_KEYS.by, map: entry }),
          verifiedBy,
        })
    );

  return ownEntries[
    findLatestIndex(
      ownEntries.map((entry) =>
        readTimestamp(readField({ doc, key: ENTRY_KEYS.at, map: entry }))
      )
    )
  ];
}

/** Find a mapping's pair whose key is the given single value. */
export function findPair(params: FindPairParams): KeyedPair | undefined {
  const { key, map } = params;

  return map.items.find(
    (pair): pair is KeyedPair =>
      isScalar(pair.key) && isPlaced(pair.key) && pair.key.value === key
  );
}

/** Whether a value, from config or a caller, names a style a new entry can take. */
export function isEntryStyle(value: unknown): value is EntryStyle {
  return ENTRY_STYLE_VALUES.has(value);
}

/**
 * Whether a scalar is YAML's null: `~`, `null`, `Null`, `NULL`, or nothing,
 * unquoted, as in YAML 1.2's core schema.
 *
 * - The one rule for both the reads and the edits; a quoted `"null"` is the
 *   string `null`.
 */
export function isNullScalar(node: Scalar): boolean {
  const value = readString(node);

  return (
    node.type === "PLAIN" &&
    value !== undefined &&
    (value === "" || NULL_SPELLINGS.has(value))
  );
}

/** Whether a parsed node carries its position in the text. */
export function isPlaced<T extends Node>(node: T): node is Placed<T> {
  return Array.isArray(node.range);
}

/** Whether a value is a status OKF defines. */
export function isRecordStatus(value: string): value is RecordStatus {
  return RECORD_STATUS_VALUES.has(value);
}

/**
 * Whether an entry's `by` names the signer; a null `by` names nobody, even a
 * signer whose name is spelled `null`.
 */
export function isSignersBy(params: IsSignersByParams): boolean {
  const { by, verifiedBy } = params;

  return isScalar(by) && !isNullScalar(by) && readString(by) === verifiedBy;
}

/**
 * Whether `verifyRecord` can write a timestamp: one in `WRITABLE_TIMESTAMP`'s
 * shape that luxon reads, so a day the month lacks is refused too, and the
 * sign-off can always be dated.
 */
export function isWritableTimestamp(value: string): boolean {
  return (
    WRITABLE_TIMESTAMP.test(value) &&
    DateTime.fromISO(value, { zone: "utc" }).isValid
  );
}

/** Parse frontmatter with every value as text, positions included. */
export function parseFrontmatter(text: string): Frontmatter {
  return parseDocument(text, { schema: "failsafe" });
}

/**
 * Find where the content before a position ends, skipping back over YAML's
 * whitespace and line breaks only.
 *
 * - JavaScript's `trimEnd` also skips characters YAML reads as content, such
 *   as a no-break space ending a plain scalar.
 */
export function readContentEnd(params: PositionParams): number {
  const { index, text } = params;

  return text.slice(0, index).replace(YAML_WHITESPACE_END, "").length;
}

/**
 * Read a key's value from a mapping, resolving an alias for either, so the
 * reads see what the YAML means.
 */
export function readField(params: ReadFieldParams): unknown {
  const { doc, key, map } = params;
  const resolved = resolveAlias({ doc, node: map });

  return isMap(resolved)
    ? resolveAlias({ doc, node: resolved.get(key, true) })
    : undefined;
}

/** Find how far a position's line is indented, as spaces. */
export function readIndent(params: PositionParams): string {
  const { index, text } = params;
  const beforeNode = text.slice(readLineStart(params), index);

  // The parser starts a mapping after its first key's anchor or tag, which
  // the new line's indent must not count.
  const properties = /(?:[!&]\S*[\t ]+)+$/u.exec(beforeNode)?.[0] ?? "";

  return " ".repeat(readColumn(params) - properties.length);
}

/** Read the line break that starts at a line end `findLineEnd` found. */
export function readLineBreak(params: PositionParams): string {
  const { index, text } = params;

  return text.startsWith(CRLF, index) ? CRLF : LF;
}

/** Find where the line holding a position starts. */
export function readLineStart(params: PositionParams): number {
  const { index, text } = params;

  return text.lastIndexOf("\n", index - 1) + 1;
}

/**
 * Find where a node's content ends, or `0` for no node.
 *
 * - A block collection's own range can run on to the next field's first
 *   character, past comment lines, when its last value is empty, so its end is
 *   taken from its last value instead.
 */
export function readNodeEnd(node: unknown): number {
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

/** Read a value as text, or `undefined` when it isn't a single value. */
export function readString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === "string"
    ? node.value
    : undefined;
}

/** Read a timestamp as ISO 8601, or with a space before the time, in UTC. */
export function readTime(value: Timestamp): DateTime {
  const iso = DateTime.fromISO(value, { zone: "utc" });

  return iso.isValid ? iso : DateTime.fromSQL(value, { zone: "utc" });
}

/** Read a timestamp, or `undefined` when it's missing, empty, or null. */
export function readTimestamp(node: unknown): Timestamp | undefined {
  if (!isScalar(node) || isNullScalar(node)) {
    return undefined;
  }

  const value = readString(node);

  return value === "" ? undefined : value;
}

/** Follow an alias to the node its anchor names, or return the node as is. */
export function resolveAlias(params: ResolveAliasParams): unknown {
  const { doc, node } = params;

  return isAlias(node) ? node.resolve(doc) : node;
}

/**
 * Find a record's frontmatter: the text between a `---` first line and the
 * next `---` line, by position, so the rest of the record is never rewritten.
 *
 * - The text keeps its line breaks as written, LF or CRLF, mixed or not, and
 *   ends with the one before the closing fence, unless it's empty.
 */
export function splitFrontmatter(text: string): FrontmatterBlock | undefined {
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

/** Find how far a position sits from the start of its line. */
function readColumn(params: PositionParams): number {
  return params.index - readLineStart(params);
}
