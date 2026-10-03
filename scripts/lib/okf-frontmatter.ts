/*
 * Pure helpers that read and edit the frontmatter of an OKF record.
 *
 * - Edits are targeted line replacements, never a YAML round-trip, so nothing
 *   else in the file is reformatted.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */

/** The lifecycle statuses OKF defines for a record. */
export const RECORD_STATUSES = {
  deprecated: "deprecated",
  draft: "draft",
  stable: "stable",
} as const;

/** A YAML comment: whitespace, then `#` through the end of the line. */
const COMMENT = String.raw`\s+#.*`;

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

/** The start of a block-style line: indent, then an optional list dash. */
const OPTIONAL_LIST_DASH = String.raw`^\s*(?:-\s+)?`;

/** An optional quote around a scalar, which YAML allows on any of them. */
const QUOTE = String.raw`["']?`;

/**
 * The statuses OKF defines, as a set for the type guard to look values up in.
 *
 * - Typed as `ReadonlySet<string>`, so `has` accepts any string, not only a
 *   status already known to be one.
 */
const RECORD_STATUS_VALUES: ReadonlySet<string> = new Set(
  Object.values(RECORD_STATUSES)
);

/** What a timestamp looks like on a line: up to the next separator or quote. */
const TIMESTAMP = String.raw`[^\s,}\]"'#]+`;

/** A timestamp, captured as the `at` group. */
const TIMESTAMP_CAPTURE = `(?<at>${TIMESTAMP})`;

// Below `QUOTE`, since it is built from it.
/** An `at:` key and the optional quote before its timestamp. */
const AT_KEY = String.raw`\bat:\s*${QUOTE}`;

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

/** What `blockFieldLine` needs: the key, and the pattern for its value. */
type BlockFieldLineParams = {
  /**
   * The entry key the line holds.
   *
   * @example "at"
   */
  key: EntryKey;

  /**
   * A regex source matching the value, without its quotes.
   *
   * @example `"(?<at>[^\\s]+)"`
   */
  valueSource: string;
};

/** A key of one `verified` or `generated` entry. */
type EntryKey = (typeof ENTRY_KEYS)[keyof typeof ENTRY_KEYS];

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

/** What `findOwnEntry` needs: the lines, and whose entry to find. */
type FindOwnEntryParams = LinesParams & Pick<VerifyRecordParams, "verifiedBy">;

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

/** The `verified` entry that belongs to the person signing off. */
type OwnEntry = {
  /**
   * The entry's timestamp, when the entry carries a readable one.
   *
   * @example "2026-09-28T09:00:00Z"
   */
  at: RecordSummary["verifiedAt"];

  /**
   * The line that carries the timestamp: for a block-style list item, its `at:` line rather than its `- by:` line.
   *
   * @example 5
   */
  index: number;

  /**
   * Whether the entry is a block-style list item.
   *
   * @example false
   */
  isBlock: boolean;
};

/** A run of lines a helper works within. */
type RangeParams = {
  /**
   * The run of lines that holds a whole field.
   *
   * @example `{ endIndex: 4, startIndex: 3 }`
   */
  range: LineRange;
};

/** What `readKeyValue` needs: the key, and the line it starts. */
type ReadKeyValueParams = {
  /**
   * A line that starts with `key:`.
   *
   * @example "status: draft"
   */
  line: string | undefined;
} & KeyParams;

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

  const { lines } = block;

  return {
    generatedAt: readGeneratedAt(lines),
    status: readStatus(lines),
    title: readScalar({ key: FRONTMATTER_KEYS.title, lines }),
    type: readScalar({ key: FRONTMATTER_KEYS.type, lines }),
    verifiedAt: findOwnEntry({ lines, verifiedBy })?.at,
  };
}

/**
 * Mark a record verified: `draft` becomes `stable`, and `verifiedBy`'s entry
 * gets `at` as its timestamp.
 *
 * - An existing entry for `verifiedBy` has its `at` updated, in the inline,
 *   list, block-style, or flow-sequence form, rather than gaining a second
 *   entry.
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

  if (readStatus(lines) === RECORD_STATUSES.draft) {
    const statusIndex = findKeyIndex({ key: FRONTMATTER_KEYS.status, lines });
    const { comment } = splitTrailingComment(lines[statusIndex] ?? "");

    lines[statusIndex] =
      `${FRONTMATTER_KEYS.status}: ${RECORD_STATUSES.stable}${comment}`;
  }

  const layoutProblem = upsertVerified({ at, lines, verifiedBy });

  if (layoutProblem !== undefined) {
    return { isOk: false, reason: layoutProblem };
  }

  return {
    isOk: true,
    text: [FENCE, ...lines, ...block.rest].join(block.lineBreak),
  };
}

/** Add an entry to the end of a flow sequence such as `[{ … }]`. */
function appendToFlowSequence(params: AppendToFlowSequenceParams): string {
  const { entry, sequence } = params;
  const items = sequence.replace(/^\[\s*/, "").replace(/\s*\]$/, "");

  return items === "" ? `[${entry}]` : `[${items}, ${entry}]`;
}

/**
 * Match one whole block-style line, `key: value`, as a list item or under one.
 *
 * - The value may be quoted and followed by a comment, as YAML allows.
 */
function blockFieldLine(params: BlockFieldLineParams): RegExp {
  const { key, valueSource } = params;

  return new RegExp(
    `${OPTIONAL_LIST_DASH}${key}:\\s*${QUOTE}${valueSource}${QUOTE}(?:${COMMENT})?\\s*$`
  );
}

/** Escape the characters that are special in a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * Split the `verified` field into entries: the inline value on the key line,
 * then each list item with the indented lines that continue it.
 */
