/*
 * The pure logic `okf index` runs on one `index.md`: it rewrites each list
 * line that links to a record from that record's frontmatter, and the tag
 * index between its markers, keeping everything else as written.
 *
 * - A record line is a top-level list item that opens with a link to a
 *   record: `- [Title](file.md) - description`.
 *
 * - Lines are rewritten in place, so a grouped index keeps each record under
 *   the heading it's already in; each run of record lines is sorted by title,
 *   ignoring case.
 *
 * - The frontmatter, such as a root index's `okf_version`, fenced code, and
 *   every line that isn't a record line are never touched.
 */
import path from "node:path";

import type { BodyLine } from "./markdown.ts";

import { findMarkedBlock } from "./agent-block.ts";
import {
  findBodyStart,
  hasScheme,
  maskFences,
  splitLines,
} from "./markdown.ts";

/** Where an index differs from what `okf index` would write. */
export type IndexDrift = {
  /**
   * How: a scoped record no line links to, a line whose title or
   * description differs from its record's, or a line out of order in its
   * run.
   *
   * @example "stale"
   */
  kind: "missing" | "order" | "stale";

  /**
   * The 1-based line in the index, or `undefined` for a missing record.
   *
   * @example 7
   */
  line: number | undefined;

  /**
   * The record's path from the repo root.
   *
   * @example "docs/decisions/a.md"
   */
  recordPath: string;
};

/** A record as an index lists it, read from its frontmatter. */
export type IndexRecord = {
  /**
   * Its `description`, or `undefined` when it has none.
   *
   * @example "Every export returns a fallback instead of throwing."
   */
  description: string | undefined;

  /**
   * Its path from the repo root, with `/` separators.
   *
   * @example "docs/decisions/package-promise.md"
   */
  path: string;

  /**
   * Its tags, each once.
   *
   * @example `["api", "cli"]`
   */
  tags: readonly string[];

  /**
   * Its `title`, or `undefined` when it has none.
   *
   * @example "What every export promises"
   */
  title: string | undefined;
};

/** An index's text after a sync, or why it can't be synced. */
export type IndexSync =
  | {
      /**
       * Whether it could be synced; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not, worded to follow the index's path.
       *
       * @example "has a tag-index:start marker but no tag-index:end"
       */
      problem: string;
    }
  | {
      /**
       * Whether it could be synced; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The synced text, the same as the input when it was already current.
       *
       * @example `"# Decisions\n\n- [A](a.md) - The first.\n"`
       */
      text: string;
    };

/** What `syncIndex` needs to rewrite one index. */
export type SyncIndexParams = {
  /**
   * Whether a path from the repo root exists, so a line linking to a record
   * that's gone can be dropped.
   *
   * @example `(filePath) => existsSync(path.join(repoRoot, filePath))`
   */
  doesExist: (filePath: string) => boolean;

  /**
   * The index's path from the repo root, with `/` separators.
   *
   * @example "docs/decisions/index.md"
   */
  indexPath: string;

  /**
   * Every record in the bundles, so a line linking to any of them is
   * rewritten, wherever it's listed.
   *
   * @example `[{ path: "docs/decisions/a.md", title: "A", … }]`
   */
  records: readonly IndexRecord[];

  /**
   * The records this index lists: those whose nearest `index.md` it is. One
   * no line links to yet is added, and the tag index lists only these.
   *
   * @example `[{ path: "docs/decisions/a.md", title: "A", … }]`
   */
  scoped: readonly IndexRecord[];

  /**
   * The index's text.
   *
   * @example `"---\nokf_version: \"0.2\"\n---\n\n# Decisions\n"`
   */
  text: string;
};

/** A piece of the body: a line kept as is, or a run of record lines. */
type BodyPiece =
  | {
      /**
       * A line kept as written.
       *
       * @example "line"
       */
      kind: "line";

      /**
       * The line.
       *
       * @example `{ content: "# Decisions", ending: "\n" }`
       */
      line: BodyLine;
    }
  | {
      /**
       * Text written as is, such as the rewritten tag index.
       *
       * @example "raw"
       */
      kind: "raw";

      /**
       * The text.
       *
       * @example `"<!-- tag-index:start -->\n<!-- tag-index:end -->\n"`
       */
      text: string;
    }
  | {
      /**
       * The line break after the run's last line, as written.
       *
       * @example `"\n"`
       */
      ending: string;

      /**
       * The record lines, sorted when the body is written.
       *
       * @example `[{ record: { path: "docs/decisions/a.md", … }, … }]`
       */
      items: RecordItem[];

      /**
       * Consecutive record lines.
       *
       * @example "run"
       */
      kind: "run";
    };

