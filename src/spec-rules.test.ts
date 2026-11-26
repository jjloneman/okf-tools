import { describe, expect, test } from "vitest";

import { record } from "#test/repo";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { SPEC_RULES } from "./spec-rules.ts";

/** A finding, as these tests compare it. */
type Hit = {
  /**
   * Its 1-based line, or `null` for a file that isn't there.
   *
   * @example 3
   */
  line: null | number;

  /**
   * What's wrong.
   *
   * @example "log.md must have no frontmatter (§9)"
   */
  message: string;

  /**
   * The file's path from the repo root.
   *
   * @example "kb/a.md"
   */
  path: string;
};

/** A valid root `index.md` for the bundle `kb`. */
const ROOT_INDEX = '---\nokf_version: "0.3"\n---\n# KB\n';

/** A record of the type `Decision`, with more frontmatter lines. */
function concept(lines: readonly string[]): string {
  return record(["type: Decision", ...lines]);
}

/**
 * Run the spec rules over files in one bundle, and keep the findings of one
 * rule.
 */
function findHits(params: {
  /**
   * The bundle's folder.
   *
   * @example "kb"
   */
  bundleDir?: string;

  /**
   * The rule's code.
   *
   * @example "E005"
   */
  code: string;

  /**
   * Paths from the repo root that exist beside the files.
   *
   * @example `["kb/LICENSE.txt"]`
   */
  existing?: readonly string[];

  /**
   * The bundle's files, by path from the repo root.
   *
   * @example `{ "kb/a.md": "# A\n" }`
   */
  files: Readonly<Record<string, string>>;
}): Hit[] {
  const { bundleDir = "kb", code, existing = [], files } = params;
  const paths = new Set([...existing, ...Object.keys(files)]);
  const doesExist = (filePath: string): boolean => paths.has(filePath);
  const report = buildCheckReport({
    bundles: [
      {
        bundleDir,
        files: Object.entries(files).map(([filePath, text]) =>
          readCheckedFile({ bundleDir, doesExist, filePath, text })
        ),
      },
    ],
    rules: SPEC_RULES,
    skipped: [],
  });

  return report.findings
    .filter((finding) => finding.code === code)
    .map(({ line, message, path }) => ({ line, message, path }));
}

/** The lines of one rule's findings in the files, with their paths. */
function findLines(params: Parameters<typeof findHits>[0]): string[] {
  return findHits(params).map(({ line, path }) => `${path}:${String(line)}`);
}

describe("SPEC_RULES", () => {
  test("lists each rule once, in code order", () => {
    // Given - the codes
    const codes = SPEC_RULES.map((rule) => rule.code);

    // Then - unique and sorted
    expect(codes).toStrictEqual([...new Set(codes)].sort());
  });
});

describe("E002 frontmatter-parses", () => {
  test.each([
    {
      description: "a concept that parses",
      expected: [],
      files: { "kb/a.md": concept([]) },
    },
    {
      description: "a concept that doesn't",
      expected: ["kb/a.md:4"],
      files: { "kb/a.md": "---\ntype: Decision\ntags: [a\n---\n" },
    },
    {
      description: "a fence that never closes",
      expected: ["kb/a.md:1"],
      files: { "kb/a.md": "---\ntype: Decision\n" },
    },
    {
      description: "Markdown that opens with a thematic break",
      expected: [],
      files: { "kb/a.md": "----\n\nNotes.\n" },
    },
    {
      description: "a rule after blank lines, with no closing fence",
      expected: [],
      files: { "kb/a.md": "\n\n---\n\nNotes.\n" },
    },
    {
      description: "a root index.md that doesn't parse",
      expected: ["kb/index.md:3"],
      files: { "kb/index.md": "---\nokf_version: [\n---\n" },
    },
    {
      description: "a subfolder index.md that doesn't parse",
      expected: [],
      files: { "kb/sub/index.md": "---\ntitle: [\n---\n" },
    },
    {
      description: "a log.md that doesn't parse",
      expected: [],
      files: { "kb/log.md": "---\ntitle: [\n---\n" },
    },
    {
      description: "a key given twice, which E007 reports",
      expected: [],
      files: { "kb/a.md": "---\ntype: A\ntype: B\n---\n" },
    },
  ])("checks $description", ({ expected, files }) => {
    // When/Then - the lines it reports
    expect(findLines({ code: "E002", files })).toStrictEqual(expected);
  });

  test("says why, naming the section", () => {
    // When - checking a list for frontmatter
    const hits = findHits({
      code: "E002",
      files: { "kb/a.md": "---\n- a\n---\n" },
    });

    // Then - the reason
    expect(hits).toStrictEqual([
      {
        line: 2,
        message:
          "frontmatter doesn't parse as a YAML mapping: it isn't a mapping of keys to values (§4)",
        path: "kb/a.md",
      },
    ]);
  });
});

