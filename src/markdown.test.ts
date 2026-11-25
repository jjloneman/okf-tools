import { describe, expect, test } from "vitest";

import {
  findBodyStart,
  hasScheme,
  maskCode,
  maskFences,
  splitLines,
} from "./markdown.ts";

describe("findBodyStart", () => {
  test.each([
    {
      description: "past the frontmatter's closing fence line",
      expected: 17,
      text: "---\ntitle: A\n---\n# A\n",
    },
    {
      description: "at the end of a closing fence with no line break",
      expected: 16,
      text: "---\ntitle: A\n---",
    },
    {
      description: "at the start of a file with no frontmatter",
      expected: 0,
      text: "# A\n",
    },
    {
      description: "past a byte order mark with no frontmatter",
      expected: 1,
      text: "﻿# A\n",
    },
  ])("finds the body $description", ({ expected, text }) => {
    // Given/When/Then - where the body starts
    expect(findBodyStart(text)).toBe(expected);
  });
});

describe("hasScheme", () => {
  test.each([
    { description: "https", isScheme: true, target: "https://example.com" },
    { description: "mailto", isScheme: true, target: "mailto:a@example.com" },
    { description: "a relative path", isScheme: false, target: "a/b.md" },
    { description: "a fragment", isScheme: false, target: "#heading" },
    { description: "a leading digit", isScheme: false, target: "1x:y" },
  ])("reads $description", ({ isScheme, target }) => {
    // Given/When/Then - whether it opens with a scheme
    expect(hasScheme(target)).toBe(isScheme);
  });
});

describe("maskCode", () => {
  test.each([
    {
      body: "See `a.md` and [B](b.md).\n",
      description: "an inline code span",
      expected: "See        and [B](b.md).\n",
    },
    {
      body: "``a ` b`` then `c`\n",
      description: "spans of different lengths, one holding a backtick",
      expected: "          then    \n",
    },
    {
      body: "a ``b` c\n",
      description: "a run with no closing run, as plain text",
      expected: "a ``b` c\n",
    },
    {
      body: "`a\nb`\n",
      description: "a span that would close on the next line",
      expected: "`a\nb`\n",
    },
    {
      body: "```\n[A](a.md)\n```\n[B](b.md)\r\n",
      description: "fenced code, with every offset kept",
      expected: "   \n         \n   \n[B](b.md)\r\n",
    },
    { body: "", description: "an empty body", expected: "" },
  ])("blanks out $description", ({ body, expected }) => {
    // Given/When - masking the code
    const masked = maskCode(body);

    // Then - the code blanked, at the same length
    expect(masked).toBe(expected);
    expect(masked).toHaveLength(body.length);
  });
});

describe("maskFences", () => {
  test.each([
    {
      body: "~~~~\n```\nx\n~~~~\nafter\n",
      description: "a fence closed only by its own mark",
      expected: "    \n   \n \n    \nafter\n",
    },
    {
      body: "```\nx\n``\ny\n",
      description: "a fence a shorter mark doesn't close",
      expected: "   \n \n  \n \n",
    },
    {
      body: "`a` b\n",
      description: "nothing outside a fence",
      expected: "`a` b\n",
    },
  ])("masks $description", ({ body, expected }) => {
    // Given/When/Then - only the fenced lines blanked
    expect(maskFences(body)).toBe(expected);
  });
});

describe("splitLines", () => {
  test.each([
    { description: "empty text", expected: [], text: "" },
    {
      description: "mixed line breaks and a last line without one",
      expected: [
        { content: "a", ending: "\n" },
        { content: "b", ending: "\r\n" },
        { content: "c", ending: "" },
      ],
      text: "a\nb\r\nc",
    },
  ])("splits $description", ({ expected, text }) => {
    // Given/When/Then - each line with its own line break
    expect(splitLines(text)).toStrictEqual(expected);
  });
});
