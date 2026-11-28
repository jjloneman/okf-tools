import { describe, expect, test } from "vitest";

import {
  OWNED_RESTAMP_EXCEPTIONS,
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
});