describe("E004 subfolder-index-frontmatter", () => {
  test.each([
    {
      description: "a subfolder index.md with frontmatter",
      expected: ["kb/sub/index.md:1"],
      files: { "kb/sub/index.md": "---\ntitle: Sub\n---\n# Sub\n" },
    },
    {
      description: "a subfolder index.md without",
      expected: [],
      files: { "kb/sub/index.md": "# Sub\n" },
    },
    {
      description: "the root index.md with frontmatter",
      expected: [],
      files: { "kb/index.md": ROOT_INDEX },
    },
    {
      description: "a concept",
      expected: [],
      files: { "kb/sub/a.md": concept([]) },
    },
  ])("checks $description", ({ expected, files }) => {
    // When/Then - the lines it reports
    expect(findLines({ code: "E004", files })).toStrictEqual(expected);
  });
});

describe("E005 log-date-heading", () => {
  test("reports each heading that isn't a real date, outside code", () => {
    // Given - a log with good, bad, and fenced headings
    const log = [
      "# Log",
      "",
      "## 2026-01-02",
      "",
      "## May 1",
      "",
      "```",
      "## not a heading",
      "```",
      "",
      "## 2026-02-30",
      "### 2026 notes",
      "",
    ].join("\n");

    // When - checking it
    const hits = findHits({ code: "E005", files: { "kb/log.md": log } });

    // Then - the two bad headings
    expect(hits).toStrictEqual([
      {
        line: 5,
        message: 'a log.md date heading must be YYYY-MM-DD (§9); found "May 1"',
        path: "kb/log.md",
      },
      {
        line: 11,
        message:
          'a log.md date heading must be YYYY-MM-DD (§9); found "2026-02-30"',
        path: "kb/log.md",
      },
    ]);
  });

  test("ignores headings outside a log.md", () => {
    // When/Then - nothing in a concept
    expect(
      findLines({ code: "E005", files: { "kb/a.md": "# A\n\n## May 1\n" } })
    ).toStrictEqual([]);
  });
});

describe("E006 log-frontmatter", () => {
  test.each([
    {
      description: "a log.md with frontmatter",
      expected: ["kb/log.md:1"],
      files: { "kb/log.md": "---\ntitle: Log\n---\n## 2026-01-01\n" },
    },
    {
      description: "a log.md without",
      expected: [],
      files: { "kb/log.md": "# Log\n\n## 2026-01-01\n" },
    },
  ])("checks $description", ({ expected, files }) => {
    // When/Then - the lines it reports
    expect(findLines({ code: "E006", files })).toStrictEqual(expected);
  });
});

describe("E007 frontmatter-unique-keys", () => {
  test.each([
    {
      description: "a concept repeating a key",
      expected: ["kb/a.md:3"],
      files: { "kb/a.md": "---\ntype: A\ntype: B\n---\n" },
    },
    {
      description: "a root index.md repeating a key",
      expected: ["kb/index.md:3"],
      files: { "kb/index.md": "---\ntitle: A\ntitle: B\n---\n" },
    },
    {
      description: "a log.md repeating a key",
      expected: [],
      files: { "kb/log.md": "---\ntitle: A\ntitle: B\n---\n" },
    },
    {
      description: "unique keys",
      expected: [],
      files: { "kb/a.md": concept(["title: A"]) },
    },
    {
      description: "YAML that doesn't parse, which E002 reports",
      expected: [],
      files: { "kb/a.md": "---\ntags: [\n---\n" },
    },
  ])("checks $description", ({ expected, files }) => {
    // When/Then - the lines it reports
    expect(findLines({ code: "E007", files })).toStrictEqual(expected);
  });
});

