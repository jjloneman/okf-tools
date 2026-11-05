import { describe, expect, test } from "vitest";

import type { Candidate } from "./records.ts";

import {
  buildCommitMessage,
  currentTimestamp,
  describeState,
  needsSignOff,
  prepareEdits,
} from "./records.ts";

const AT = "2026-10-02T13:30:00Z";
const VERIFIED_BY = "human:jjloneman";

/** A fabricated candidate, with its summary fields overridable. */
function candidate(params: {
  filePath: string;
  state?: Candidate["state"];
  summary?: Partial<Candidate["summary"]>;
  text?: string;
}): Candidate {
  const {
    filePath,
    state = "unverified",
    summary,
    text = "---\nstatus: draft\n---\n",
  } = params;

  return {
    filePath,
    state,
    summary: {
      generatedAt: undefined,
      status: "draft",
      title: "A title",
      type: "Decision",
      verifiedAt: undefined,
      ...summary,
    },
    text,
  };
}

describe("buildCommitMessage", () => {
  test("names the bundle and the type for one record", () => {
    // Given - one decision record
    const selected = [candidate({ filePath: "docs/decisions/a.md" })];

    // When/Then - a singular subject scoped to the bundle
    expect(buildCommitMessage(selected)).toBe(
      "docs(decisions): 📝 verify 1 decision record\n\n- A title (a.md)"
    );
  });

  test("falls back to okf across bundles and types, and to the file name", () => {
    // Given - two records in different bundles, of different types, one untitled
    const selected = [
      candidate({ filePath: "docs/decisions/a.md" }),
      candidate({
        filePath: "docs/references/b.md",
        summary: { title: undefined, type: "Reference" },
      }),
    ];

    // When/Then - a plural, generic subject
    expect(buildCommitMessage(selected)).toBe(
      "docs(okf): 📝 verify 2 okf records\n\n- A title (a.md)\n- b.md (b.md)"
    );
  });
});

describe("buildCommitMessage scope", () => {
  test.each([
    {
      description: "a bundle at the repo root",
      filePaths: ["a.md"],
    },
    {
      description: "two bundles with the same folder name",
      filePaths: ["one/decisions/a.md", "two/decisions/b.md"],
    },
  ])("is okf for $description", ({ filePaths }) => {
    // Given - records in those bundles
    const selected = filePaths.map((filePath) => candidate({ filePath }));

    // When/Then - the generic scope
    expect(buildCommitMessage(selected)).toMatch(/^docs\(okf\): /u);
  });
});

describe("currentTimestamp", () => {
  test("is a UTC timestamp to the second", () => {
    // When/Then - no milliseconds, a Z suffix
    expect(currentTimestamp()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u);
  });
});

describe("describeState", () => {
  test.each([
    {
      description: "a changed record",
      expected: "changed since you verified it",
      state: "changed",
      status: "stable",
    },
    {
      description: "an unverified draft",
      expected: "draft",
      state: "unverified",
      status: "draft",
    },
    {
      description: "a record with no status",
      expected: "no status",
      state: "unverified",
      status: undefined,
    },
    {
      description: "a verified record",
      expected: "already verified, unchanged",
      state: "verified",
      status: "stable",
    },
  ] as const)("words $description", ({ expected, state, status }) => {
    // When/Then - the hint
    expect(
      describeState(candidate({ filePath: "a.md", state, summary: { status } }))
    ).toBe(expected);
  });
});

describe("needsSignOff", () => {
  test.each([
    { shouldSignOff: true, state: "changed" },
    { shouldSignOff: true, state: "unverified" },
    { shouldSignOff: false, state: "verified" },
  ] as const)(
    "is $shouldSignOff for a $state record",
    ({ shouldSignOff, state }) => {
      // When/Then - only a verified record is done
      expect(needsSignOff(candidate({ filePath: "a.md", state }))).toBe(
        shouldSignOff
      );
    }
  );
});

describe("prepareEdits", () => {
  test("returns every record's new text", () => {
    // Given - a draft
    const candidates = [candidate({ filePath: "docs/decisions/a.md" })];

    // When - preparing its edit
    const result = prepareEdits({
      at: AT,
      candidates,
      verifiedBy: VERIFIED_BY,
    });

    // Then - stable, with a verified entry
    expect(result).toStrictEqual({
      edits: [
        {
          filePath: "docs/decisions/a.md",
          originalText: "---\nstatus: draft\n---\n",
          text: `---\nstatus: stable\nverified: { by: ${VERIFIED_BY}, at: ${AT} }\n---\n`,
        },
      ],
      failures: [],
    });
  });

  test("returns the accepted edits alongside the refusals", () => {
    // Given - a draft and a file with no frontmatter
    const candidates = [
      candidate({ filePath: "docs/decisions/a.md" }),
      candidate({
        filePath: "docs/decisions/b.md",
        text: "# No frontmatter\n",
      }),
    ];

    // When - preparing their edits
    const result = prepareEdits({
      at: AT,
      candidates,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the draft's edit, and the refusal named
    expect(result.edits.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/a.md",
    ]);
    expect(result.failures).toStrictEqual([
      expect.stringMatching(/^docs\/decisions\/b\.md: /u),
    ]);
  });
});
