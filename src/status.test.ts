import { chmodSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TestRepo } from "#test/repo";

import {
  createTestRepo,
  draftRecord,
  record,
  refusedRecord,
  VERIFIED_BY,
  verifiedRecord,
} from "#test/repo";

import { run } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { STATUS_USAGE } from "./options.ts";
import { groupRecord } from "./status.ts";

const CONFIG = JSON.stringify({
  okf: { bundles: ["docs/decisions"], verifiedBy: VERIFIED_BY },
});

/** A sign-off, after `GENERATED`. */
const SIGNED = "2026-10-02T13:30:00Z";

/** When the fabricated records were generated. */
const GENERATED = "2026-10-01T15:00:00Z";

let repo: TestRepo;
let errors: string[];
let infos: string[];

beforeEach(() => {
  repo = createTestRepo(CONFIG);
  errors = [];
  infos = [];
  vi.spyOn(console, "error").mockImplementation((line: string) =>
    errors.push(line)
  );
  vi.spyOn(console, "log").mockImplementation((line: string) =>
    infos.push(line)
  );
});

afterEach(() => {
  repo.remove();
  vi.restoreAllMocks();
});

/** Run `okf status` from the repo root, or a directory in it. */
function runStatus(args: string[], directory = "."): Promise<number> {
  return run({
    args: ["status", ...args],
    cwd: path.join(repo.root, directory),
    isInteractive: false,
    program: "okf",
  });
}

/** A stable record signed off after it was generated, with extra lines. */
function signedRecord(extra: readonly string[] = []): string {
  return record([
    "type: Decision",
    "status: stable",
    `generated: { by: claude-code/model, at: ${GENERATED} }`,
    `verified: { by: ${VERIFIED_BY}, at: ${SIGNED} }`,
    ...extra,
  ]);
}

/** Write one record in each group, plus files it can't read as records. */
function writeEveryState(): void {
  repo.write("docs/decisions/index.md", "---\nokf_version: '0.2'\n---\n");
  repo.write(
    "docs/decisions/changed.md",
    record([
      "type: Decision",
      "status: draft",
      "generated: { by: claude-code/model, at: 2026-10-05T09:00:00Z }",
      `verified: { by: ${VERIFIED_BY}, at: ${SIGNED} }`,
    ])
  );
  repo.write("docs/decisions/draft.md", draftRecord("A draft"));
  repo.write("docs/decisions/refused.md", refusedRecord("Decision"));
  repo.write(
    "docs/decisions/never.md",
    record(["type: Decision", "title: Never signed"])
  );
  repo.write(
    "docs/decisions/other-signer.md",
    verifiedRecord({ by: "human:someone", title: "Someone else's" })
  );
  repo.write(
    "docs/decisions/stale.md",
    signedRecord(["stale_after: 2026-10-10T00:00:00Z"])
  );
  repo.write(
    "docs/decisions/fresh.md",
    signedRecord(["stale_after: 2999-01-01T00:00:00Z"])
  );
  repo.write(
    "docs/decisions/deprecated.md",
    record([
      "type: Decision",
      "status: deprecated",
      `verified: { by: ${VERIFIED_BY}, at: ${SIGNED} }`,
    ])
  );
  repo.write("docs/decisions/broken.md", "---\nstatus: [draft\n---\n");
  repo.write("docs/decisions/plain.md", "# No frontmatter\n");
}

