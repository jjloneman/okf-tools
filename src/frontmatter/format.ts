/*
 * Formats a record's frontmatter in place, for `okf check --fix`: sorts its
 * `tags`, rewrites a flow `tags` list as a block list, and orders its
 * top-level keys, as the house rules a repo turned on ask.
 *
 * - Each fix moves text by the positions the parser reports, so a value
 *   keeps its quotes and its style; nothing is serialized again.
 *
 * - `generated` and `verified` are never edited, so formatting a record never
 *   voids its sign-off, and every key, unknown and `x-` keys included, is
 *   kept.
 *
 * - The result is checked to mean what the original did, apart from the
 *   order of the tags and the keys, before it's returned.
 *
 * - Nothing here touches the file system or the clock.
 */
import type { Scalar, YAMLMap, YAMLSeq } from "yaml";

import { isDeepStrictEqual } from "node:util";
import { isAlias, isMap, isScalar, isSeq } from "yaml";

import type { Outcome } from "../outcome.ts";
import type { RecordVerification, TextEdit } from "./edit.ts";
import type { Frontmatter, Placed } from "./shared.ts";

import { applyEdits } from "./edit.ts";
import { findAmbiguity } from "./meaning.ts";
import {
  describeYamlErrors,
  findFenceProblem,
  findLineEnd,
  findPair,
  FRONTMATTER_KEYS,
  isPlaced,
  parseFrontmatter,
  readIndent,
  readLineBreak,
  readLineStart,
  readNodeEnd,
  readString,
  splitFrontmatter,
} from "./shared.ts";
import { REFUSAL_KINDS } from "./types.ts";

/** What `formatRecord` needs: the record, and which fixes to make. */
export type FormatRecordParams = {
  /**
   * The top-level keys to put first, in this order, the others after them as
   * they were; `undefined` leaves the order alone.
   *
   * @example `["type", "title", "description"]`
   */
  keyOrder?: readonly string[] | undefined;

  /**
   * Whether to rewrite a flow `tags` list as a block list, one `- tag` per
   * line.
   *
   * @example true
   */
  shouldBlockTags: boolean;

  /**
   * Whether to sort `tags` alphabetically, as `tags-sorted` reads them.
   *
   * @example true
   */
  shouldSortTags: boolean;

  /**
   * The record's text, frontmatter included.
   *
   * @example `"---\ntags: [b, a]\n---\n"`
   */
  text: string;
};

/** A tag as written: its node, and its text in the frontmatter. */
type WrittenTag = {
  /**
   * The tag's node, a single value on one line.
   *
   * @example `seq.items[0]`
   */
  node: Placed<Scalar>;

  /**
   * The tag exactly as written, quotes included.
   *
   * @example "\"open-knowledge\""
   */
  raw: string;

  /**
   * The tag's value, as `tags-sorted` compares it.
   *
   * @example "open-knowledge"
   */
  value: string;
};

/** What a refusal of an unsupported layout tells the person to do instead. */
const HAND_EDIT_HINT = "fix the record by hand";

/** The quoting styles a tag may be written in to be moved as it is. */
const MOVABLE_TYPES: ReadonlySet<Scalar["type"]> = new Set([
  "PLAIN",
  "QUOTE_DOUBLE",
  "QUOTE_SINGLE",
]);

/**
 * Check that the formatted frontmatter means the original, its tags sorted
 * when asked, with its keys in the order asked.
 *
 * - The fixes are built to pass it; it's the net under them, so a layout
 *   they get wrong is refused rather than written with another meaning.
 *
 * @returns why it doesn't, or `undefined` when it does.
 */
export function checkFormatted(params: {
  doc: Frontmatter;
  edited: string;
  keyOrder: readonly string[] | undefined;
  shouldSortTags: boolean;
}): string | undefined {
  const { doc, edited, keyOrder, shouldSortTags } = params;
  const editedDoc = parseFrontmatter(edited);

  if (editedDoc.errors.length > 0 || findAmbiguity(editedDoc) !== undefined) {
    return "the formatted frontmatter wouldn't be valid YAML";
  }

  try {
    return compareFormatted({ doc, editedDoc, keyOrder, shouldSortTags });
  } catch {
    // The parser refuses to expand an alias used too many times.
    return "the frontmatter uses an alias too many times to compare";
  }
}

