import { describe, expect, test } from "vitest";

import { record } from "#test/repo";

import type { FileChange } from "./check-engine.ts";
import type { DraftPolicy } from "./config.ts";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { buildTrustRules } from "./trust-rules.ts";

/** A `generated` a month before the sign-offs below. */
const GENERATED =
  "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }";

/** A current sign-off by a person. */
const SIGNED = "verified: [{ by: human:a, at: 2026-10-02T15:00:00Z }]";

/** A record of the type `Decision`, with more frontmatter lines. */
function concept(lines: readonly string[]): string {
  return record(["type: Decision", ...lines]);
}

/**
 * Run the trust rules over one record, `kb/a.md`, and keep one rule's
 * findings, each as `line: severity message`.
 */
function findHits(params: {
  /**
   * The record as the base commit holds it.
   *
   * @example `concept([GENERATED, SIGNED])`
   */
  baseText?: string | undefined;

  /**
   * The rule's code.
   *
   * @example "T001"
   */
  code: string;

  /**
   * The `okf.drafts` policy.
   *
   * @example "block"
   */
  drafts?: DraftPolicy | undefined;

  /**
   * Whether a change is the branch's own; uncommitted changes alone when
   * unset.
   *
   * @example `({ commit }) => commit?.hash === "b1"`
   */
  isOnBranch?: ((change: FileChange) => boolean) | undefined;

  /**
   * The changes git knows to a path; none when unset.
   *
   * @example `() => [{ at: 1790000000, commit: undefined }]`
   */
  readChanges?: ((filePath: string) => readonly FileChange[]) | undefined;

  /**
   * The record's text.
   *
   * @example `concept(["status: draft"])`
   */
  text: string;
}): string[] {
  const { baseText, code, drafts, isOnBranch, readChanges, text } = params;
  const report = buildCheckReport({
    bundles: [
      {
        bundleDir: "kb",
        files: [
          readCheckedFile({
            baseText,
            bundleDir: "kb",
            doesExist: () => true,
            filePath: "kb/a.md",
            isOnBranch,
            readChanges,
            text,
          }),
        ],
      },
    ],
    rules: buildTrustRules(drafts),
    skipped: [],
  });

  return report.findings
    .filter((finding) => finding.code === code)
    .map(
      ({ line, message, severity }) => `${String(line)}: ${severity} ${message}`
    );
}

describe("buildTrustRules", () => {
  test("lists each rule once, in code order", () => {
    // Given - the codes
    const codes = buildTrustRules(undefined).map((rule) => rule.code);

    // Then - unique and sorted
    expect(codes).toStrictEqual([...new Set(codes)].sort());
  });
});

