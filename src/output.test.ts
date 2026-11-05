import { afterEach, describe, expect, test, vi } from "vitest";

import { describeError, formatLines, printError, printInfo } from "./output.ts";

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
    const formatted = formatLines(message);

    // Then - each line prefixed, the blank one with no trailing space
    expect(formatted).toBe(
      "[okf-verify] first\n[okf-verify]\n[okf-verify] second"
    );
  });
});

describe("printError and printInfo", () => {
  test("print to stderr and stdout", () => {
    // Given - spies on the console
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);

    // When - printing one of each
    printError("bad");
    printInfo("good");

    // Then - each reaches its stream, prefixed
    expect(error).toHaveBeenCalledWith("[okf-verify] bad");
    expect(info).toHaveBeenCalledWith("[okf-verify] good");
  });
});
