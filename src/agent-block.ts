/*
 * The block of agent instructions `okf init` keeps in a repo's instruction
 * files, and the pure logic that finds and rewrites it.
 *
 * - The block sits between two marker lines, and only the text between them
 *   is ever rewritten; everything else in the file is kept as written.
 *
 * - A marker is a whole line, with no indent, so a marker quoted in an
 *   indented code block is never taken for one.
 */

import { RECORD_RULES, RECORDS_INTRO } from "./guide.ts";

/** Where a file's block is, or why the file has none that can be rewritten. */
export type BlockSearch =
  | {
      /**
       * The file has neither marker.
       *
       * @example "absent"
       */
      kind: "absent";
    }
  | {
      /**
       * The markers can't bound one block.
       *
       * @example "malformed"
       */
      kind: "malformed";

      /**
       * Why, naming the markers by name, without the file's name.
       *
       * @example "has an okf:start marker but no okf:end"
       */
      problem: string;
    }
  | {
      /**
       * The offset just past the end marker's line, its line break included
       * when it has one.
       *
       * @example 812
       */
      end: number;

      /**
       * Both markers, once each, the start first.
       *
       * @example "found"
       */
      kind: "found";

      /**
       * The offset where the start marker's line begins.
       *
       * @example 120
       */
      start: number;
    };

/** A file's text with the block written in, or why it can't be. */
export type BlockUpdate =
  | {
      /**
       * Whether the block could be written; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not, without the file's name.
       *
       * @example "has 2 okf:start markers"
       */
      problem: string;
    }
  | {
      /**
       * Whether the block could be written; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The file's text with the current block in it, the same as the input
       * when it was already up to date.
       *
       * @example `"# Agents\n\n<!-- okf:start -->\n…\n<!-- okf:end -->\n"`
       */
      text: string;
    };

/** The line that opens the block. */
export const BLOCK_START = "<!-- okf:start -->";

/** The line that closes the block. */
export const BLOCK_END = "<!-- okf:end -->";

/**
 * The lines between the markers, with `\n` line breaks.
 *
 * - The intro and the rules come from `guide.ts`, which `okf guide` prints
 *   too, and the README's Agents section quotes the block, with a test
 *   keeping the two the same, so the rules are written once.
 *
 * - Prettier leaves them as they are, so a formatted repo still passes
 *   `okf init --check`.
 */
export const AGENT_BLOCK: string = [
  "<!-- Written by `okf init` from @jjloneman/okf-tools. Run it again to refresh this block, and keep the repo's own rules outside it. -->",
  "## OKF records",
  RECORDS_INTRO,
  RECORD_RULES,
  "Run `okf guide` through the repo's package manager, such as `pnpm exec okf guide`, for every okf-tools command and when you may run each, printed from the installed version.",
].join("\n\n");

/** The whole block, markers included, with `\n` line breaks. */
const FULL_BLOCK = `${BLOCK_START}\n${AGENT_BLOCK}\n\n${BLOCK_END}`;

/**
 * Find the block in a file's text.
 *
 * - Each marker must appear once, the start before the end; anything else is
 *   malformed, so a hand edit is never guessed at.
 */
export function findBlock(text: string): BlockSearch {
  const starts = findMarkerLines({ marker: BLOCK_START, text });
  const ends = findMarkerLines({ marker: BLOCK_END, text });
  const [start] = starts;
  const [end] = ends;

  if (start === undefined && end === undefined) {
    return { kind: "absent" };
  }

  if (starts.length > 1) {
    return {
      kind: "malformed",
      problem: `has ${starts.length} okf:start markers`,
    };
  }

  if (ends.length > 1) {
    return {
      kind: "malformed",
      problem: `has ${ends.length} okf:end markers`,
    };
  }

  if (start === undefined) {
    return {
      kind: "malformed",
      problem: "has an okf:end marker but no okf:start",
    };
  }

  if (end === undefined) {
    return {
      kind: "malformed",
      problem: "has an okf:start marker but no okf:end",
    };
  }

  if (end.start < start.start) {
    return {
      kind: "malformed",
      problem: "has its okf:end marker before okf:start",
    };
  }

  return { end: end.end, kind: "found", start: start.start };
}

/**
 * Write the current block into a file's text.
 *
 * - An existing block is replaced in place; a file with none gets it at the
 *   end, after a blank line; an empty file gets the block alone.
 *
 * - The block takes the file's line breaks: CRLF when its first line break
 *   is one, else LF.
 */
export function writeBlock(text: string): BlockUpdate {
  const search = findBlock(text);

  if (search.kind === "malformed") {
    return { isOk: false, problem: search.problem };
  }

  const lineBreak = /^[^\n]*\r\n/u.test(text) ? "\r\n" : "\n";
  const block = FULL_BLOCK.replaceAll("\n", lineBreak);

  if (search.kind === "found") {
    const before = text.slice(0, search.start);
    const after = text.slice(search.end);
    const hasLineBreak = /\r?\n$/u.test(text.slice(search.start, search.end));

    return {
      isOk: true,
      text: `${before}${block}${hasLineBreak ? lineBreak : ""}${after}`,
    };
  }

  // `trim` drops a byte order mark too, so keep one the file had.
  if (text.trim() === "") {
    const mark = text.startsWith("\uFEFF") ? "\uFEFF" : "";

    return { isOk: true, text: `${mark}${block}${lineBreak}` };
  }

  const separator = /\r?\n$/u.test(text)
    ? lineBreak
    : `${lineBreak}${lineBreak}`;

  return {
    isOk: true,
    text: `${text}${/(?:\r?\n){2}$/u.test(text) ? "" : separator}${block}${lineBreak}`,
  };
}

/**
 * Find every line that is exactly a marker, allowing trailing whitespace and
 * a CR before its line break.
 *
 * @returns each line's start offset, and the offset past its line break.
 */
function findMarkerLines(params: {
  /**
   * The marker the line must hold.
   *
   * @example `"<!-- okf:start -->"`
   */
  marker: string;

  /**
   * The file's text.
   *
   * @example `"<!-- okf:start -->\n…"`
   */
  text: string;
}): { end: number; start: number }[] {
  const { marker, text } = params;
  const lines: { end: number; start: number }[] = [];
  let start = 0;

  while (start <= text.length) {
    const lineBreak = text.indexOf("\n", start);
    const end = lineBreak === -1 ? text.length : lineBreak + 1;

    // A byte order mark belongs to the file, not to its first line.
    const lineStart = start === 0 && text.startsWith("\uFEFF") ? 1 : start;

    if (text.slice(lineStart, end).trimEnd() === marker) {
      lines.push({ end, start: lineStart });
    }

    if (lineBreak === -1) {
      break;
    }

    start = end;
  }

  return lines;
}