describe("T001 draft", () => {
  const draft = concept(["status: draft"]);

  test.each([
    { drafts: undefined, expected: ["3: info"] },
    { drafts: "allow" as const, expected: [] },
    { drafts: "warn" as const, expected: ["3: warning"] },
    { drafts: "block" as const, expected: ["3: error"] },
  ])("reports a draft under okf.drafts $drafts", ({ drafts, expected }) => {
    // When/Then - the severity the policy gives it
    expect(
      findHits({ code: "T001", drafts, text: draft }).map((hit) =>
        hit.replace(/ the record .*/u, "")
      )
    ).toStrictEqual(expected);
  });

  test("words the finding", () => {
    // When/Then - what it says
    expect(findHits({ code: "T001", text: draft })).toStrictEqual([
      "3: info the record is a draft, so no one has signed it off as settled; okf verify signs it off",
    ]);
  });

  test.each([
    {
      description: "a draft with a current sign-off",
      text: concept(["status: draft", GENERATED, SIGNED]),
    },
    {
      description: "a draft whose only sign-off is ahead of the clock",
      text: concept([
        "status: draft",
        GENERATED,
        "verified: [{ by: human:a, at: 2999-01-01T00:00:00Z }]",
      ]),
    },
    {
      description: "a draft whose sign-off in SQL form is current",
      text: concept([
        "status: draft",
        GENERATED,
        'verified: [{ by: human:a, at: "2026-10-02 15:00:00" }]',
      ]),
    },
    {
      description: "a draft whose generated.at can't be read",
      text: concept([
        "status: draft",
        "generated: { by: claude-code/1.0, at: soon }",
        SIGNED,
      ]),
    },
    {
      description: "a draft whose sign-offs can't be read",
      text: concept([
        "status: draft",
        GENERATED,
        "verified: [{ by: human:a, at: { day: 1 } }, { by: human:b, at: soon }]",
      ]),
    },
  ])("words $description as never signed off", ({ text }) => {
    // When/Then - the plain draft notice
    expect(findHits({ code: "T001", text })).toStrictEqual([
      "3: info the record is a draft, so no one has signed it off as settled; okf verify signs it off",
    ]);
  });

  describe("a draft re-stamped since its sign-off", () => {
    const signed = concept(["status: stable", GENERATED, SIGNED]);
    const restamped = concept([
      "status: draft",
      "generated: { by: claude-code/1.0, at: 2026-10-03T15:00:00Z }",
      "verified:",
      "  - { by: human:a, at: 2026-10-02T15:00:00Z }",
      "  - { by: human:b, at: 2026-09-30T15:00:00Z }",
    ]);
    const outdated =
      "3: info the record is a draft, and human:a's sign-off at 2026-10-02T15:00:00Z no longer counts, since generated.at is later (§5.3)";

    test("names a sign-off in SQL form", () => {
      // Given - a sign-off time that T002 reads too
      const text = restamped.replace(
        "at: 2026-10-02T15:00:00Z",
        'at: "2026-10-02 15:00:00"'
      );

      // When/Then - it names that time as written
      expect(findHits({ code: "T001", text })).toStrictEqual([
        "3: info the record is a draft, and human:a's sign-off at 2026-10-02 15:00:00 no longer counts, since generated.at is later (§5.3); okf verify signs it off again",
      ]);
    });

    test.each([
      {
        baseText: signed,
        description: "its text changed since the base branch",
        expected: `${outdated}; its text changed since the base branch; okf verify signs it off again`,
        text: `${restamped}\nA new paragraph.\n`,
      },
      {
        baseText: signed,
        description: "only its frontmatter changed",
        expected: `${outdated}; its text is the same as on the base branch, and only its frontmatter differs; okf verify signs it off again`,
        text: restamped,
      },
      {
        baseText: undefined,
        description: "the base has no copy to compare",
        expected: `${outdated}; okf verify signs it off again`,
        text: restamped,
      },
    ])("names the last sign-off when $description", (row) => {
      // When/Then - one notice that says why
      expect(
        findHits({ baseText: row.baseText, code: "T001", text: row.text })
      ).toStrictEqual([row.expected]);
    });

    describe("whose text is the same as on the base branch", () => {
      const same = `${outdated}; its text is the same as on the base branch, and`;

      /** The re-stamped record, citing each resource in `sources`. */
      function citing(resources: readonly string[]): string {
        return concept([
          "status: draft",
          "generated: { by: claude-code/1.0, at: 2026-10-03T15:00:00Z }",
          SIGNED,
          "sources:",
          ...resources.map(
            (resource, index) =>
              `  - { id: s${String(index)}, resource: ${resource} }`
          ),
        ]);
      }

      /** A commit, `base` on the base branch and the others on this one. */
      function commitTo(hash: string): FileChange {
        return { at: 1_790_000_000, commit: { hash, shortHash: hash } };
      }

      /**
       * The changes to each path from the repo root: `src/a.ts` and
       * `src/d.ts` in a branch commit, `src/b.ts` uncommitted, and
       * `src/old.ts` on the base only.
       */
      const CHANGES = new Map<string, readonly FileChange[]>([
        ["src/a.ts", [commitTo("branch"), commitTo("base")]],
        ["src/b.ts", [{ at: 1_790_000_000, commit: undefined }]],
        ["src/d.ts", [commitTo("other")]],
        ["src/old.ts", [commitTo("base")]],
      ]);

      test.each([
        {
          description: "one cited source changed in a branch commit",
          expected: `${same} its source ../src/a.ts changed on this branch, so check the record still holds against it; okf verify signs it off again`,
          resources: ["../src/a.ts", "../src/old.ts", "https://example.com/a"],
        },
        {
          description: "two cited sources changed, one uncommitted",
          expected: `${same} its sources ../src/b.ts and ../src/a.ts changed on this branch, so check the record still holds against them; okf verify signs it off again`,
          resources: ["../src/b.ts", "../src/a.ts", "../src/b.ts"],
        },
        {
          description: "three cited sources changed",
          expected: `${same} its sources ../src/a.ts, ../src/b.ts, and ../src/d.ts changed on this branch, so check the record still holds against them; okf verify signs it off again`,
          resources: ["../src/a.ts", "../src/b.ts", "../src/d.ts"],
        },
        {
          description: "no cited source changed on the branch",
          expected: `${same} only its frontmatter differs; okf verify signs it off again`,
          resources: ["../src/old.ts", "../src/c.ts"],
        },
      ])("names them when $description", ({ expected, resources }) => {
        // Given - the record as the base held it, signed off
        const text = citing(resources);
        const baseText = text
          .replace("status: draft", "status: stable")
          .replace("2026-10-03T15:00:00Z", "2026-10-01T15:00:00Z");

        // When/Then - the sources the branch changed, each named once
        expect(
          findHits({
            baseText,
            code: "T001",
            isOnBranch: ({ commit }) => commit?.hash !== "base",
            readChanges: (filePath) => CHANGES.get(filePath) ?? [],
            text,
          })
        ).toStrictEqual([expected]);
      });

      test("names an uncommitted change by default", () => {
        // Given - a cited source with uncommitted changes, and no branch test
        const text = citing(["../src/b.ts"]);

        // When/Then - it counts as the branch's
        expect(
          findHits({
            baseText: text.replace("status: draft", "status: stable"),
            code: "T001",
            readChanges: (filePath) => CHANGES.get(filePath) ?? [],
            text,
          })
        ).toStrictEqual([
          `${same} its source ../src/b.ts changed on this branch, so check the record still holds against it; okf verify signs it off again`,
        ]);
      });
    });
  });

  test.each([
    { description: "a stable record", text: concept(["status: stable"]) },
    { description: "a file that isn't a concept", text: "# Notes\n" },
  ])("passes $description", ({ text }) => {
    // When/Then - nothing
    expect(findHits({ code: "T001", text })).toStrictEqual([]);
  });
});

