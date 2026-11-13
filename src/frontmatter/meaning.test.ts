import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";

import { VERIFIED_BY } from "#test/repo";

import { checkMeaning } from "./meaning.ts";

const AT = "2026-10-02T13:30:00Z";
const VERIFY_OPTIONS = { at: AT, verifiedBy: VERIFIED_BY };

describe("checkMeaning", () => {
  test.each([
    {
      description: "the draft left as it was",
      edited: `status: draft\nverified: { by: ${VERIFIED_BY}, at: ${AT} }\ntitle: T`,
    },
    {
      description: "another field changed",
      edited: `status: stable\nverified: { by: ${VERIFIED_BY}, at: ${AT} }\ntitle: U`,
    },
  ])("names a result with $description", ({ edited }) => {
    // Given - a draft, and an edited version that means something else
    const doc = parseDocument("status: draft\ntitle: T", {
      schema: "failsafe",
    });

    const editedDoc = parseDocument(edited, { schema: "failsafe" });

    // When - checking the edit's meaning
    const problem = checkMeaning({ ...VERIFY_OPTIONS, doc, editedDoc });

    // Then - the difference named
    expect(problem).toBe(
      "the edit would change more than the status and the sign-off"
    );
  });

  test("tells a null from an empty string", () => {
    // Given - a null, and an edit that made it the empty string
    const doc = parseDocument("a:\nstatus: stable", { schema: "failsafe" });
    const editedDoc = parseDocument(
      `a: ''\nstatus: stable\nverified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      { schema: "failsafe" }
    );

    // When - checking the edit's meaning
    const problem = checkMeaning({ ...VERIFY_OPTIONS, doc, editedDoc });

    // Then - the difference named, though failsafe reads both as ""
    expect(problem).toBe(
      "the edit would change more than the status and the sign-off"
    );
  });

  test("names a result that isn't valid YAML", () => {
    // Given - a draft, and an edited version that doesn't parse
    const doc = parseDocument("status: draft", { schema: "failsafe" });
    const editedDoc = parseDocument("status: [stable", { schema: "failsafe" });

    // When - checking the edit's meaning
    const problem = checkMeaning({ ...VERIFY_OPTIONS, doc, editedDoc });

    // Then - the broken YAML named, before any comparison
    expect(problem).toBe("the edit would leave the frontmatter invalid YAML");
  });
});