describe("I201 stale", () => {
  test.each([
    {
      description: "a stale_after that has passed",
      expected: [
        "kb/a.md:3: the concept is stale: stale_after 2026-01-01 has passed (§5.5)",
      ],
      lines: ["stale_after: 2026-01-01"],
    },
    {
      description: "a stale_after still to come",
      expected: [],
      lines: ["stale_after: 2999-01-01T00:00:00Z"],
    },
    {
      description: "a stale_after that W101 reports",
      expected: [],
      lines: ["stale_after: 2026-01-01 10:00:00"],
    },
    {
      description: "no stale_after",
      expected: [],
      lines: [],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - where and what it reports
    expect(
      findHits({ code: "I201", files: { "kb/a.md": concept(lines) } }).map(
        ({ line, message, path }) => `${path}:${String(line)}: ${message}`
      )
    ).toStrictEqual(expected);
  });
});

describe("I204 no-current-verification", () => {
  const generated =
    "generated: { by: claude-code/1.0, at: 2026-10-02T15:00:00Z }";

  test.each([
    {
      description: "sign-offs all older than generated.at",
      expected: ["kb/a.md:5"],
      lines: [
        generated,
        "verified:",
        "  - { by: human:a, at: 2026-10-01T15:00:00Z }",
        "  - { by: human:b, at: 2026-10-02T14:59:59Z }",
      ],
    },
    {
      description: "one sign-off at generated.at, to the second",
      expected: [],
      lines: [
        generated,
        "verified:",
        "  - { by: human:a, at: 2026-10-01T15:00:00Z }",
        "  - { by: human:b, at: 2026-10-02T15:00:00.5Z }",
      ],
    },
    {
      description: "no sign-off",
      expected: [],
      lines: [generated],
    },
    {
      description: "sign-offs whose at can't be read",
      expected: [],
      lines: [
        generated,
        "verified: [{ by: human:a, at: { day: 1 } }, { by: human:b, at: soon }]",
      ],
    },
    {
      description: "a generated.at that can't be read",
      expected: [],
      lines: [
        "generated: { by: claude-code/1.0, at: soon }",
        "verified: [{ by: human:a, at: 2026-10-01T15:00:00Z }]",
      ],
    },
    {
      description: "no generated",
      expected: [],
      lines: ["verified: [{ by: human:a, at: 2026-10-01T15:00:00Z }]"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "I204", files: { "kb/a.md": concept(lines) } })
    ).toStrictEqual(expected);
  });
});