/** The named groups `ITEM_LINE` captures. */
type ItemGroups = {
  /**
   * The list marker.
   *
   * @example "-"
   */
  bullet: string;

  /**
   * The spaces before the list marker.
   *
   * @example ""
   */
  indent: string;

  /**
   * The link text, as written.
   *
   * @example "What every export promises"
   */
  label: string;

  /**
   * What follows the link.
   *
   * @example " - Every export returns a fallback."
   */
  rest: string;

  /**
   * The link's target, as written.
   *
   * @example "package-promise.md"
   */
  target: string;
};

/** One record line, and the lines indented under it. */
type RecordItem = {
  /**
   * The list marker.
   *
   * @example "-"
   */
  bullet: string;

  /**
   * The lines indented under it, kept as written.
   *
   * @example `[{ content: "  - A note.", ending: "\n" }]`
   */
  children: BodyLine[];

  /**
   * The spaces before the list marker.
   *
   * @example ""
   */
  indent: string;

  /**
   * The line as written, and where it starts in the body, or `undefined`
   * for a record a sync adds.
   *
   * @example `{ line: { content: "- [A](a.md)", ending: "\n" }, offset: 9 }`
   */
  read: { line: BodyLine; offset: number } | undefined;

  /**
   * The record it links to.
   *
   * @example `{ path: "docs/decisions/a.md", title: "A", … }`
   */
  record: IndexRecord;

  /**
   * What sits between the link and the description.
   *
   * @example " - "
   */
  separator: string;

  /**
   * The link's target, as written.
   *
   * @example "a.md"
   */
  target: string;
};

/** The default list marker and separator, for an index with no record line. */
const DEFAULT_STYLE = { bullet: "-", indent: "", separator: " - " } as const;

/** An ATX heading, which a first list of records is added under. */
const HEADING_LINE = /^ {0,3}#{1,6}(?:[\t ]|$)/u;

/**
 * A top-level list item opening with a link: its indent, marker, link text,
 * target, and the rest of the line.
 */
const ITEM_LINE =
  /^(?<indent> {0,3})(?<bullet>[*+-]) \[(?<label>(?:\\.|[^\\\]])*)\]\((?<target><[^<>\n]*>|[^\s()]+)\)(?<rest>.*)$/u;

/** Any list item, nested or numbered, opening with a link: its target. */
const LINKED_LINE =
  /^[\t ]*(?:[*+-]|\d{1,9}[.)])[\t ]+\[(?:\\.|[^\\\]])*\]\((?<target><[^<>\n]*>|[^\s()]+)\)/u;

/** A separator at the start of what follows the link, such as ` - `. */
const SEPARATOR = /^[\t ]+[:–—-][\t ]+|^:[\t ]+/u;

/** The line that closes the tag index. */
export const TAG_INDEX_END = "<!-- tag-index:end -->";

/** The line that opens the tag index. */
export const TAG_INDEX_START = "<!-- tag-index:start -->";

/** What a tag with no records lists, so the tag stays in the vocabulary. */
const NO_RECORDS = "_No records yet._";

