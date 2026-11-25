import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import {
  AGENT_BLOCK,
  BLOCK_END,
  BLOCK_START,
  findBlock,
  writeBlock,
} from "./agent-block.ts";

/** The block as `writeBlock` writes it, with `\n` line breaks. */
const BLOCK = `${BLOCK_START}\n${AGENT_BLOCK}\n\n${BLOCK_END}`;

/** A block written by an older version, with other rules in it. */
const STALE_BLOCK = `${BLOCK_START}\n## OKF records\n\n- an old rule\n${BLOCK_END}`;

describe("findBlock", () => {
  test.each([
    { description: "an empty file", text: "" },
    { description: "a file with no markers", text: "# Agents\n" },
    {
      description: "an indented marker, as in a code block",
      text: `    ${BLOCK_START}\n    ${BLOCK_END}\n`,
    },
    {
      description: "a marker with text after it on its line",
      text: `${BLOCK_START} keep\n${BLOCK_END}!\n`,
    },
  ])("finds no block in $description", ({ text }) => {
    // When/Then - no block
    expect(findBlock(text)).toStrictEqual({ kind: "absent" });
  });

  test("finds the block's lines, its markers' line breaks included", () => {
    // Given - a block between two other lines, markers with trailing spaces
    const text = `# A\n${BLOCK_START}  \r\nbody\n${BLOCK_END}\t\nafter\n`;

    // When - finding the block
    const search = findBlock(text);

    // Then - it runs from the start marker's line to past the end's break
    expect(search).toStrictEqual({
      end: text.indexOf("after"),
      kind: "found",
      start: 4,
    });
  });

  test("finds a start marker after a byte order mark, and keeps the mark", () => {
    // Given - a file saved with a byte order mark
    const text = `\uFEFF${BLOCK_START}\nbody\n${BLOCK_END}\n`;

    // When - finding the block, and rewriting it
    const search = findBlock(text);
    const update = writeBlock(text);

    // Then - the block starts after the mark, which the rewrite keeps
    expect(search).toStrictEqual({ end: text.length, kind: "found", start: 1 });
    expect(update).toStrictEqual({ isOk: true, text: `\uFEFF${BLOCK}\n` });
  });

  test("finds a block that ends the file with no final line break", () => {
    // Given - the end marker on the last line
    const text = `${BLOCK_START}\nbody\n${BLOCK_END}`;

    // When/Then - the block runs to the end of the text
    expect(findBlock(text)).toStrictEqual({
      end: text.length,
      kind: "found",
      start: 0,
    });
  });

  test.each([
    {
      description: "two start markers",
      problem: "has 2 okf:start markers",
      text: `${BLOCK_START}\n${BLOCK_START}\n${BLOCK_END}\n`,
    },
    {
      description: "two end markers",
      problem: "has 2 okf:end markers",
      text: `${BLOCK_START}\n${BLOCK_END}\n${BLOCK_END}\n`,
    },
    {
      description: "an end marker alone",
      problem: "has an okf:end marker but no okf:start",
      text: `${BLOCK_END}\n`,
    },
    {
      description: "a start marker alone",
      problem: "has an okf:start marker but no okf:end",
      text: `${BLOCK_START}\n`,
    },
    {
      description: "the end before the start",
      problem: "has its okf:end marker before okf:start",
      text: `${BLOCK_END}\n${BLOCK_START}\n`,
    },
  ])("calls $description malformed", ({ problem, text }) => {
    // When/Then - malformed, saying why
    expect(findBlock(text)).toStrictEqual({ kind: "malformed", problem });
  });
});

describe("writeBlock", () => {
  test.each([
    {
      description: "an empty file",
      expected: `${BLOCK}\n`,
      text: "",
    },
    {
      description: "a file of blank lines",
      expected: `${BLOCK}\n`,
      text: "\n\n",
    },
    {
      description: "a file of a byte order mark and a blank line",
      expected: `\uFEFF${BLOCK}\n`,
      text: "\uFEFF\n",
    },
    {
      description: "a file ending in a line break",
      expected: `# Agents\n\n${BLOCK}\n`,
      text: "# Agents\n",
    },
    {
      description: "a file with no final line break",
      expected: `# Agents\n\n${BLOCK}\n`,
      text: "# Agents",
    },
    {
      description: "a file already ending in a blank line",
      expected: `# Agents\n\n${BLOCK}\n`,
      text: "# Agents\n\n",
    },
    {
      description: "a CRLF file",
      expected: `# Agents\r\n\r\n${BLOCK.replaceAll("\n", "\r\n")}\r\n`,
      text: "# Agents\r\n",
    },
  ])("appends the block to $description", ({ expected, text }) => {
    // When - writing the block
    const update = writeBlock(text);

    // Then - the text with the block after a blank line
    expect(update).toStrictEqual({ isOk: true, text: expected });
  });

  test.each([
    {
      description: "in the middle of the file",
      expected: `# A\n\n${BLOCK}\n\n# B\n`,
      text: `# A\n\n${STALE_BLOCK}\n\n# B\n`,
    },
    {
      description: "at the end, with no final line break",
      expected: `# A\n\n${BLOCK}`,
      text: `# A\n\n${STALE_BLOCK}`,
    },
    {
      description: "in a CRLF file",
      expected: `# A\r\n${BLOCK.replaceAll("\n", "\r\n")}\r\n# B\r\n`,
      text: `# A\r\n${STALE_BLOCK.replaceAll("\n", "\r\n")}\r\n# B\r\n`,
    },
  ])("replaces a stale block $description", ({ expected, text }) => {
    // When - writing the block
    const update = writeBlock(text);

    // Then - only the text between the markers changes
    expect(update).toStrictEqual({ isOk: true, text: expected });
  });

  test("leaves a current block as it is", () => {
    // Given - a file the block was written to
    const text = `# Agents\n\n${BLOCK}\n\n## Rules\n`;

    // When/Then - the same text back
    expect(writeBlock(text)).toStrictEqual({ isOk: true, text });
  });

  test("refuses malformed markers", () => {
    // Given - a start marker with no end
    const text = `# Agents\n${BLOCK_START}\n`;

    // When/Then - a refusal saying why
    expect(writeBlock(text)).toStrictEqual({
      isOk: false,
      problem: "has an okf:start marker but no okf:end",
    });
  });
});

describe("AGENT_BLOCK", () => {
  test("is what the README's Agents section quotes", () => {
    // Given - the README's quote of the block
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8"
    );

    const quote = /```md\n(?<body>[\s\S]*?)\n```\n/u.exec(
      readme.slice(readme.indexOf("## 🧭 Agents"))
    )?.groups?.body;

    // When/Then - the same text, so the rules are written once
    expect(quote).toBe(AGENT_BLOCK);
  });
});