describe("T002 verified-draft", () => {
  test("warns about a draft with a current sign-off", () => {
    // Given - a draft whose sign-off came after its generation
    const text = concept(["status: draft", GENERATED, SIGNED]);

    // When/Then - the warning, on the status line
    expect(findHits({ code: "T002", text })).toStrictEqual([
      "3: warning status is draft, but human:a's sign-off at 2026-10-02T15:00:00Z is current; okf verify sets it stable, or re-stamp generated with okf touch if it changed",
    ]);
  });

  test.each([
    {
      description: "a draft whose sign-off is older than generated.at",
      text: concept([
        "status: draft",
        "generated: { by: claude-code/1.0, at: 2026-10-03T15:00:00Z }",
        SIGNED,
      ]),
    },
    {
      description: "a stable record with a current sign-off",
      text: concept(["status: stable", GENERATED, SIGNED]),
    },
  ])("passes $description", ({ text }) => {
    // When/Then - nothing
    expect(findHits({ code: "T002", text })).toStrictEqual([]);
  });
});

describe("T003 generated-ahead", () => {
  test("warns about a generated.at later than now", () => {
    // Given - a generation time far in the future
    const text = concept([
      "generated: { by: claude-code/1.0, at: 2999-01-01T00:00:00Z }",
    ]);

    // When/Then - the warning, on the generated line
    expect(findHits({ code: "T003", text })).toStrictEqual([
      "3: warning generated.at 2999-01-01T00:00:00Z is later than now, so no sign-off made before then can be current; write the time it was generated, in UTC",
    ]);
  });

  test.each([
    { description: "a generated.at in the past", text: concept([GENERATED]) },
    { description: "no generated", text: concept([]) },
  ])("passes $description", ({ text }) => {
    // When/Then - nothing
    expect(findHits({ code: "T003", text })).toStrictEqual([]);
  });
});

describe("T004 verified-ahead", () => {
  test("warns about each sign-off later than now", () => {
    // Given - one sign-off in the past and one far in the future
    const text = concept([
      GENERATED,
      "verified:",
      "  - { by: human:a, at: 2026-10-02T15:00:00Z }",
      "  - { by: human:b, at: 2999-01-01T00:00:00Z }",
      "  - { by: human:c }",
    ]);

    // When/Then - the future one alone
    expect(findHits({ code: "T004", text })).toStrictEqual([
      "6: warning human:b's sign-off at 2999-01-01T00:00:00Z is later than now, so it would hide every change made before then; sign the record off again",
    ]);
  });
});