describe("W101 timestamp-format", () => {
  test.each([
    {
      description: "a date-time generated.at",
      expected: [],
      lines: ["generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }"],
    },
    {
      description: "a date-only generated.at",
      expected: [],
      lines: ["generated: { by: claude-code/1.0, at: 2026-10-01 }"],
    },
    {
      description: "a date-time with an offset and fraction",
      expected: [],
      lines: [
        "generated: { by: claude-code/1.0, at: 2026-10-01t15:00:00.5+02:00 }",
      ],
    },
    {
      description: "a generated.at in words",
      expected: ["kb/a.md:5"],
      lines: ["generated:", "  by: claude-code/1.0", "  at: yesterday"],
    },
    {
      description: "a generated.at with no offset",
      expected: ["kb/a.md:3"],
      lines: ["generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00 }"],
    },
    {
      description: "a generated.at that isn't a real date",
      expected: ["kb/a.md:3"],
      lines: ["generated: { by: claude-code/1.0, at: 2026-02-30 }"],
    },
    {
      description: "a generated.at with no by, which W102 reports",
      expected: [],
      lines: ["generated: { at: yesterday }"],
    },
    {
      description: "a blank generated.at",
      expected: [],
      lines: ["generated: { by: claude-code/1.0, at: ~ }"],
    },
    {
      description: "a bad verified[].at",
      expected: ["kb/a.md:5"],
      lines: ["verified:", "  - by: human:a", "    at: soon"],
    },
    {
      description: "an incomplete verified event, which W104 reports",
      expected: [],
      lines: ["verified:", "  - at: soon"],
    },
    {
      description: "a bad stale_after",
      expected: ["kb/a.md:3"],
      lines: ["stale_after: next year"],
    },
    {
      description: "a stale_after that's a mapping",
      expected: ["kb/a.md:3"],
      lines: ["stale_after: { at: 2027-01-01 }"],
    },
    {
      description: "a good stale_after",
      expected: [],
      lines: ["stale_after: 2027-01-01"],
    },
    {
      description: "a blank stale_after",
      expected: [],
      lines: ['stale_after: ""'],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "W101", files: { "kb/a.md": concept(lines) } })
    ).toStrictEqual(expected);
  });

  test("checks nothing in a file that isn't a concept", () => {
    // When/Then - nothing, without a type
    expect(
      findLines({
        code: "W101",
        files: { "kb/a.md": record(["stale_after: next year"]) },
      })
    ).toStrictEqual([]);
  });

  test("quotes the value, or names one that isn't text", () => {
    // Given - a mapping for an at, and text for stale_after
    const text = concept([
      "generated: { by: claude-code/1.0, at: { day: 1 } }",
      "stale_after: soon",
    ]);

    // When - checking it
    const messages = findHits({ code: "W101", files: { "kb/a.md": text } }).map(
      ({ message }) => message
    );

    // Then - each described
    expect(messages).toStrictEqual([
      "generated.at is an RFC 3339 date-time with an offset, such as 2026-06-30T14:00:00Z, or a date such as 2026-06-30 (§5); found a value that isn't text",
      'stale_after does not parse, so consumers never treat the concept as fresh (§5.5); found "soon"',
    ]);
  });
});

describe("W102 generated-shape", () => {
  test.each([
    {
      description: "a mapping with a by",
      expected: [],
      lines: ["generated: { by: claude-code/1.0 }"],
    },
    {
      description: "an anchored mapping, through an alias",
      expected: [],
      lines: [
        "base: &g { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
        "generated: *g",
      ],
    },
    { description: "no generated", expected: [], lines: [] },
    { description: "a null generated", expected: [], lines: ["generated: ~"] },
    { description: "an empty list", expected: [], lines: ["generated: []"] },
    { description: "an empty string", expected: [], lines: ['generated: ""'] },
    {
      description: "text",
      expected: ["kb/a.md:3"],
      lines: ["generated: claude-code/1.0"],
    },
    {
      description: "a mapping with no by",
      expected: ["kb/a.md:3"],
      lines: ["generated: { at: 2026-10-01T15:00:00Z }"],
    },
    {
      description: "a mapping with a blank by",
      expected: ["kb/a.md:3"],
      lines: ["generated: { by: null }"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "W102", files: { "kb/a.md": concept(lines) } })
    ).toStrictEqual(expected);
  });
});

describe("W103 actor-format", () => {
  test.each([
    {
      description: "a producer and version",
      expected: [],
      lines: ["generated: { by: claude-code/2.1.316 }"],
    },
    {
      description: "a scheme and id",
      expected: [],
      lines: ["generated: { by: human:someone }"],
    },
    {
      description: "a bare name",
      expected: ["kb/a.md:3"],
      lines: ["generated: { by: claude }"],
    },
    {
      description: "a bare name in a verified event",
      expected: ["kb/a.md:5"],
      lines: ["verified:", "  - at: 2026-10-02T00:00:00Z", "    by: someone"],
    },
    {
      description: "an incomplete verified event, which W104 reports",
      expected: [],
      lines: ["verified:", "  - by: someone"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "W103", files: { "kb/a.md": concept(lines) } })
    ).toStrictEqual(expected);
  });

  test("names an actor that isn't text", () => {
    // When - checking a by that's a mapping
    const hits = findHits({
      code: "W103",
      files: { "kb/a.md": concept(["generated: { by: { name: a } }"]) },
    });

    // Then - described as not text
    expect(hits.map(({ message }) => message)).toStrictEqual([
      "generated.by is an actor: <producer>/<version> or <scheme>:<id>, such as human:<id> (§7); found a value that isn't text",
    ]);
  });
});

