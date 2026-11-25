import { describe, expect, test } from "vitest";

import { PIN, PIN_SHA } from "#test/spec-watch";

import { isFullSha, isRepoName, parsePin } from "./pin.ts";

describe("isFullSha", () => {
  test.each([
    { description: "a full, lowercase SHA", isExpected: true, text: PIN_SHA },
    { description: "a short SHA", isExpected: false, text: "1111111" },
    {
      description: "an uppercase SHA",
      isExpected: false,
      text: "A".repeat(40),
    },
  ])("tells $description", ({ isExpected, text }) => {
    // Given - a text

    // When - checking it
    const isSha = isFullSha(text);

    // Then - only a full, lowercase SHA counts
    expect(isSha).toBe(isExpected);
  });
});

describe("isRepoName", () => {
  test.each([
    { description: "an owner and a name", isExpected: true, text: "acme/spec" },
    { description: "a name alone", isExpected: false, text: "spec" },
    { description: "an empty text", isExpected: false, text: "" },
  ])("tells $description", ({ isExpected, text }) => {
    // Given - a text

    // When - checking it
    const isRepo = isRepoName(text);

    // Then - only `<owner>/<name>` counts
    expect(isRepo).toBe(isExpected);
  });
});

describe("parsePin", () => {
  test("parses a valid pin", () => {
    // Given - a pin with every field
    const text = JSON.stringify(PIN);

    // When - parsing it
    const answer = parsePin(text);

    // Then - the pin
    expect(answer).toStrictEqual({ isOk: true, pin: PIN });
  });

  test("refuses a text that isn't JSON", () => {
    // Given - a broken text
    const text = "{";

    // When - parsing it
    const answer = parsePin(text);

    // Then - the parser's reason
    expect(answer).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^spec\/upstream\.json isn't JSON: /u
      ) as unknown,
    });
  });

  test.each([
    {
      description: "a value that isn't an object",
      reason: "spec/upstream.json isn't a JSON object",
      value: [PIN],
    },
    {
      description: "a repo that isn't <owner>/<name>",
      reason: "spec/upstream.json needs `repo` as `<owner>/<name>`",
      value: { ...PIN, repo: "spec" },
    },
    {
      description: "a repo that isn't a string",
      reason: "spec/upstream.json needs `repo` as `<owner>/<name>`",
      value: { ...PIN, repo: 1 },
    },
    {
      description: "an empty path",
      reason: "spec/upstream.json needs the spec's `path`",
      value: { ...PIN, path: "" },
    },
    {
      description: "a path that isn't a string",
      reason: "spec/upstream.json needs the spec's `path`",
      value: { ...PIN, path: null },
    },
    {
      description: "a short SHA",
      reason: "spec/upstream.json needs `sha` as a full commit SHA",
      value: { ...PIN, sha: "1111111" },
    },
    {
      description: "a SHA that isn't a string",
      reason: "spec/upstream.json needs `sha` as a full commit SHA",
      value: { ...PIN, sha: 1 },
    },
    {
      description: "an empty version",
      reason: "spec/upstream.json needs the pinned `version`",
      value: { ...PIN, version: "" },
    },
    {
      description: "a version that isn't a string",
      reason: "spec/upstream.json needs the pinned `version`",
      value: { ...PIN, version: 0.2 },
    },
    {
      description: "candidates that aren't a list",
      reason:
        "spec/upstream.json needs `candidates` as a list of `<owner>/<name>`",
      value: { ...PIN, candidates: "acme/next-home" },
    },
    {
      description: "a candidate that isn't <owner>/<name>",
      reason:
        "spec/upstream.json needs `candidates` as a list of `<owner>/<name>`",
      value: { ...PIN, candidates: ["next-home"] },
    },
    {
      description: "a candidate that isn't a string",
      reason:
        "spec/upstream.json needs `candidates` as a list of `<owner>/<name>`",
      value: { ...PIN, candidates: [1] },
    },
  ])("refuses $description", ({ reason, value }) => {
    // Given - a pin with one field wrong
    const text = JSON.stringify(value);

    // When - parsing it
    const answer = parsePin(text);

    // Then - the reason names the field
    expect(answer).toStrictEqual({ isOk: false, reason });
  });
});