function findEntryItems(params: LinesParams & RangeParams): LineRange[] {
  const { lines, range } = params;
  const items: LineRange[] = [];

  const inlineValue = readKeyValue({
    key: FRONTMATTER_KEYS.verified,
    line: lines[range.startIndex],
  });

  if (inlineValue !== "") {
    items.push({ endIndex: range.startIndex, startIndex: range.startIndex });
  }

  for (let index = range.startIndex + 1; index <= range.endIndex; index += 1) {
    const lastItem = items.at(-1);

    if (LIST_ITEM_LINE.test(lines[index] ?? "") || lastItem === undefined) {
      items.push({ endIndex: index, startIndex: index });
    } else {
      lastItem.endIndex = index;
    }
  }

  return items;
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

  while (isContinuation.test(lines[endIndex + 1] ?? "")) {
    endIndex += 1;
  }

  return { endIndex, startIndex };
}

/** Find the line holding `verifiedBy`'s `verified` entry, in any of the forms. */
function findOwnEntry(params: FindOwnEntryParams): OwnEntry | undefined {
  const { lines, verifiedBy } = params;
  const range = findVerifiedRange(lines);

  if (range === undefined) {
    return undefined;
  }

  const blockActor = blockFieldLine({
    key: ENTRY_KEYS.by,
    valueSource: escapeRegExp(verifiedBy),
  });

  const blockAt = blockFieldLine({
    key: ENTRY_KEYS.at,
    valueSource: TIMESTAMP_CAPTURE,
  });

  const inlineEntry = new RegExp(
    `${ownEntryPrefix(verifiedBy)}${TIMESTAMP_CAPTURE}`
  );

  for (const item of findEntryItems({ lines, range })) {
    const itemLines = lines.slice(item.startIndex, item.endIndex + 1);

    // Checked on every line, so a flow sequence spread over several lines counts.
    const inlineOffset = itemLines.findIndex((line) => inlineEntry.test(line));

    if (inlineOffset !== -1) {
      return {
        at: inlineEntry.exec(itemLines[inlineOffset] ?? "")?.groups?.at,
        index: item.startIndex + inlineOffset,
        isBlock: false,
      };
    }

    if (!itemLines.some((line) => blockActor.test(line))) {
      continue;
    }

    const offset = itemLines.findIndex((line) => blockAt.test(line));

    // An entry by the owner with no timestamp to renew isn't one to keep.
    if (offset === -1) {
      continue;
    }

    return {
      at: blockAt.exec(itemLines[offset] ?? "")?.groups?.at,
      index: item.startIndex + offset,
      isBlock: true,
    };
  }

  return undefined;
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

/**
 * Match `by: <verifiedBy>, at: ` exactly, through the timestamp's optional
 * quote, so `human:jjloneman2` is no one's alias.
 */
function ownEntryPrefix(verifiedBy: string): string {
  return String.raw`\bby:\s*${QUOTE}${escapeRegExp(verifiedBy)}${QUOTE}\s*,\s*${AT_KEY}`;
}

/** Read `generated.at`, whether `generated` is inline or a nested block. */
function readGeneratedAt(lines: string[]): RecordSummary["generatedAt"] {
  const range = findKeyRange({
    isContinuation: INDENTED_LINE,
    key: FRONTMATTER_KEYS.generated,
    lines,
  });

  return range === undefined
    ? undefined
    : new RegExp(`${AT_KEY}${TIMESTAMP_CAPTURE}`).exec(
        lines.slice(range.startIndex, range.endIndex + 1).join(" ")
      )?.groups?.at;
}

/** Read the raw text after `key:` on a line, trimmed. */
function readKeyValue(params: ReadKeyValueParams): string {
  const { key, line } = params;

  return (line ?? "").slice(`${key}:`.length).trim();
}

/** Read a one-line scalar value, without its quotes or a trailing comment. */
function readScalar(params: KeyParams & LinesParams): string | undefined {
  const { key, lines } = params;
  const line = lines[findKeyIndex(params)];

  if (line === undefined) {
    return undefined;
  }

  const value = readKeyValue({ key, line });

  const quoted = /^(?<quote>["'])(?<inner>.*?)\k<quote>/.exec(value)?.groups
    ?.inner;

  return quoted ?? splitTrailingComment(value).value;
}

/**
 * Read `status`, narrowed to the statuses OKF defines.
 *
 * - The text is external input, so narrowing happens here, once, and a value
 *   that isn't a known status reads as absent instead of passing through.
 */
function readStatus(lines: string[]): RecordStatus | undefined {
  const status = readScalar({ key: FRONTMATTER_KEYS.status, lines });

  return status !== undefined && isRecordStatus(status) ? status : undefined;
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
  const match = new RegExp(`^(?<value>.*?)(?<comment>${COMMENT})?$`).exec(text);

  return {
    comment: match?.groups?.comment ?? "",
    value: match?.groups?.value ?? text,
  };
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

  const own = findOwnEntry({ lines, verifiedBy });

  if (own !== undefined) {
    const timestampPrefix = own.isBlock ? AT_KEY : ownEntryPrefix(verifiedBy);

    lines[own.index] = (lines[own.index] ?? "").replace(
      new RegExp(`(?<=${timestampPrefix})${TIMESTAMP}`),
      at
    );

    return undefined;
  }

  const { comment, value: inlineValue } = splitTrailingComment(
    readKeyValue({
      key: FRONTMATTER_KEYS.verified,
      line: lines[range.startIndex],
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

  if (/^(?:null|~)$/.test(inlineValue)) {
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
