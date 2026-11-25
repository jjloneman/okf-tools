import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createOutput,
  describeError,
  formatLines,
  toTerminalLine,
} from "./output.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeError", () => {
  test("reads an Error's message", () => {
    // Given/When/Then - an Error's message, as is
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  test("stringifies anything else thrown", () => {
    // Given/When/Then - a thrown string, as is
    expect(describeError("boom")).toBe("boom");
  });
});

describe("formatLines", () => {
  test("prefixes every line and drops trailing whitespace", () => {
    // Given - two lines around a blank one, with a trailing newline
    const message = "first\n\nsecond\n";

    // When - formatting it
    const formatted = formatLines({ message, prefix: "[okf]" });

    // Then - each line prefixed, the blank one with no trailing space
    expect(formatted).toBe("[okf] first\n[okf]\n[okf] second");
  });
});

describe("createOutput", () => {
  test.each([
    { prefix: "[okf]", program: "okf" },
    { prefix: "[okf-verify]", program: "okf-verify" },
  ] as const)(
    "prints to stderr and stdout under $prefix",
    ({ prefix, program }) => {
      // Given - spies on the console, and the program's output
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const output = createOutput(program);

      // When - printing one of each
      output.error("bad");
      output.info("good");

      // Then - each reaches its stream, prefixed with the program's name
      expect(error).toHaveBeenCalledWith(`${prefix} bad`);
      expect(info).toHaveBeenCalledWith(`${prefix} good`);
    }
  );

  test("prints data to stdout as it is, with no prefix", () => {
    // Given - a spy on stdout, and okf's output
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const output = createOutput("okf");

    // When - printing JSON for a program to read
    output.data('{\n  "records": []\n}');

    // Then - it reaches stdout untouched, so it still parses
    expect(info).toHaveBeenCalledWith('{\n  "records": []\n}');
  });
});

describe("toTerminalLine", () => {
  test.each([
    { description: "plain text", expected: "cli", text: "cli" },
    {
      description: "line breaks and control codes",
      expected: "a b [2J c",
      text: "a\r\nb\u001b[2J\tc",
    },
    {
      description: "bidi marks and separators",
      expected: "a b c",
      text: "a\u202eb\u2028\u2029c",
    },
    { description: "a trailing control code", expected: "a", text: "a\n" },
  ])("makes $description one safe line", ({ expected, text }) => {
    // When/Then - each run of unsafe characters a space, none trailing
    expect(toTerminalLine(text)).toBe(expected);
  });
});