describe("T005 self-verified", () => {
  test("warns about a current sign-off by the record's own generator", () => {
    // Given - a person who wrote the record and signed it off, and an older
    // sign-off of their own that no longer counts
    const text = concept([
      "generated: { by: human:a, at: 2026-10-01T15:00:00Z }",
      "verified:",
      "  - { by: human:a, at: 2026-09-01T15:00:00Z }",
      "  - { by: human:a, at: 2026-10-02T15:00:00Z }",
      "  - { by: human:b, at: 2026-10-02T15:00:00Z }",
    ]);

    // When/Then - the current one alone
    expect(findHits({ code: "T005", text })).toStrictEqual([
      "6: warning human:a both generated the record and signed it off, so no one else has checked it",
    ]);
  });

  test("passes a record someone else signed off", () => {
    // When/Then - nothing
    expect(
      findHits({ code: "T005", text: concept([GENERATED, SIGNED]) })
    ).toStrictEqual([]);
  });
});

describe("T006 unstamped-change", () => {
  const signed = concept(["status: stable", GENERATED, SIGNED]);
  const edited = `${signed}\nA new paragraph.\n`;

  test("fails a body changed since the base under the base's sign-off", () => {
    // When/Then - the error, on the generated line
    expect(
      findHits({ baseText: signed, code: "T006", text: edited })
    ).toStrictEqual([
      "4: error the body changed since the base branch, but human:a's sign-off at 2026-10-02T15:00:00Z, from before the change, still counts; re-stamp generated with okf touch, and sign it off again",
    ]);
  });

  test("fails a change whose generated was removed, leaving the sign-off current", () => {
    // Given - the edit drops generated, so every sign-off counts again
    const text = `${concept(["status: stable", SIGNED])}\nA new paragraph.\n`;

    // When/Then - the error, on the first line
    expect(findHits({ baseText: signed, code: "T006", text })).toStrictEqual([
      "1: error the body changed since the base branch, but human:a's sign-off at 2026-10-02T15:00:00Z, from before the change, still counts; re-stamp generated with okf touch, and sign it off again",
    ]);
  });

  test.each([
    {
      baseText: undefined,
      description: "a record the base doesn't hold",
      text: edited,
    },
    {
      baseText: signed.replaceAll("\n", "\r\n"),
      description: "a body that changed only in its line breaks",
      text: signed,
    },
    {
      baseText: concept(["status: stable", "tags: [cli]", GENERATED, SIGNED]),
      description: "a change to tags alone, which keeps generated",
      text: concept([
        "status: stable",
        "tags:",
        "  - cache",
        "  - cli",
        GENERATED,
        SIGNED,
      ]),
    },
    {
      baseText: signed,
      description: "a change re-stamped with a new generated.at",
      text: concept([
        "status: draft",
        "generated: { by: claude-code/1.0, at: 2026-10-03T15:00:00Z }",
        SIGNED,
      ]).concat("\nA new paragraph.\n"),
    },
    {
      baseText: concept([
        "status: stable",
        GENERATED,
        "verified:",
        "  - { by: human:a, at: 2026-10-02T15:00:00Z }",
        "  - { by: human:a, at: 2026-10-03T15:00:00Z }",
      ]),
      description: "a change its signer signed off again on the branch",
      text: `${concept([
        "status: stable",
        GENERATED,
        "verified:",
        "  - { by: human:a, at: 2026-10-02T15:00:00Z }",
        "  - { by: human:a, at: 2026-10-04T15:00:00Z }",
      ])}\nA new paragraph.\n`,
    },
    {
      baseText: concept(["status: draft", GENERATED]),
      description: "a change signed off on the branch",
      text: `${signed}\nA new paragraph.\n`,
    },
    {
      baseText: concept(["status: draft", GENERATED]),
      description: "a change no one has signed off",
      text: `${concept(["status: draft", GENERATED])}\nA new paragraph.\n`,
    },
  ])("passes $description", ({ baseText, text }) => {
    // When/Then - nothing
    expect(findHits({ baseText, code: "T006", text })).toStrictEqual([]);
  });
});
