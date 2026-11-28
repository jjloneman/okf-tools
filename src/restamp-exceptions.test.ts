import { describe, expect, test } from "vitest";

import {
  listExceptions,
  listReorders,
  OWNED_RESTAMP_EXCEPTIONS,
  RESTAMP_EXCEPTION_LIST,
  RESTAMP_EXCEPTIONS,
  RESTAMP_REORDERS,
} from "./restamp-exceptions.ts";

describe("restamp exceptions", () => {
  test.each([
    {
      description: "names the parts bare",
      expected: [
        "`tags`, the order of `sources`, the order of top-level keys, or",
        "several of these",
      ].join(" "),
      phrase: RESTAMP_EXCEPTIONS,
    },
    {
      description: "names the parts as the record's own",
      expected: [
        "its `tags`, the order of its `sources`, the order of its top-level",
        "keys, or several of these",
      ].join(" "),
      phrase: OWNED_RESTAMP_EXCEPTIONS,
    },
    {
      description: "names only the reorders",
      expected: "a reorder of `sources` or of the top-level keys",
      phrase: RESTAMP_REORDERS,
    },
  ])("$description", ({ expected, phrase }) => {
    // Given - one of the shared phrases

    // When/Then - it reads as every sentence that quotes it expects
    expect(phrase).toBe(expected);
  });

  test("holds `tags` as its one non-reorder, beside a reorder", () => {
    // Given - the list the tag rules name as `tags` and the reorders beside it

    // When - its entries are split into reorders and the rest
    const nonReorders = RESTAMP_EXCEPTION_LIST.filter(
      ({ reorderOf }) => reorderOf === undefined
    );
    const reorders = RESTAMP_EXCEPTION_LIST.filter(
      ({ reorderOf }) => reorderOf !== undefined
    );

    // Then - only `tags` isn't a reorder, so the tag rules' sentence holds
    expect(nonReorders.map(({ bare }) => bare)).toEqual(["`tags`"]);
    expect(reorders.length).toBeGreaterThan(0);
  });
});

describe("listExceptions", () => {
  test.each([
    { description: "one edit alone", edits: ["a"], expected: "a" },
    {
      description: "two edits, or both",
      edits: ["a", "b"],
      expected: "a or b, or both",
    },
    {
      description: "three edits, or several of these",
      edits: ["a", "b", "c"],
      expected: "a, b, c, or several of these",
    },
    {
      description: "four edits, or several of these",
      edits: ["a", "b", "c", "d"],
      expected: "a, b, c, d, or several of these",
    },
  ])("lists $description", ({ edits, expected }) => {
    // Given - a list of edits

    // When - they are listed as one phrase
    const phrase = listExceptions(edits);

    // Then - it reads as an English list that allows any mix of them
    expect(phrase).toBe(expected);
  });
});

describe("listReorders", () => {
  test.each([
    {
      description: "one reorder",
      expected: "a reorder of a",
      objects: ["of a"],
    },
    {
      description: "two reorders",
      expected: "a reorder of a or of b",
      objects: ["of a", "of b"],
    },
    {
      description: "three reorders",
      expected: "a reorder of a, of b, or of c",
      objects: ["of a", "of b", "of c"],
    },
  ])("lists $description", ({ expected, objects }) => {
    // Given - what each reorder reorders

    // When - they are listed as one reorder phrase
    const phrase = listReorders(objects);

    // Then - it reads as an English list after "a reorder"
    expect(phrase).toBe(expected);
  });
});
