import { describe, expect, test } from "vitest";

import { verifyRecord } from "./edit.ts";
import { findSignOffProblem, signOffRecord } from "./sign-off.ts";

const AT = "2026-11-28T09:00:00Z";
const BODY = "\n# Title\n\nBody text.\n";
const GENERATED = "generated: { by: claude-code/x, at: 2026-11-27T09:00:00Z }";
const VERIFIED_BY = "human:a";

/** Build a fabricated record from its frontmatter lines. */
function record(frontmatter: readonly string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

describe("signOffRecord", () => {
  test("takes out the reason the last re-stamp gave", () => {
    // Given - a re-stamped draft that says why
    const text = record([
      "status: draft",
      GENERATED,
      'x-okf-restamp-reason: "src/a.ts changed"',
    ]);

    // When - signing it off
    const result = signOffRecord({ at: AT, text, verifiedBy: VERIFIED_BY });

    // Then - signed off, with the reason gone
    expect(result).toStrictEqual({
      isOk: true,
      text: record([
        "status: stable",
        GENERATED,
        `verified: { by: ${VERIFIED_BY}, at: ${AT} }`,
      ]),
    });
  });

  test("gives a record with no reason the text verifyRecord gives", () => {
    // Given - a draft with no reason
    const text = record(["status: draft", GENERATED]);
    const params = { at: AT, text, verifiedBy: VERIFIED_BY };

    // When - signing it off both ways
    const result = signOffRecord(params);

    // Then - the same text
    expect(result).toStrictEqual(verifyRecord(params));
  });

  test("refuses what verifyRecord refuses", () => {
    // Given - a record with no frontmatter
    const text = BODY;

    // When - signing it off
    const result = signOffRecord({ at: AT, text, verifiedBy: VERIFIED_BY });

    // Then - refused as verifyRecord refuses it
    expect(result).toMatchObject({ isOk: false, kind: "noFrontmatter" });
  });

  test("refuses a reason it can't take out", () => {
    // Given - a reason with an anchor before its key
    const text = record([
      "status: draft",
      GENERATED,
      "&k x-okf-restamp-reason: a",
    ]);

    // When - signing it off
    const result = signOffRecord({ at: AT, text, verifiedBy: VERIFIED_BY });

    // Then - refused for a hand edit, never leaving the reason behind
    expect(result).toStrictEqual({
      isOk: false,
      kind: "unsupportedLayout",
      reason:
        "`x-okf-restamp-reason` doesn't start its line; edit the record by hand",
    });
  });
});

describe("findSignOffProblem", () => {
  test.each([
    {
      description: "a record with a reason it can take out",
      expected: undefined,
      frontmatter: ["status: draft", GENERATED, "x-okf-restamp-reason: a"],
    },
    {
      description: "a reason it can't take out",
      expected:
        "`x-okf-restamp-reason` doesn't start its line; edit the record by hand",
      frontmatter: ["status: draft", GENERATED, "&k x-okf-restamp-reason: a"],
    },
    {
      description: "frontmatter verifyRecord refuses",
      expected: expect.stringMatching(
        /^frontmatter isn't valid YAML/u
      ) as string,
      frontmatter: ["status: [draft", GENERATED],
    },
  ])("reports $description", ({ expected, frontmatter }) => {
    // Given - a record
    const text = record(frontmatter);

    // When - asking whether it can be signed off
    const problem = findSignOffProblem({ text, verifiedBy: VERIFIED_BY });

    // Then - the refusal signOffRecord would give, if any
    expect(problem).toStrictEqual(expected);
  });
});
