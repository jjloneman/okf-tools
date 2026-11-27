import { describe, expect, test } from "vitest";

import { readArray, readPath } from "./json.ts";

describe("readArray", () => {
  test.each([
    { description: "a list", expected: [1, "a"], value: [1, "a"] },
    { description: "an object", expected: [], value: { a: 1 } },
    { description: "nothing", expected: [], value: undefined },
  ])("reads $description", ({ expected, value }) => {
    // When/Then - the list, or an empty one
    expect(readArray(value)).toStrictEqual(expected);
  });
});

describe("readPath", () => {
  test.each([
    {
      description: "a nested field",
      expected: "4c2a",
      keys: ["head", "sha"],
      value: { head: { sha: "4c2a" } },
    },
    {
      description: "a missing step",
      expected: undefined,
      keys: ["head", "sha"],
      value: { base: {} },
    },
    {
      description: "a step through a list",
      expected: undefined,
      keys: ["0"],
      value: ["a"],
    },
    {
      description: "a step through null",
      expected: undefined,
      keys: ["head", "sha"],
      value: { head: null },
    },
  ])("reads $description", ({ expected, keys, value }) => {
    // When/Then - the field, or nothing
    expect(readPath({ keys, value })).toStrictEqual(expected);
  });
});
