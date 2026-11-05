import { describe, expect, test } from "vitest";

import { lineAt } from "./lines.ts";

describe("lineAt", () => {
  test.each([
    { description: "a line in range", expected: "b", index: 1 },
    { description: "an index past the end", expected: "", index: 2 },
    { description: "a negative index", expected: "", index: -1 },
  ])("reads $description", ({ expected, index }) => {
    // When/Then - the line, or an empty string
    expect(lineAt({ index, lines: ["a", "b"] })).toBe(expected);
  });
});