/** A tag-index line: the tag in backticks, then its meaning. */
const TAG_LINE =
  /^[*+-] `(?<tag>[^`]+)`(?:[\t ]+[–—-][\t ]+(?<meaning>.*\S))?[\t ]*$/u;

/**
 * Find where an index differs from what `syncIndex` would write: each
 * missing record, each stale line, and in each run the first line that
 * sorts before the line above it; or why it can't be synced.
 */
export function findIndexDrift(
  params: SyncIndexParams
): { drift: IndexDrift[]; isOk: true } | { isOk: false; problem: string } {
  const read = readIndex(params);

  if (!read.isOk) {
    return read;
  }

  const { bodyStart, pieces } = read;
  const body = params.text.slice(bodyStart);
  const headLines = params.text.slice(0, bodyStart).split("\n").length - 1;
  const toLine = (offset: number): number =>
    headLines + body.slice(0, offset).split("\n").length;

  const drift = pieces.flatMap((piece) => {
    if (piece.kind !== "run") {
      return [];
    }

    // The line that sorts before the one above it is the one that moved, so
    // it's the one named; a missing record is reported as missing instead,
    // and a record linked twice stays where okf index leaves it.
    let above: IndexRecord | undefined;
    let firstOut: RecordItem | undefined;

    for (const item of piece.items.filter(({ read }) => read !== undefined)) {
      if (
        firstOut === undefined &&
        above !== undefined &&
        above.path !== item.record.path &&
        compareRecords(above, item.record) > 0
      ) {
        firstOut = item;
      }

      above = item.record;
    }

    return piece.items.flatMap((item): IndexDrift[] => {
      const recordPath = item.record.path;

      if (item.read === undefined) {
        return [{ kind: "missing", line: undefined, recordPath }];
      }

      const line = toLine(item.read.offset);

      return [
        ...(writeItemLine(item) === item.read.line.content
          ? []
          : [{ kind: "stale" as const, line, recordPath }]),
        ...(item === firstOut
          ? [{ kind: "order" as const, line, recordPath }]
          : []),
      ];
    });
  });

  return { drift, isOk: true };
}

/**
 * Rewrite one index from its records' frontmatter.
 *
 * - Each record line is rewritten from the record it links to: its title,
 *   escaped as link text, then the separator the line already uses, then the
 *   description on one line.
 *
 * - A line linking to a Markdown file in the index's folder that no longer
 *   exists is dropped, since its record was removed.
 *
 * - A scoped record no line links to joins the first run of record lines, or
 *   a new list under the first heading, or at the end with none.
 *
 * - The tag index, when both markers are there, lists each tag with the
 *   meaning already written beside it, then its records; malformed markers
 *   refuse the whole index.
 */
export function syncIndex(params: SyncIndexParams): IndexSync {
  const read = readIndex(params);

  if (!read.isOk) {
    return read;
  }

  const { bodyStart, lineBreak, pieces } = read;
  const { text } = params;
  const head = text.slice(0, bodyStart);
  const written = writePieces({ lineBreak, pieces });

  // A closing fence that ends the file needs a line break before a line.
  const joint = written !== "" && head.endsWith("---") ? lineBreak : "";

  return { isOk: true, text: `${head}${joint}${written}` };
}

/**
 * Add each scoped record no line links to: to the first run, or as a new run
 * under the first heading, or at the end of the body with none.
 *
 * - Any list line linking to it counts, nested, numbered, or spelled in
 *   another case as a case-insensitive disk takes it, so no record is listed
 *   twice.
 */
function addMissingRecords(params: {
  indexPath: string;
  lineBreak: string;
  linked: ReadonlySet<string>;
  pieces: BodyPiece[];
  scoped: readonly IndexRecord[];
}): void {
  const { indexPath, lineBreak, linked, pieces, scoped } = params;
  const runs = pieces.filter((piece) => piece.kind === "run");
  const missing = scoped.filter(
    (record) => !linked.has(record.path.toLowerCase())
  );

  if (missing.length === 0) {
    return;
  }

  const style = runs[0]?.items[0] ?? DEFAULT_STYLE;
  const items = missing.map((record) => ({
    bullet: style.bullet,
    children: [],
    indent: style.indent,
    read: undefined,
    record,
    separator: style.separator,
    target: toTarget({ indexPath, recordPath: record.path }),
  }));

  const [firstRun] = runs;

  if (firstRun !== undefined) {
    firstRun.items.push(...items);

    return;
  }

  const run: BodyPiece = { ending: lineBreak, items, kind: "run" };
  const blank: BodyPiece = {
    kind: "line",
    line: { content: "", ending: lineBreak },
  };
  const heading = pieces.findIndex(
    (piece) => piece.kind === "line" && HEADING_LINE.test(piece.line.content)
  );

  if (heading !== -1) {
    const next = pieces[heading + 1];
    const isNextBlank = next?.kind === "line" && next.line.content === "";
    const isLast = next === undefined;

    pieces.splice(
      heading + 1,
      0,
      blank,
      run,
      ...(isNextBlank || isLast ? [] : [blank])
    );
    endWithLineBreak({ lineBreak, piece: pieces[heading] });

    return;
  }

  const last = pieces.at(-1);

  if (last !== undefined) {
    endWithLineBreak({ lineBreak, piece: last });

    if (!(last.kind === "line" && last.line.content === "")) {
      pieces.push(blank);
    }
  }

  pieces.push(run);
}

/** Order two records by title, ignoring case, then by path. */
function compareRecords(left: IndexRecord, right: IndexRecord): number {
  const leftLabel = readLabel(left).toLowerCase();
  const rightLabel = readLabel(right).toLowerCase();

  if (leftLabel !== rightLabel) {
    return leftLabel < rightLabel ? -1 : 1;
  }

  return left.path < right.path ? -1 : 1;
}

/** Give a line that ends the file a line break, so a line can follow it. */
function endWithLineBreak(params: {
  lineBreak: string;
  piece: BodyPiece | undefined;
}): void {
  const { lineBreak, piece } = params;

  // Only a line can end the body here: a run, had there been one, took the
  // new records instead.
  if (piece?.kind === "line" && piece.line.ending === "") {
    piece.line.ending = lineBreak;
  }
}

/** Escape link text, so `[`, `]`, and `\` in a title can't end the link. */
function escapeLabel(title: string): string {
  return title.replaceAll(/[[\\\]]/gu, String.raw`\$&`);
}

/**
 * List every path a list line links to, folded to lower case, outside fenced
 * code and the tag index: top-level or nested, bulleted or numbered.
 */
function listLinkedKeys(params: {
  doesExist: (filePath: string) => boolean;
  indexDir: string;
  masked: string;
  records: readonly IndexRecord[];
  region: { end: number; start: number } | undefined;
}): Set<string> {
  const { doesExist, indexDir, masked, region } = params;
  const recordPaths = new Set(params.records.map((record) => record.path));
  const outside =
    region === undefined
      ? masked
      : `${masked.slice(0, region.start)}${masked.slice(region.end)}`;
  const keys = new Set<string>();

  for (const { content } of splitLines(outside)) {
    const target = LINKED_LINE.exec(content)?.groups?.target;
    const linkedPath =
      target === undefined ? undefined : resolveTarget({ indexDir, target });

    // A link to nothing on disk, in any case, lists no record: its line is
    // dropped as gone.
    if (
      linkedPath !== undefined &&
      (recordPaths.has(linkedPath) || doesExist(linkedPath))
    ) {
      keys.add(linkedPath.toLowerCase());
    }
  }

  return keys;
}

/**
 * Read an index into pieces, with each scoped record no line links to
 * added, or say why it can't be synced.
 */
function readIndex(params: SyncIndexParams):
  | {
      bodyStart: number;
      isOk: true;
      lineBreak: string;
      pieces: BodyPiece[];
    }
  | { isOk: false; problem: string } {
  const { indexPath, text } = params;
  const bodyStart = findBodyStart(text);
  const body = text.slice(bodyStart);
  const lineBreak = /^[^\n]*\r\n/u.test(text) ? "\r\n" : "\n";

  // Marker lines quoted in fenced code, such as a README's example, aren't
  // the tag index's own.
  const masked = maskFences(body);
  const region = findMarkedBlock({
    endMarker: TAG_INDEX_END,
    startMarker: TAG_INDEX_START,
    text: masked,
  });

  if (region.kind === "malformed") {
    return { isOk: false, problem: region.problem };
  }

  const pieces = readPieces({
    ...params,
    body,
    indexDir: path.posix.dirname(indexPath),
    lineBreak,
    masked,
    region: region.kind === "found" ? region : undefined,
  });

  addMissingRecords({
    ...params,
    lineBreak,
    linked: listLinkedKeys({
      ...params,
      indexDir: path.posix.dirname(indexPath),
      masked,
      region: region.kind === "found" ? region : undefined,
    }),
    pieces,
  });

  return { bodyStart, isOk: true, lineBreak, pieces };
}

/**
 * Read a line as a record line: a top-level list item opening with a link to
 * a record, or to a Markdown file in the index's folder that's gone.
 *
 * @returns the item, with no record for a gone one, or `undefined` for any
 * other line.
 */
function readItem(params: {
  byPath: ReadonlyMap<string, IndexRecord>;
  doesExist: (filePath: string) => boolean;
  indexDir: string;
  line: BodyLine;
}):
  | ({
      record: IndexRecord | undefined;
    } & Omit<RecordItem, "children" | "read" | "record">)
  | undefined {
  const { byPath, doesExist, indexDir, line } = params;
  const groups = ITEM_LINE.exec(line.content)?.groups;

  if (groups === undefined) {
    return undefined;
  }

  // Every group is in the pattern, so a match has each one.
  const { bullet, indent, rest, target } = groups as ItemGroups;
  const linkedPath = resolveTarget({ indexDir, target });

  if (linkedPath === undefined) {
    return undefined;
  }

  const record = byPath.get(linkedPath);
  const folder = indexDir === "." ? "" : `${indexDir}/`;
  const isGone =
    record === undefined &&
    linkedPath.startsWith(folder) &&
    linkedPath.endsWith(".md") &&
    !doesExist(linkedPath);

  if (record === undefined && !isGone) {
    return undefined;
  }

  return {
    bullet,
    indent,
    record,
    separator: SEPARATOR.exec(rest)?.[0] ?? DEFAULT_STYLE.separator,
    target,
  };
}

/** The text a record is listed and sorted by: its title, or its file name. */
function readLabel(record: IndexRecord): string {
  // A title written over lines, such as a block scalar, must stay one line.
  return (record.title ?? path.posix.basename(record.path, ".md"))
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * Read the body into pieces: lines kept as written, runs of record lines,
 * and the tag index rewritten.
 */
function readPieces(params: {
  body: string;
  doesExist: (filePath: string) => boolean;
  indexDir: string;
  indexPath: string;
  lineBreak: string;
  masked: string;
  records: readonly IndexRecord[];
  region: { end: number; start: number } | undefined;
  scoped: readonly IndexRecord[];
}): BodyPiece[] {
  const { body, masked, region } = params;
  const byPath = new Map(params.records.map((record) => [record.path, record]));
  const pieces: BodyPiece[] = [];
  const queue = splitLines(body);
  let offset = 0;

  for (let line = queue.shift(); line !== undefined; line = queue.shift()) {
    const lineStart = offset;

    offset += line.content.length + line.ending.length;

    if (lineStart === region?.start) {
      const regionText = body.slice(region.start, region.end);
      const regionLines = splitLines(regionText);

      // This line opens the tag index; the rest of it is next in the queue.
      queue.splice(0, regionLines.length - 1);
      offset = region.end;
      pieces.push({
        kind: "raw",
        text: writeTagIndex({
          ...params,
          // The end marker's line break, or none when it ends the file.
          ending: /\r?\n$/u.exec(regionText)?.[0] ?? "",
          regionLines,
        }),
      });
      continue;
    }

    // Fenced code is written as is, so no heading in it takes a new list.
    // The fences were found once over every line, a child's included.
    const masking = masked.slice(lineStart, lineStart + line.content.length);

    if (masking !== line.content) {
      pieces.push({ kind: "raw", text: `${line.content}${line.ending}` });
      continue;
    }

    const item = readItem({ ...params, byPath, line });

    if (item === undefined) {
      pieces.push({ kind: "line", line });
      continue;
    }

    const children = takeChildren({ indent: item.indent, queue });

    for (const child of children) {
      offset += child.content.length + child.ending.length;
    }

    // A gone record's line goes, but what's written under it is the
    // person's own, so a line with any is kept as it is.
    if (item.record === undefined && children.length > 0) {
      pieces.push(
        { kind: "line", line },
        ...children.map((child) => ({ kind: "line" as const, line: child }))
      );
      continue;
    }

    const last = pieces.at(-1);
    const run: Extract<BodyPiece, { kind: "run" }> =
      last?.kind === "run" ? last : { ending: "", items: [], kind: "run" };

    if (run !== last) {
      pieces.push(run);
    }

    run.ending = (children.at(-1) ?? line).ending;

    if (item.record !== undefined) {
      run.items.push({
        ...item,
        children,
        read: { line, offset: lineStart },
        record: item.record,
      });
    }
  }

  // A run whose every line was dropped writes nothing, and keeps no ending.
  return pieces.filter((piece) => piece.kind !== "run" || piece.items.length);
}

/**
 * Resolve a link target to a path from the repo root, or `undefined` for one
 * that names no file in the repo: a URL, an absolute path, a bare fragment,
 * or one that climbs out of it.
 */
function resolveTarget(params: {
  indexDir: string;
  target: string;
}): string | undefined {
  const { indexDir } = params;
  const target = params.target.replace(/^<(?<inner>.*)>$/u, "$<inner>");
  const filePart = target.replace(/[#?].*$/u, "");

  if (filePart === "" || filePart.startsWith("/") || hasScheme(filePart)) {
    return undefined;
  }

  let decoded: string;

  try {
    decoded = decodeURIComponent(filePart);
  } catch {
    decoded = filePart;
  }

  const resolved = path.posix.normalize(path.posix.join(indexDir, decoded));

  return resolved === ".." || resolved.startsWith("../") ? undefined : resolved;
}

/** Sort records by title, ignoring case, then by path. */
function sortRecords<T>(params: {
  items: readonly T[];
  toRecord: (item: T) => IndexRecord;
}): T[] {
  const { items, toRecord } = params;

  return [...items].sort((left, right) =>
    compareRecords(toRecord(left), toRecord(right))
  );
}

/**
 * Take the lines indented under a record line off the queue: they belong to
 * it, and move with it when the run is sorted.
 */
function takeChildren(params: {
  indent: string;
  queue: BodyLine[];
}): BodyLine[] {
  const { indent, queue } = params;
  const children: BodyLine[] = [];

  for (let next = queue[0]; next !== undefined; next = queue[0]) {
    const { content } = next;

    if (
      content.trim() === "" ||
      content.length - content.trimStart().length <= indent.length
    ) {
      break;
    }

    children.push(next);
    queue.shift();
  }

  return children;
}

/**
 * Write a link target for a record, relative to the index, in angle brackets
 * when it holds a space or a bracket a bare target can't.
 */
function toTarget(params: { indexPath: string; recordPath: string }): string {
  const { indexPath, recordPath } = params;
  // A target is read back percent-decoded and cut at `#` or `?`, so those
  // three are encoded for it to resolve to the record again.
  const target = path.posix
    .relative(path.posix.dirname(indexPath), recordPath)
    .replaceAll("%", "%25")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F");

  return /[\s()<>]/u.test(target) ? `<${target}>` : target;
}