/**
 * Format a record's frontmatter as asked: sort `tags`, rewrite a flow `tags`
 * list as a block list, and order the top-level keys.
 *
 * - A fix with nothing to do leaves the text as it is.
 *
 * - The refusals `writeFields` makes guard it too: no frontmatter, YAML that
 *   isn't valid or whose meaning is ambiguous, a lone carriage return, and
 *   frontmatter that isn't a block mapping.
 *
 * - A `tags` list is refused when it holds anything but single values on one
 *   line each, an anchor, a tag, an alias, or a comment between its tags, or
 *   its key is quoted; the keys are refused when a comment line sits between
 *   two of them.
 *
 * - Everything outside the moved text, line endings included, is kept byte
 *   for byte.
 */
export function formatRecord(params: FormatRecordParams): RecordVerification {
  const {
    keyOrder,
    shouldBlockTags,
    shouldSortTags,
    text: recordText,
  } = params;
  const block = splitFrontmatter(recordText);

  if (block === undefined) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.noFrontmatter,
      reason: findFenceProblem(recordText) ?? "no frontmatter block",
    };
  }

  const doc = parseFrontmatter(block.text);
  const inputProblem = describeYamlErrors(doc);

  if (inputProblem !== undefined) {
    return {
      isOk: false,
      kind: REFUSAL_KINDS.invalidYaml,
      reason: inputProblem,
    };
  }

  // YAML 1.2 ends a line at a lone carriage return, though the parser reads
  // it as text, so the positions could split a line other tools read whole.
  if (/\r(?!\n)/u.test(block.text)) {
    return refuseLayout(
      "the frontmatter holds a carriage return that doesn't end a line"
    );
  }

  const ambiguity = findAmbiguity(doc);

  if (ambiguity !== undefined) {
    return refuseLayout(ambiguity);
  }

  if (!isMap(doc.contents) || doc.contents.flow === true) {
    return refuseLayout("the frontmatter isn't a block mapping");
  }

  let text = block.text;

  if (shouldBlockTags || shouldSortTags) {
    const tagged = formatTags({ shouldBlockTags, shouldSortTags, text });

    if (!tagged.isOk) {
      return refuseLayout(tagged.reason);
    }

    text = tagged.value;
  }

  if (keyOrder !== undefined) {
    const ordered = orderKeys({ keyOrder, text });

    if (!ordered.isOk) {
      return refuseLayout(ordered.reason);
    }

    text = ordered.value;
  }

  const meaningProblem = checkFormatted({
    doc,
    edited: text,
    keyOrder,
    shouldSortTags,
  });

  if (meaningProblem !== undefined) {
    return refuseLayout(meaningProblem);
  }

  return {
    isOk: true,
    text: [
      recordText.slice(0, block.start),
      text,
      recordText.slice(block.end),
    ].join(""),
  };
}

/** Order key names: the ones `keyOrder` lists first, then the rest. */
export function orderKeyNames(params: {
  keyOrder: readonly string[];
  names: readonly string[];
}): string[] {
  const { keyOrder, names } = params;
  const rank = rankKeys(keyOrder);

  // `sort` is stable, so the keys `keyOrder` doesn't list keep their order.
  return [...names].sort((left, right) => rank(left) - rank(right));
}

/**
 * Compare the formatted frontmatter's meaning and key order with the
 * original's, as `checkFormatted` asks.
 *
 * @returns why they differ, or `undefined` when they don't.
 */
