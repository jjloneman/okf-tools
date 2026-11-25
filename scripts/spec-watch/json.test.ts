import { describe, expect, test } from "vitest";

import {
  isJsonObject,
  readBoolean,
  readField,
  readNumber,
  readString,
} from "./json.ts";

describe("isJsonObject", () => {
  test.each([
    { description: "an object", isExpected: true, value: { a: 1 } },
    { description: "an array", isExpected: false, value: [1] },
    { description: "null", isExpected: false, value: null },
    { description: "a string", isExpected: false, value: "a" },
  ])("tells $description", ({ isExpected, value }) => {
    // Given - a parsed JSON value

    // When - checking it
    const isObject = isJsonObject(value);

    // Then - only a plain object counts
    expect(isObject).toBe(isExpected);
  });
});

describe("readBoolean", () => {
  test.each([
    {
      description: "a boolean field",
      isExpected: true,
      value: { archived: true },
    },
    {
      description: "a field of another type",
      isExpected: undefined,
      value: { archived: 1 },
    },
    {
      description: "a value that isn't an object",
      isExpected: undefined,
      value: [],
    },
  ])("reads $description", ({ isExpected, value }) => {
    // Given - a parsed JSON value

    // When - reading `archived`
    const isArchived = readBoolean({ key: "archived", value });

    // Then - the boolean, or undefined
    expect(isArchived).toBe(isExpected);
  });
});

describe("readField", () => {
  test.each([
    { description: "any field", expected: [1], value: { key: [1] } },
    {
      description: "a value that isn't an object",
      expected: undefined,
      value: "a",
    },
  ])("reads $description", ({ expected, value }) => {
    // Given - a parsed JSON value

    // When - reading `key`
    const field = readField({ key: "key", value });

    // Then - the field as it is, or undefined
    expect(field).toStrictEqual(expected);
  });
});

describe("readNumber", () => {
  test.each([
    { description: "a number field", expected: 12, value: { key: 12 } },
    {
      description: "a field of another type",
      expected: undefined,
      value: { key: "12" },
    },
    {
      description: "a value that isn't an object",
      expected: undefined,
      value: null,
    },
  ])("reads $description", ({ expected, value }) => {
    // Given - a parsed JSON value

    // When - reading `key`
    const field = readNumber({ key: "key", value });

    // Then - the number, or undefined
    expect(field).toBe(expected);
  });
});

describe("readString", () => {
  test.each([
    { description: "a string field", expected: "a", value: { key: "a" } },
    {
      description: "a field of another type",
      expected: undefined,
      value: { key: false },
    },
    {
      description: "a value that isn't an object",
      expected: undefined,
      value: 3,
    },
  ])("reads $description", ({ expected, value }) => {
    // Given - a parsed JSON value

    // When - reading `key`
    const field = readString({ key: "key", value });

    // Then - the string, or undefined
    expect(field).toBe(expected);
  });
});