/** Write a record's line from its frontmatter, in the line's own style. */
function writeItemLine(item: RecordItem): string {
  const { bullet, indent, record, separator, target } = item;
  const description = record.description?.replaceAll(/\s+/gu, " ").trim();
  const link = `${indent}${bullet} [${escapeLabel(readLabel(record))}](${target})`;

  return description === undefined || description === ""
    ? link
    : `${link}${separator}${description}`;
}

/**
 * Write the body back: each run sorted and rewritten, every other piece as
 * it was.
 */
function writePieces(params: {
  lineBreak: string;
  pieces: readonly BodyPiece[];
}): string {
  const { lineBreak, pieces } = params;

  return pieces
    .map((piece) => {
      if (piece.kind === "line") {
        return `${piece.line.content}${piece.line.ending}`;
      }

      if (piece.kind === "raw") {
        return piece.text;
      }

      const lines = sortRecords({
        items: piece.items,
        toRecord: (item) => item.record,
      }).flatMap((item) => [
        writeItemLine(item),
        ...item.children.map((child) => child.content),
      ]);

      return `${lines.join(lineBreak)}${piece.ending}`;
    })
    .join("");
}

/**
 * Write the tag index: each tag, sorted, with the meaning already written
 * beside it, then a link to each scoped record that carries it.
 *
 * - A tag the index already lists stays, with a placeholder line, once no
 *   record carries it, so the vocabulary never loses a tag silently.
 */