describe("W104 verified-event-shape", () => {
  test.each([
    {
      description: "a complete event",
      expected: [],
      lines: ["verified:", "  - { by: human:a, at: 2026-10-02T00:00:00Z }"],
    },
    {
      description: "a bare mapping that's complete",
      expected: [],
      lines: ["verified: { by: human:a, at: 2026-10-02T00:00:00Z }"],
    },
    {
      description: "an anchored event, through an alias",
      expected: [],
      lines: [
        "base: &v { by: human:a, at: 2026-10-02T00:00:00Z }",
        "verified:",
        "  - *v",
      ],
    },
    { description: "no verified", expected: [], lines: [] },
    { description: "a null verified", expected: [], lines: ["verified: null"] },
    { description: "an empty list", expected: [], lines: ["verified: []"] },
    {
      description: "an event with no at",
      expected: ["kb/a.md:5"],
      lines: [
        "verified:",
        "  - { by: human:a, at: 2026-10-02T00:00:00Z }",
        "  - { by: human:b }",
      ],
    },
    {
      description: "a bare mapping with no at",
      expected: ["kb/a.md:3"],
      lines: ["verified: { by: human:a }"],
    },
    {
      description: "an event that's text",
      expected: ["kb/a.md:4"],
      lines: ["verified:", "  - human:a"],
    },
    {
      description: "an anchored event with no by",
      expected: ["kb/a.md:3"],
      lines: ["base: &v { at: 2026-10-02T00:00:00Z }", "verified: [*v]"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "W104", files: { "kb/a.md": concept(lines) } })
    ).toStrictEqual(expected);
  });

  test("names the event's index", () => {
    // When - checking a second event with no by
    const hits = findHits({
      code: "W104",
      files: {
        "kb/a.md": concept([
          "verified:",
          "  - { by: human:a, at: 2026-10-02T00:00:00Z }",
          '  - { by: "", at: 2026-10-03T00:00:00Z }',
        ]),
      },
    });

    // Then - verified[1]
    expect(hits.map(({ message }) => message)).toStrictEqual([
      "verified[1] needs by and at; consumers ignore it (§5.2)",
    ]);
  });
});

