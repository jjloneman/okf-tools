/*
 * Reading a record's Markdown body by position: its lines, where it starts,
 * and which of it is code, so a command that rewrites links or lines never
 * touches text quoted in code.
 *
 * - Masking keeps every offset, so a position found in the masked text is the
 *   same position in the original.
 */
import { splitFrontmatter } from "./frontmatter/shared.ts";

/** A line of a body, apart from its line break. */
export type BodyLine = {
  /**
   * The line without its line break.
   *
   * @example "- [A](a.md) - The first."
   */
  content: string;

  /**
   * Its line break: `\n`, `\r\n`, or empty for a last line without one.
   *
   * @example `"\n"`
   */
  ending: string;
};

/** A byte order mark, which belongs to the file and not its first line. */
const BYTE_ORDER_MARK = "﻿";

/** A code fence's opening line: three or more backticks or tildes. */
const FENCE_LINE = /^ {0,3}(?<fence>`{3,}|~{3,})/u;

/** A run of backticks, which opens or closes an inline code span. */
const BACKTICKS = /`+/gu;

/** A link target with a scheme, such as `https:` or `mailto:`. */
const SCHEME = /^[a-z][\d+.a-z-]*:/iu;

/**
 * Find where the body starts: past the frontmatter's closing fence line, or
 * past a byte order mark, which belongs to the file and not its first line.
 */
export function findBodyStart(text: string): number {
  const block = splitFrontmatter(text);

  if (block === undefined) {
    return text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;
  }

  const fenceEnd = text.indexOf("\n", block.end);

  return fenceEnd === -1 ? text.length : fenceEnd + 1;
}

/** Whether a link target opens with a scheme, such as `https:`. */
export function hasScheme(target: string): boolean {
  return SCHEME.test(target);
}

/**
 * Blank out fenced code and inline code spans, keeping every offset, so
 * nothing quoted in code is read as the body's own.
 *
 * - An inline span closes at the next run of as many backticks on the same
 *   line; one with no closing run is plain text, as CommonMark reads it.
 */
export function maskCode(body: string): string {
  return splitLines(maskFences(body))
    .map((line) => `${maskInlineCode(line.content)}${line.ending}`)
    .join("");
}

/**
 * Blank out the lines of fenced code, keeping every offset, so nothing
 * quoted in it is read as the body's own.
 */
export function maskFences(body: string): string {
  let fence: string | undefined;

  return splitLines(body)
    .map((line) => {
      const fenceMark = FENCE_LINE.exec(line.content)?.groups?.fence;
      const isFenced = fence !== undefined || fenceMark !== undefined;

      fence = trackFence({ fence, fenceMark, line });

      return `${isFenced ? " ".repeat(line.content.length) : line.content}${line.ending}`;
    })
    .join("");
}

/** Split text into lines, each with its own line break. */
export function splitLines(text: string): BodyLine[] {
  if (text === "") {
    return [];
  }

  return text.split(/(?<=\n)/u).map((line) => {
    const ending = /\r?\n$/u.exec(line)?.[0] ?? "";

    return { content: line.slice(0, line.length - ending.length), ending };
  });
}

/** Blank out the inline code spans on one line, keeping every offset. */
function maskInlineCode(content: string): string {
  const runs = [...content.matchAll(BACKTICKS)];
  let masked = content;

  for (let open = 0; open < runs.length; open += 1) {
    const opening = runs[open];
    const closeAt = runs.findIndex(
      (run, index) => index > open && run[0].length === opening?.[0].length
    );
    const closing = runs[closeAt];

    if (opening !== undefined && closing !== undefined) {
      const end = closing.index + closing[0].length;

      masked = `${masked.slice(0, opening.index)}${" ".repeat(end - opening.index)}${masked.slice(end)}`;
      open = closeAt;
    }
  }

  return masked;
}

/**
 * Follow fenced code, so a line inside it is never read as the body's own.
 *
 * @returns the open fence after this line, or `undefined` once it closes.
 */
function trackFence(params: {
  fence: string | undefined;
  fenceMark: string | undefined;
  line: BodyLine;
}): string | undefined {
  const { fence, fenceMark, line } = params;

  if (fence === undefined) {
    return fenceMark;
  }

  // A closing fence is the same character, at least as long, alone.
  const isClosing =
    fenceMark?.startsWith(fence.charAt(0)) === true &&
    fenceMark.length >= fence.length &&
    line.content.trim() === fenceMark;

  return isClosing ? undefined : fence;
}