describe("okf status", () => {
  test("groups every record by its state, in text", async () => {
    // Given - a record in each state, an index, and files that aren't records
    writeEveryState();

    // When - listing them
    const code = await runStatus([]);

    // Then - each group with its records, the unreadable one skipped
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos.join("\n").split("\n")).toStrictEqual([
      "[okf] Changed since sign-off (1)",
      `[okf]   docs/decisions/changed.md: status draft, signed off ${SIGNED}, generated 2026-10-05T09:00:00Z`,
      "[okf]",
      "[okf] Draft (2)",
      `[okf]   docs/decisions/draft.md: status draft, never signed off, generated ${GENERATED}`,
      "[okf]   docs/decisions/refused.md: status draft, never signed off",
      "[okf]",
      `[okf] Never signed off by ${VERIFIED_BY} (2)`,
      "[okf]   docs/decisions/never.md: no status, never signed off",
      `[okf]   docs/decisions/other-signer.md: status stable, never signed off, generated ${GENERATED}`,
      "[okf]",
      "[okf] Stale (1)",
      `[okf]   docs/decisions/stale.md: status stable, signed off ${SIGNED}, generated ${GENERATED}, stale since 2026-10-10T00:00:00Z`,
      "[okf]",
      "[okf] Settled (2)",
      `[okf]   docs/decisions/deprecated.md: status deprecated, signed off ${SIGNED}`,
      `[okf]   docs/decisions/fresh.md: status stable, signed off ${SIGNED}, generated ${GENERATED}`,
      "[okf]",
      "[okf] Skipped (1)",
      expect.stringMatching(/^\[okf\] {3}docs\/decisions\/broken\.md: /u),
      "[okf]",
      "[okf]     status: [draft",
      "[okf]",
      "[okf]     ^",
    ]);
  });

  test("prints the report as JSON, with no prefix", async () => {
    // Given - a changed record, a stale one, and an unreadable one
    repo.write(
      "docs/decisions/changed.md",
      record([
        "type: Decision",
        'title: "A changed record"',
        "status: draft",
        "generated: { by: claude-code/model, at: 2026-10-05T09:00:00Z }",
        `verified: { by: ${VERIFIED_BY}, at: ${SIGNED} }`,
      ])
    );
    repo.write(
      "docs/decisions/stale.md",
      signedRecord(["stale_after: 2026-10-10T00:00:00Z"])
    );
    repo.write(
      "docs/decisions/broken.md",
      "---\ntype: Decision\nstatus: draft\n  ---\n"
    );

    // When - listing them as JSON
    const code = await runStatus(["--format", "json"]);

    // Then - one JSON document, in the public shape
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toHaveLength(1);
    expect(JSON.parse(infos.join(""))).toMatchInlineSnapshot(`
      {
        "records": [
          {
            "generatedAt": "2026-10-05T09:00:00Z",
            "group": "changed",
            "isStale": false,
            "path": "docs/decisions/changed.md",
            "staleAfter": null,
            "state": "changed",
            "status": "draft",
            "title": "A changed record",
            "type": "Decision",
            "verifiedAt": "2026-10-02T13:30:00Z",
          },
          {
            "generatedAt": "2026-10-01T15:00:00Z",
            "group": "stale",
            "isStale": true,
            "path": "docs/decisions/stale.md",
            "staleAfter": "2026-10-10T00:00:00Z",
            "state": "verified",
            "status": "stable",
            "title": null,
            "type": "Decision",
            "verifiedAt": "2026-10-02T13:30:00Z",
          },
        ],
        "schemaVersion": 1,
        "skipped": [
          {
            "path": "docs/decisions/broken.md",
            "reason": "docs/decisions/broken.md: the closing fence must be \`---\` alone on its line, not "  ---"",
          },
        ],
        "verifiedBy": "human:jjloneman",
      }
    `);
  });

  test.each([
    {
      args: ["--draft"],
      description: "--draft lists only drafts, changed or not",
      expected: ["changed.md", "draft.md", "refused.md"],
    },
    {
      args: ["--changed"],
      description: "--changed lists only records changed since sign-off",
      expected: ["changed.md"],
    },
    {
      args: ["--stale"],
      description: "--stale lists only records past their stale_after",
      expected: ["stale.md"],
    },
    {
      args: ["--changed", "--stale"],
      description: "two filters list the records matching either",
      expected: ["changed.md", "stale.md"],
    },
  ])("$description", async ({ args, expected }) => {
    // Given - a record in each state
    writeEveryState();

    // When - listing them through filters
    const code = await runStatus([...args, "--format", "json"]);

    // Then - only the matching records, and still the skipped one
    const report = JSON.parse(infos.join("")) as {
      records: { path: string }[];
      skipped: { path: string }[];
    };

    expect(code).toBe(EXIT_CODES.ok);
    expect(report.records.map((entry) => path.basename(entry.path))).toEqual(
      expected
    );
    expect(report.skipped.map((entry) => entry.path)).toStrictEqual([
      "docs/decisions/broken.md",
    ]);
  });

  test.each([
    { args: [], description: "no records", message: "[okf] No records." },
    {
      args: ["--stale"],
      description: "no records matching a filter",
      message: "[okf] No records match.",
    },
  ])("says so when there are $description", async ({ args, message }) => {
    // Given - a bundle holding only a draft, or nothing
    if (args.length > 0) {
      repo.write("docs/decisions/draft.md", draftRecord("A draft"));
    } else {
      mkdirSync(path.join(repo.root, "docs/decisions"), { recursive: true });
    }

    // When - listing them
    const code = await runStatus(args);

    // Then - it says there's nothing, and still exits 0
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([message]);
  });

  test("lists only the records named, relative to where it runs", async () => {
    // Given - every state, run from inside the bundle
    writeEveryState();

    // When - naming two records, one twice, and a file with no frontmatter
    const code = await runStatus(
      ["stale.md", "./never.md", "stale.md", "plain.md"],
      "docs/decisions"
    );

    // Then - only those, the plain file skipped
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos.join("\n").split("\n")).toStrictEqual([
      `[okf] Never signed off by ${VERIFIED_BY} (1)`,
      "[okf]   docs/decisions/never.md: no status, never signed off",
      "[okf]",
      "[okf] Stale (1)",
      `[okf]   docs/decisions/stale.md: status stable, signed off ${SIGNED}, generated ${GENERATED}, stale since 2026-10-10T00:00:00Z`,
      "[okf]",
      "[okf] Skipped (1)",
      "[okf]   docs/decisions/plain.md has no frontmatter block.",
    ]);
  });

  test("lists named records in the bundles' order, not the order named", async () => {
    // Given - two records
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/z.md", draftRecord("Z"));

    // When - naming the later one first, as JSON
    await runStatus([
      "docs/decisions/z.md",
      "docs/decisions/a.md",
      "--format",
      "json",
    ]);

    // Then - in the order a scan lists them
    const report = JSON.parse(infos.join("")) as {
      records: { path: string }[];
    };

    expect(report.records.map((entry) => entry.path)).toStrictEqual([
      "docs/decisions/a.md",
      "docs/decisions/z.md",
    ]);
  });

  test("keeps a record's own text from breaking a line of the report", async () => {
    // Given - a status with a line separator, and invalid YAML with an escape
    repo.write(
      "docs/decisions/separator.md",
      record([
        "type: Decision",
        String.raw`status: "wip\u2028[okf] Settled (1)"`,
      ])
    );
    repo.write(
      "docs/decisions/escape.md",
      "---\nstatus: [draft \u001b[2J\u202e\n---\n"
    );

    // When - listing them
    const code = await runStatus([]);

    // Then - no control, bidi, or separator character reaches the terminal
    const text = infos.join("\n");

    expect(code).toBe(EXIT_CODES.ok);
    expect(
      ["\u001b", "\u202e", "\u2028"].filter((character) =>
        text.includes(character)
      )
    ).toStrictEqual([]);
    expect(text).toContain(
      "[okf]   docs/decisions/separator.md: status wip [okf] Settled (1), never signed off"
    );
    expect(text).toContain("[okf]   docs/decisions/escape.md: ");
  });

  test("fails when a named path isn't a record in the bundles", async () => {
    // Given - a Markdown file outside the bundle
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("notes.md", draftRecord("Not in a bundle"));

    // When - naming it
    const code = await runStatus(["notes.md"]);

    // Then - a usage error naming it
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "[okf] notes.md isn't a record in docs/decisions.",
    ]);
  });

  test("judges each record against --by's sign-off", async () => {
    // Given - a record signed off by someone other than the configured signer
    repo.write(
      "docs/decisions/other-signer.md",
      verifiedRecord({ by: "human:someone", title: "Someone else's" })
    );

    // When - listing them as that signer
    const code = await runStatus(["--by", "human:someone"]);

    // Then - it's settled for them
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos.join("\n").split("\n")).toStrictEqual([
      "[okf] Settled (1)",
      `[okf]   docs/decisions/other-signer.md: status stable, signed off ${SIGNED}, generated ${GENERATED}`,
    ]);
  });

  test("reports a status OKF doesn't define as written", async () => {
    // Given - a status written as a list, and an empty one with no type
    repo.write(
      "docs/decisions/list.md",
      record(["type: Decision", "status: [draft, wip]"])
    );
    repo.write("docs/decisions/empty.md", record(['status: ""']));

    // When - listing them as JSON
    await runStatus(["--format", "json"]);

    // Then - the list as written, and the empty one as none, as its type is
    const report = JSON.parse(infos.join("")) as {
      records: { path: string; status: null | string; type: null | string }[];
    };

    expect(report.records).toMatchObject([
      { path: "docs/decisions/empty.md", status: null, type: null },
      { path: "docs/decisions/list.md", status: "[draft, wip]" },
    ]);
  });

  test("reports a record generated ahead of the clock, which verify refuses", async () => {
    // Given - a record generated in a later century
    repo.write(
      "docs/decisions/ahead.md",
      record([
        "type: Decision",
        "status: stable",
        "generated: { by: claude-code/model, at: 2999-01-01T00:00:00Z }",
      ])
    );

    // When - listing it
    const code = await runStatus([]);

    // Then - it's listed, not skipped
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos.join("\n").split("\n")).toStrictEqual([
      `[okf] Never signed off by ${VERIFIED_BY} (1)`,
      "[okf]   docs/decisions/ahead.md: status stable, never signed off, generated 2999-01-01T00:00:00Z",
    ]);
  });

  test("prints its usage for --help", async () => {
    // When - asking for help
    const code = await runStatus(["--help"]);

    // Then - the usage, and exit 0
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos.join("\n")).toContain("[okf] usage: okf status");
    expect(STATUS_USAGE).toContain("--format <format>");
  });

  test("prints why and its usage for a usage error", async () => {
    // When - passing a verify flag
    const code = await runStatus(["--yes"]);

    // Then - a usage error, with the usage
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors.join("\n")).toMatch(/--yes[\s\S]*usage: okf status/u);
  });

  test("fails when the config names no one to sign as", async () => {
    // Given - a config with bundles but no signer
    repo.write(
      "package.json",
      JSON.stringify({ okf: { bundles: ["docs/decisions"] } })
    );

    // When - listing records
    const code = await runStatus([]);

    // Then - it says how to name one
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors.join("\n")).toContain("No one to sign as");
  });

  test("fails, naming the bundle, when a folder in it can't be listed", async () => {
    // Given - a folder in the bundle no one can read
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/locked/b.md", draftRecord("B"));
    const locked = path.join(repo.root, "docs/decisions/locked");
    chmodSync(locked, 0o000);

    try {
      // When - listing records
      const code = await runStatus([]);

      // Then - it fails rather than report a partial list
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors.join("\n")).toContain("docs/decisions can't be listed");
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test("reports an unexpected error instead of throwing", async () => {
    // Given - a package.json that's a folder, so reading it throws
    rmSync(path.join(repo.root, "package.json"));
    mkdirSync(path.join(repo.root, "package.json"));

    // When - listing records
    const code = await runStatus([]);

    // Then - the error, and exit 1
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors.join("\n")).toContain("EISDIR");
  });
});

describe("groupRecord", () => {
  test.each([
    {
      expected: "changed",
      isStale: true,
      state: "changed",
      status: "stable",
    },
    {
      expected: "draft",
      isStale: true,
      state: "verified",
      status: "draft",
    },
    {
      expected: "unverified",
      isStale: true,
      state: "unverified",
      status: undefined,
    },
    { expected: "stale", isStale: true, state: "verified", status: "stable" },
    {
      expected: "settled",
      isStale: false,
      state: "verified",
      status: "deprecated",
    },
  ] as const)(
    "groups $state, $status, stale $isStale as $expected",
    ({ expected, ...params }) => {
      // Given/When/Then - the first group that fits
      expect(groupRecord(params)).toBe(expected);
    }
  );
});