describe("W105 status-value", () => {
  test.each([
    { description: "draft", expected: [], lines: ["status: draft"] },
    { description: "stable", expected: [], lines: ["status: stable"] },
    { description: "deprecated", expected: [], lines: ["status: deprecated"] },
    { description: "no status", expected: [], lines: [] },
    { description: "a blank status", expected: [], lines: ["status:"] },
    {
      description: "a value OKF doesn't define",
      expected: [
        'status is draft, stable, or deprecated; consumers treat "final" as not current (§5.4)',
      ],
      lines: ["status: final"],
    },
    {
      description: "a mapping",
      expected: [
        "status is draft, stable, or deprecated; consumers treat this value as not current (§5.4)",
      ],
      lines: ["status: { value: draft }"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the messages it reports
    expect(
      findHits({ code: "W105", files: { "kb/a.md": concept(lines) } }).map(
        ({ message }) => message
      )
    ).toStrictEqual(expected);
  });
});

describe("W110 tags-list", () => {
  test.each([
    { description: "a list", expected: [], lines: ["tags: [cli]"] },
    { description: "no tags", expected: [], lines: [] },
    { description: "null tags", expected: [], lines: ["tags: ~"] },
    {
      description: "text with commas",
      expected: [
        'write tags as a YAML list (§4.1, §11.2); consumers read it as the single tag "cli, api"',
      ],
      lines: ["tags: cli, api"],
    },
    {
      description: "a single word",
      expected: ["write tags as a YAML list (§4.1, §11.2)"],
      lines: ["tags: cli"],
    },
    {
      description: "a mapping",
      expected: ["write tags as a YAML list of strings (§4.1)"],
      lines: ["tags: { cli: true }"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the messages it reports
    expect(
      findHits({ code: "W110", files: { "kb/a.md": concept(lines) } }).map(
        ({ message }) => message
      )
    ).toStrictEqual(expected);
  });
});

describe("W115 index-link-target", () => {
  test("reports each link to a path the bundle doesn't hold", () => {
    // Given - a root index linking every kind of target
    const index = [
      "---",
      'okf_version: "0.3"',
      "---",
      "# KB",
      "",
      "- [A](a.md)",
      "- [Missing](missing.md)",
      "- [Web](https://example.com/missing.md)",
      "- [Host](//example.com/missing.md)",
      "- [Anchor](#missing)",
      "- [Query](a.md?view=1#top)",
      "- [Rooted](/a.md)",
      "- [Rooted missing](/sub/missing.md)",
      "- [Up](../elsewhere/missing.md)",
      "- [Parent](..)",
      "- [Space](a%20b.md)",
      "- [Bad escape](%E0%A4%A)",
      "- ![Image](missing.png)",
      "- `[Code](missing.md)`",
      "- [Folder](<sub>)",
      '- [Titled](a.md "The A record")',
      "",
      "```",
      "[Fenced](missing.md)",
      "```",
      "",
    ].join("\n");

    // When - checking it
    const hits = findHits({
      code: "W115",
      existing: ["kb/a b.md", "kb/sub"],
      files: { "kb/a.md": concept([]), "kb/index.md": index },
    });

    // Then - the three missing targets
    expect(hits).toStrictEqual([
      {
        line: 7,
        message: 'link target "missing.md" is not in the bundle (§6.1)',
        path: "kb/index.md",
      },
      {
        line: 13,
        message: 'link target "/sub/missing.md" is not in the bundle (§6.1)',
        path: "kb/index.md",
      },
      {
        line: 17,
        message: 'link target "%E0%A4%A" is not in the bundle (§6.1)',
        path: "kb/index.md",
      },
    ]);
  });

  test.each([
    {
      description: "a subfolder index.md to its own file",
      expected: [],
      files: { "kb/sub/b.md": concept([]), "kb/sub/index.md": "- [B](b.md)\n" },
    },
    {
      description: "a subfolder index.md to a missing file",
      expected: ["kb/sub/index.md:2"],
      files: { "kb/sub/index.md": "# Sub\n- [B](b.md)\n" },
    },
    {
      description: "a concept, which isn't an index",
      expected: [],
      files: { "kb/a.md": `${concept([])}\n[Missing](missing.md)\n` },
    },
  ])("checks links in $description", ({ expected, files }) => {
    // When/Then - the lines it reports
    expect(findLines({ code: "W115", files })).toStrictEqual(expected);
  });
});

describe("W116 license-value", () => {
  test.each([
    {
      description: "an SPDX expression",
      expected: [],
      files: {
        "kb/index.md":
          '---\nokf_version: "0.3"\nlicense: MIT OR Apache-2.0\n---\n',
      },
    },
    {
      description: "a file in the bundle",
      expected: [],
      files: {
        "kb/index.md": '---\nokf_version: "0.3"\nlicense: ./LICENSE.txt\n---\n',
        "kb/LICENSE.txt": "",
      },
    },
    {
      description: "no license",
      expected: [],
      files: { "kb/index.md": ROOT_INDEX },
    },
    {
      description: "neither",
      expected: ["kb/index.md:3"],
      files: {
        "kb/index.md":
          '---\nokf_version: "0.3"\nlicense: see the LICENSE file\n---\n',
      },
    },
    {
      description: "a subfolder index.md's license",
      expected: [],
      files: { "kb/sub/index.md": "---\nlicense: not one at all\n---\n" },
    },
  ])("checks $description", ({ expected, files }) => {
    // When/Then - the lines it reports
    expect(findLines({ code: "W116", files })).toStrictEqual(expected);
  });

  test("quotes the license", () => {
    // When - checking a license that's neither
    const hits = findHits({
      code: "W116",
      files: { "kb/index.md": "---\nlicense: mine, all mine\n---\n" },
    });

    // Then - the value, quoted
    expect(hits.map(({ message }) => message)).toStrictEqual([
      'license "mine, all mine" is not an SPDX expression or a file in the bundle (§8.1)',
    ]);
  });
});

describe("W117 string-quoted", () => {
  test.each([
    {
      description: "a plain title",
      expected: [],
      lines: ["title: Plain words"],
    },
    { description: "a quoted number", expected: [], lines: ['title: "1.0"'] },
    { description: "a mapping", expected: [], lines: ["title: { a: 1 }"] },
    { description: "a number", expected: ["kb/a.md:3"], lines: ["title: 1.0"] },
    {
      description: "a boolean",
      expected: ["kb/a.md:3"],
      lines: ["status: true"],
    },
    {
      description: "a hex number",
      expected: ["kb/a.md:3"],
      lines: ["description: 0x1F"],
    },
    {
      description: "an infinity",
      expected: ["kb/a.md:3"],
      lines: ["description: -.inf"],
    },
    {
      description: "an okf_version, outside the root index.md",
      expected: [],
      lines: ["okf_version: 0.3"],
    },
  ])("checks a concept's $description", ({ expected, lines }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "W117", files: { "kb/a.md": concept(lines) } })
    ).toStrictEqual(expected);
  });

  test("checks a number for a type", () => {
    // When - checking a type written as a number
    const hits = findHits({
      code: "W117",
      files: { "kb/a.md": record(["type: 12"]) },
    });

    // Then - the message names the key and value
    expect(hits).toStrictEqual([
      {
        line: 2,
        message:
          "quote type: YAML's core schema reads 12 as a number or a boolean, not a string (§4)",
        path: "kb/a.md",
      },
    ]);
  });

  test.each([
    { description: "a quoted okf_version", expected: [], text: ROOT_INDEX },
    {
      description: "a plain okf_version",
      expected: ["kb/index.md:2"],
      text: "---\nokf_version: 0.3\n---\n",
    },
    {
      description: "a boolean okf_version",
      expected: ["kb/index.md:2"],
      text: "---\nokf_version: true\n---\n",
    },
    {
      description: "no okf_version",
      expected: [],
      text: "---\ntitle: KB\n---\n",
    },
  ])("checks the root index.md's $description", ({ expected, text }) => {
    // When/Then - the lines it reports
    expect(
      findLines({ code: "W117", files: { "kb/index.md": text } })
    ).toStrictEqual(expected);
  });
});

describe("W118 log-date-order", () => {
  test.each([
    {
      description: "dates newest first",
      expected: [],
      log: "# Log\n\n## 2026-01-03\n\n## 2026-01-02\n",
    },
    {
      description: "a date newer than one above it",
      expected: [
        {
          line: 7,
          message:
            "log.md puts the newest date first (§9); 2026-01-04 follows 2026-01-02",
        },
      ],
      log: "## 2026-01-03\n\n## 2026-01-02\n\n## Undated\n\n## 2026-01-04\n",
    },
    {
      description: "a heading that isn't a date first",
      expected: [],
      log: "## Undated\n\n## 2026-01-02\n\n## 2026-01-01\n",
    },
  ])("checks $description", ({ expected, log }) => {
    // When/Then - the findings
    expect(
      findHits({ code: "W118", files: { "kb/log.md": log } }).map(
        ({ line, message }) => ({ line, message })
      )
    ).toStrictEqual(expected);
  });
});

describe("W120 not-a-concept", () => {
  test.each([
    {
      description: "a concept",
      expected: [],
      text: concept([]),
    },
    {
      description: "no frontmatter",
      expected: ["not a concept: the file has no frontmatter (§3.2)"],
      text: "# A\n",
    },
    {
      description: "no type",
      expected: ["not a concept: the frontmatter has no non-empty type (§3.2)"],
      text: record(["title: A"]),
    },
    {
      description: "an empty block",
      expected: ["not a concept: the frontmatter has no non-empty type (§3.2)"],
      text: "---\n---\n# A\n",
    },
    {
      description: "a blank type",
      expected: ["not a concept: the frontmatter has no non-empty type (§3.2)"],
      text: record(['type: "  "']),
    },
    {
      description: "a type that's a mapping",
      expected: ["not a concept: the frontmatter has no non-empty type (§3.2)"],
      text: record(["type: { name: Decision }"]),
    },
    {
      description: "frontmatter that doesn't parse, which E002 reports",
      expected: [],
      text: "---\ntype: [\n---\n",
    },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - the messages it reports
    expect(
      findHits({ code: "W120", files: { "kb/a.md": text } }).map(
        ({ message }) => message
      )
    ).toStrictEqual(expected);
  });

  test("checks only concepts, not index.md or log.md", () => {
    // When/Then - nothing for either without frontmatter
    expect(
      findLines({
        code: "W120",
        files: { "kb/index.md": "# KB\n", "kb/log.md": "# Log\n" },
      })
    ).toStrictEqual([]);
  });
});

describe("W122 date-only-trust-time", () => {
  test.each([
    {
      description: "a date-only generated.at",
      expected: [
        "write generated.at as a date-time, because consumers compare generated.at with verified[].at (§5)",
      ],
      lines: ["generated: { by: claude-code/1.0, at: 2026-10-01 }"],
    },
    {
      description: "a date-only verified[].at",
      expected: [
        "write verified[0].at as a date-time, because consumers compare generated.at with verified[].at (§5)",
      ],
      lines: ["verified: [{ by: human:a, at: 2026-10-02 }]"],
    },
    {
      description: "date-times",
      expected: [],
      lines: [
        "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
        "verified: [{ by: human:a, at: 2026-10-02T15:00:00Z }]",
      ],
    },
    {
      description: "a date that isn't real, which W101 reports",
      expected: [],
      lines: ["generated: { by: claude-code/1.0, at: 2026-02-30 }"],
    },
    {
      description: "an at that's a mapping",
      expected: [],
      lines: ["generated: { by: claude-code/1.0, at: { day: 1 } }"],
    },
  ])("checks $description", ({ expected, lines }) => {
    // When/Then - the messages it reports
    expect(
      findHits({ code: "W122", files: { "kb/a.md": concept(lines) } }).map(
        ({ message }) => message
      )
    ).toStrictEqual(expected);
  });
});

describe("W125 bundle-version", () => {
  test.each([
    {
      bundleDir: "kb",
      description: "a bundle with no root index.md",
      expected: [
        {
          line: null,
          message: 'add a bundle-root index.md with okf_version: "0.3" (§8.1)',
          path: "kb/index.md",
        },
      ],
      files: { "kb/a.md": concept([]), "kb/sub/index.md": "# Sub\n" },
    },
    {
      bundleDir: ".",
      description: "the bundle `.` with no root index.md",
      expected: [
        {
          line: null,
          message: 'add a bundle-root index.md with okf_version: "0.3" (§8.1)',
          path: "index.md",
        },
      ],
      files: { "a.md": concept([]) },
    },
    {
      bundleDir: "kb",
      description: "a root index.md with no frontmatter",
      expected: [
        {
          line: 1,
          message:
            'give the root index.md frontmatter with okf_version: "0.3" (§8.1)',
          path: "kb/index.md",
        },
      ],
      files: { "kb/index.md": "# KB\n" },
    },
    {
      bundleDir: "kb",
      description: "a root index.md with an empty okf_version",
      expected: [
        {
          line: 1,
          message: 'add okf_version: "0.3" to the root index.md (§8.1)',
          path: "kb/index.md",
        },
      ],
      files: { "kb/index.md": '---\nokf_version: ""\n---\n' },
    },
    {
      bundleDir: "kb",
      description: "a root index.md with empty frontmatter",
      expected: [
        {
          line: 1,
          message: 'add okf_version: "0.3" to the root index.md (§8.1)',
          path: "kb/index.md",
        },
      ],
      files: { "kb/index.md": "---\n---\n# KB\n" },
    },
    {
      bundleDir: "kb",
      description: "a root index.md that doesn't parse, which E002 reports",
      expected: [],
      files: { "kb/index.md": "---\nokf_version: [\n---\n" },
    },
    {
      bundleDir: "kb",
      description: "a root index.md with okf_version",
      expected: [],
      files: { "kb/index.md": ROOT_INDEX },
    },
  ])("checks $description", ({ bundleDir, expected, files }) => {
    // When/Then - the findings
    expect(findHits({ bundleDir, code: "W125", files })).toStrictEqual(
      expected
    );
  });
});