function writeTagIndex(params: {
  ending: string;
  indexPath: string;
  lineBreak: string;
  regionLines: readonly BodyLine[];
  scoped: readonly IndexRecord[];
}): string {
  const { ending, indexPath, lineBreak, regionLines, scoped } = params;
  const meanings = new Map<string, string | undefined>();

  for (const { content } of regionLines) {
    const groups = TAG_LINE.exec(content)?.groups;

    if (groups !== undefined) {
      // The tag is always captured; the meaning only when it's written.
      const { meaning, tag } = groups as {
        meaning: string | undefined;
        tag: string;
      };

      meanings.set(tag, meaning);
    }
  }

  for (const record of scoped) {
    for (const tag of record.tags) {
      if (!meanings.has(tag)) {
        meanings.set(tag, undefined);
      }
    }
  }

  const lines = [...meanings.keys()]
    .sort((left, right) => (left < right ? -1 : 1))
    .flatMap((tag) => {
      const meaning = meanings.get(tag);
      const records = sortRecords({
        items: scoped.filter((record) => record.tags.includes(tag)),
        toRecord: (record) => record,
      });

      return [
        `- \`${tag}\`${meaning === undefined ? "" : ` — ${meaning}`}`,
        ...(records.length === 0
          ? [`  - ${NO_RECORDS}`]
          : records.map(
              (record) =>
                `  - [${escapeLabel(readLabel(record))}](${toTarget({ indexPath, recordPath: record.path })})`
            )),
      ];
    });

  const inner = lines.length === 0 ? [] : ["", ...lines, ""];

  return `${[TAG_INDEX_START, ...inner, TAG_INDEX_END].join(lineBreak)}${ending}`;
}
