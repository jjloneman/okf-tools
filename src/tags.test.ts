import { chmodSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { record, useTestRepo } from "#test/repo";

import type { RecordSummary } from "./frontmatter/read.ts";
import type { Candidate } from "./records.ts";
import type { BundleContext } from "./run-context.ts";
import type { TagsReport } from "./tags.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import {
  buildTagsReport,
  formatTagsText,
  runTags,
  TAGS_SCHEMA_VERSION,
} from "./tags.ts";

const { repo } = useTestRepo();

let data: string[];
let errors: string[];
let infos: string[];

beforeEach(() => {
  data = [];
  errors = [];
  infos = [];
});

/** A loaded record at a path, whose summary has the given tags. */
function candidate(params: {
  /**
   * Its path from the repo root.
   *
   * @example "docs/decisions/a.md"
   */
  filePath: string;

  /**
   * Its tags, or `undefined` for a summary built without them.
   *
   * @example `["cli"]`
   */
  tags: readonly string[] | undefined;
}): Candidate {
  const { filePath, tags } = params;
  const summary: RecordSummary = {
    generatedAt: undefined,
    staleAfter: undefined,
    status: undefined,
    title: undefined,
    type: "Decision",
    verifiedAt: undefined,
    writtenStatus: undefined,
  };

  return {
    filePath,
    state: "unverified",
    summary: tags === undefined ? summary : { ...summary, tags },
    text: "",
  };
}

/** Run `okf tags` over the bundle `docs/decisions` in the given format. */
function listTags(format: "json" | "text"): number {
  const context: BundleContext = {
    bundleDirs: ["docs/decisions"],
    cwd: repo.root,
    excludeGlobs: [],
    output: {
      data: (text) => data.push(text),
      error: (message) => errors.push(message),
      info: (message) => infos.push(message),
    },
    repoRoot: repo.root,
  };

  return runTags({ context, format });
}

describe("buildTagsReport", () => {
  test("counts each tag across the records, sorted by name", () => {
    // Given - records sharing tags, one with none, and a skipped file
    const loaded = {
      candidates: [
        candidate({ filePath: "docs/decisions/a.md", tags: ["zeta", "cli"] }),
        candidate({ filePath: "docs/decisions/b.md", tags: ["cli", "Api"] }),
        candidate({ filePath: "docs/decisions/c.md", tags: undefined }),
        candidate({ filePath: "docs/decisions/d.md", tags: ["api"] }),
      ],
      skipped: [{ filePath: "docs/decisions/e.md", reason: "e.md is broken" }],
    };

    // When - building the report
    const report = buildTagsReport(loaded);

    // Then - each tag once, with its count, in code-unit order
    expect(report).toStrictEqual({
      schemaVersion: TAGS_SCHEMA_VERSION,
      skipped: [{ path: "docs/decisions/e.md", reason: "e.md is broken" }],
      tags: [
        { count: 1, name: "Api" },
        { count: 1, name: "api" },
        { count: 2, name: "cli" },
        { count: 1, name: "zeta" },
      ],
    });
  });
});

describe("formatTagsText", () => {
  test("lists one tag a line, with its count", () => {
    // Given - a report with two tags
    const report: TagsReport = {
      schemaVersion: TAGS_SCHEMA_VERSION,
      skipped: [],
      tags: [
        { count: 2, name: "api" },
        { count: 1, name: "cli" },
      ],
    };

    // When/Then - a line each
    expect(formatTagsText(report)).toBe("api (2)\ncli (1)");
  });

  test("says so when there are no tags, then lists the skipped files", () => {
    // Given - no tags, and two files skipped
    const report: TagsReport = {
      schemaVersion: TAGS_SCHEMA_VERSION,
      skipped: [
        { path: "docs/decisions/a.md", reason: "a.md is broken" },
        { path: "docs/decisions/b.md", reason: "b.md is broken" },
      ],
      tags: [],
    };

    // When/Then - no tags, then the skipped section
    expect(formatTagsText(report)).toBe(
      "No tags.\n\nSkipped (2)\n  a.md is broken\n  b.md is broken"
    );
  });

  test("keeps a tag's or reason's own text from breaking a line", () => {
    // Given - a tag and a reason holding control, bidi, and separator characters
    const report: TagsReport = {
      schemaVersion: TAGS_SCHEMA_VERSION,
      skipped: [{ path: "x.md", reason: "x.md\nbroken\u001b[2J" }],
      tags: [{ count: 1, name: "cli (9)‮" }],
    };

    // When - formatting it
    const text = formatTagsText(report);

    // Then - each on its own line, the characters replaced
    expect(text).toBe("cli (9) (1)\n\nSkipped (1)\n  x.md broken [2J");
  });
});

describe("runTags", () => {
  test("prints every tag with its count, as text", () => {
    // Given - records with tags in three layouts, and a broken one
    repo.write(
      "docs/decisions/a.md",
      record(["type: Decision", "tags:", "  - cli", "  - api"])
    );
    repo.write(
      "docs/decisions/b.md",
      record(["type: Decision", "tags: [cli]"])
    );
    repo.write(
      "docs/decisions/c.md",
      record(["type: Decision", "tags:", "  [", "    api,", "    cli,", "  ]"])
    );
    repo.write("docs/decisions/d.md", "---\ntags: [a\n---\n");

    // When - listing them
    const code = listTags("text");

    // Then - each tag counted, the broken record skipped
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos.join("\n").split("\n")).toStrictEqual([
      "api (2)",
      "cli (3)",
      "",
      "Skipped (1)",
      expect.stringMatching(/^ {2}docs\/decisions\/d\.md: /u),
    ]);
    expect(data).toStrictEqual([]);
  });

  test("prints the report as JSON data", () => {
    // Given - a record with tags
    repo.write(
      "docs/decisions/a.md",
      record(["type: Decision", "tags: [cli, api]"])
    );

    // When - listing them as JSON
    const code = listTags("json");

    // Then - one JSON document, in the public shape
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([]);
    expect(JSON.parse(data.join(""))).toStrictEqual({
      schemaVersion: 1,
      skipped: [],
      tags: [
        { count: 1, name: "api" },
        { count: 1, name: "cli" },
      ],
    });
  });

  test("fails when a folder in a bundle can't be listed", () => {
    // Given - a folder in the bundle no one can read
    repo.write("docs/decisions/locked/a.md", record(["tags: [cli]"]));
    const locked = path.join(repo.root, "docs/decisions/locked");
    chmodSync(locked, 0o000);

    try {
      // When - listing tags
      const code = listTags("text");

      // Then - it fails rather than count a partial list
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors.join("\n")).toContain("docs/decisions can't be listed");
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});