function compareFormatted(params: {
  doc: Frontmatter;
  editedDoc: Frontmatter;
  keyOrder: readonly string[] | undefined;
  shouldSortTags: boolean;
}): string | undefined {
  const { doc, editedDoc, keyOrder, shouldSortTags } = params;

  // The frontmatter was checked to be a mapping, so it reads as an object.
  const original = doc.toJS() as Record<string, unknown>;
  const expected = { ...original };
  const tags = expected[FRONTMATTER_KEYS.tags];

  // The failsafe schema reads every single value as text, so a list whose
  // tags were all moved holds only strings.
  if (shouldSortTags && Array.isArray(tags)) {
    expected[FRONTMATTER_KEYS.tags] = [...(tags as string[])].sort(compareTags);
  }

  const formatted = editedDoc.toJS() as Record<string, unknown>;

  // `isDeepStrictEqual` doesn't compare the order of an object's keys.
  if (!isDeepStrictEqual(formatted, expected)) {
    return "the formatted frontmatter would be read as something else";
  }

  // `Object.keys` lists a key such as `2024` first, so the order is read
  // from the mappings as written.
  return keyOrder === undefined ||
    isDeepStrictEqual(
      readKeyNames(editedDoc),
      orderKeyNames({ keyOrder, names: readKeyNames(doc) })
    )
    ? undefined
    : "the keys couldn't be put in order";
}

