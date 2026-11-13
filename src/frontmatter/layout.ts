/*
 * The editable-layout allowlist: reads the `status` and `verified` fields
 * the edits know how to change, and refuses every other layout with a
 * reason.
 */
import type { Node, Scalar, YAMLMap, YAMLSeq } from "yaml";

import { isAlias, isMap, isNode, isScalar, isSeq } from "yaml";

import type {
  EntryKey,
  FieldNodeParams,
  Frontmatter,
  KeyedPair,
  Placed,
  TextParams,
} from "./shared.ts";
import type { VerifyRecordParams } from "./types.ts";

import {
  ENTRY_KEYS,
  findPair,
  FRONTMATTER_KEYS,
  isNullScalar,
  isPlaced,
  isSignersBy,
  readLineStart,
  readString,
  resolveAlias,
} from "./shared.ts";
import { RECORD_STATUSES } from "./types.ts";

/** The frontmatter's `status` and `verified`, in a layout the edits support. */
export type EditableLayout = {
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
export type Entry = {
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

/** What `isOneLine` needs: the node, and the text its range points into. */
type IsOneLineParams = {
  /**
   * The parsed node.
   *
   * @example `doc.get("verified", true)`
   */
  node: Placed<Node>;
} & TextParams;

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
export function readEditableLayout(
  params: ReadEditableLayoutParams
): LayoutResult {
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
export function readEntries(verified: VerifiedLayout): Entry[] {
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

/** Whether a node's content, not its trailing comment, is on one line. */
function isOneLine(params: IsOneLineParams): boolean {
  const { node, text } = params;
  const [start, end] = node.range;

  return !text.slice(start, end).includes("\n");
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

/** Say that a field spans several lines, which the edits don't handle. */
function spansLines(field: string): string {
  return `${field} spans several lines`;
}