/** Compare two tags as `tags-sorted` does: by code unit. */
function compareTags(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

/**
 * Sort a record's `tags`, or rewrite a flow list as a block list, or both,
 * moving each tag's text as written.
 *
 * - A block list's tags are indented two spaces past `tags:`, each as
 *   `- tag`, and a comment after a flow list moves up to the `tags:` line.
 */
function formatTags(params: {
  shouldBlockTags: boolean;
  shouldSortTags: boolean;
  text: string;
}): Outcome<string> {
  const { shouldBlockTags, shouldSortTags, text } = params;
  const map = parseFrontmatter(text).contents as YAMLMap;
  const pair = findPair({ key: FRONTMATTER_KEYS.tags, map });
  const seq = pair?.value;

  // The rules read through an alias, but its list is written elsewhere.
  if (isAlias(seq)) {
    return { isOk: false, reason: "`tags` is an alias" };
  }

  // A single value or an empty list has no order or layout to fix.
  if (pair === undefined || !isSeq(seq) || seq.items.length === 0) {
    return { isOk: true, value: text };
  }

  const tags = readWrittenTags({ seq: seq as Placed<YAMLSeq>, text });

  if (!tags.isOk) {
    return tags;
  }

  const sorted = shouldSortTags
    ? [...tags.value].sort((left, right) =>
        compareTags(left.value, right.value)
      )
    : tags.value;

  if (!shouldBlockTags || seq.flow !== true) {
    // Each tag's place takes the tag that sorts there; `slice` pairs them up
    // with no index that could miss.
    const edits = tags.value.flatMap(({ node }, index) =>
      sorted.slice(index, index + 1).map(({ raw }): TextEdit => ({
        end: node.range[1],
        start: node.range[0],
        text: raw,
      }))
    );

    return { isOk: true, value: applyEdits({ edits, text }) };
  }

  if (pair.key.type !== "PLAIN") {
    return { isOk: false, reason: "the `tags` key is quoted" };
  }

  const start = pair.key.range[1];
  const end = findLineEnd({ index: readNodeEnd(seq), text });

  // Only a comment can follow a flow list on its last line.
  const comment = text.slice(readNodeEnd(seq), end).trim();

  if (
    !/^[\t ]*:[\t\n\r ]*$/u.test(
      text.slice(start, (seq as Placed<YAMLSeq>).range[0])
    )
  ) {
    return {
      isOk: false,
      reason: "something other than `:` sits between `tags` and its list",
    };
  }

  const lineBreak = readLineBreak({ index: end, text });
  const indent = `${readIndent({ index: pair.key.range[0], text })}  `;
  const lines = sorted.map(({ raw }) => `${lineBreak}${indent}- ${raw}`);

  return {
    isOk: true,
    value: applyEdits({
      edits: [
        {
          end,
          start,
          text: `:${comment === "" ? "" : ` ${comment}`}${lines.join("")}`,
        },
      ],
      text,
    }),
  };
}

/**
 * Put the top-level keys in the order asked, moving each key's lines, from
 * the key to the next key, as they are.
 *
 * - Lines before the first key stay where they are.
 */
function orderKeys(params: {
  keyOrder: readonly string[];
  text: string;
}): Outcome<string> {
  const { keyOrder, text } = params;
  const map = parseFrontmatter(text).contents as Placed<YAMLMap>;
  const keys: { name: string; start: number }[] = [];

  for (const { key } of map.items) {
    const name = readString(key);

    // A key starts its own line at the left edge in a block mapping, unless
    // an anchor, a tag, or `?` comes before it.
    if (
      name === undefined ||
      !isScalar(key) ||
      !isPlaced(key) ||
      readLineStart({ index: key.range[0], text }) !== key.range[0]
    ) {
      return {
        isOk: false,
        reason:
          "a top-level key is indented, or isn't a plain key at the start of its line",
      };
    }

    keys.push({ name, start: key.range[0] });
  }

  const pieces = keys.map(({ name, start }, index) => ({
    name,
    text: text.slice(
      start,
      Math.min(text.length, ...keys.slice(index + 1).map((next) => next.start))
    ),
  }));

  // A comment line at the left edge between two keys could head either.
  if (pieces.some((piece) => piece.text.includes("\n#"))) {
    return {
      isOk: false,
      reason: "a comment line sits between two top-level keys",
    };
  }

  const rank = rankKeys(keyOrder);
  const prefix = text.slice(0, Math.min(...keys.map(({ start }) => start)));

  // `sort` is stable, so the keys `keyOrder` doesn't list keep their order.
  return {
    isOk: true,
    value: `${prefix}${pieces
      .sort((left, right) => rank(left.name) - rank(right.name))
      .map((piece) => piece.text)
      .join("")}`,
  };
}

/** Rank a key by its place in `keyOrder`, a key it doesn't list last. */
function rankKeys(keyOrder: readonly string[]): (name: string) => number {
  return (name) => {
    const index = keyOrder.indexOf(name);

    return index === -1 ? keyOrder.length : index;
  };
}

/** Read a mapping's keys, in the order they're written, as text. */
function readKeyNames(doc: Frontmatter): string[] {
  // The fixes run only on a block mapping, and the meaning check on one too.
  return (doc.contents as YAMLMap).items.map(({ key }) => String(key));
}

/**
 * Read each tag of a list as written, refusing a list whose tags can't be
 * moved as they are.
 */
function readWrittenTags(params: {
  seq: Placed<YAMLSeq>;
  text: string;
}): Outcome<WrittenTag[]> {
  const { seq, text } = params;
  const tags: WrittenTag[] = [];

  if (seq.anchor !== undefined || seq.tag !== undefined) {
    return { isOk: false, reason: "`tags` has an anchor or a tag" };
  }

  for (const node of seq.items) {
    const value = readString(node);

    if (
      value === undefined ||
      !isScalar(node) ||
      !isPlaced(node) ||
      node.type === undefined ||
      !MOVABLE_TYPES.has(node.type) ||
      node.anchor !== undefined ||
      node.tag !== undefined ||
      node.comment !== undefined ||
      node.commentBefore !== undefined ||
      text.slice(node.range[0], node.range[1]).includes("\n")
    ) {
      return {
        isOk: false,
        reason:
          "`tags` holds something other than single values on one line each",
      };
    }

    tags.push({
      node,
      raw: text.slice(node.range[0], node.range[1]),
      value,
    });
  }

  // Outside its tags, a list holds only brackets, commas, dashes and space.
  const bounds = [
    seq.range[0],
    ...tags.flatMap(({ node }) => [node.range[0], node.range[1]]),
    readNodeEnd(seq),
  ];
  const gaps = bounds
    .flatMap((start, index) =>
      index % 2 === 0 ? [text.slice(start, bounds[index + 1])] : []
    )
    .join("");

  return gaps.includes("#")
    ? { isOk: false, reason: "a comment sits inside `tags`" }
    : { isOk: true, value: tags };
}

/** Refuse a layout that needs a hand edit, saying so. */
function refuseLayout(problem: string): RecordVerification {
  return {
    isOk: false,
    kind: REFUSAL_KINDS.unsupportedLayout,
    reason: `${problem}; ${HAND_EDIT_HINT}`,
  };
}
