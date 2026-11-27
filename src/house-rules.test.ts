import { describe, expect, test } from "vitest";

import { record } from "#test/repo";

import type { HouseRules } from "./house-rules.ts";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { buildHouseRules, readHouseRules } from "./house-rules.ts";

/** A record of the type `Decision`, with more frontmatter lines. */
function concept(lines: readonly string[]): string {
  return record(["type: Decision", ...lines]);
}

/**
 * Run the house rules over files in the bundle `kb`, and keep each finding
 * as `path:line code`.
 */
function findLines(params: {
  /**
   * The bundle's files, by path from the repo root.
   *
   * @example `{ "kb/a.md": "# A\n" }`
   */
  files: Readonly<Record<string, string>>;

  /**
   * The rules turned on.
   *
   * @example `{ "tags-sorted": "error" }`
   */
  rules: HouseRules;
}): string[] {
  const { files, rules } = params;
  const doesExist = (filePath: string): boolean => filePath in files;
  const report = buildCheckReport({
    bundles: [
      {
        bundleDir: "kb",
        files: Object.entries(files).map(([filePath, text]) =>
          readCheckedFile({ bundleDir: "kb", doesExist, filePath, text })
        ),
      },
    ],
    rules: buildHouseRules(rules),
    skipped: [],
  });

  return report.findings.map(
    ({ code, line, path }) => `${path}:${String(line)} ${code}`
  );
}

/** A concept with these tags, one per block-list line. */
function tagged(tags: readonly string[]): string {
  return concept(["tags:", ...tags.map((tag) => `  - ${tag}`)]);
}

describe("buildHouseRules", () => {
  test("runs nothing when no rule is turned on", () => {
    // When/Then - no rules
    expect(buildHouseRules({})).toStrictEqual([]);
  });

  test("names each rule turned on, at its level, in code order", () => {
    // When - turning two on
    const rules = buildHouseRules({
      "tags-count": { level: "error", max: 10, min: 5 },
      "tags-required": "warn",
    });

    // Then - their codes, names and severities
    expect(
      rules.map(({ code, name, severity }) => ({ code, name, severity }))
    ).toStrictEqual([
      { code: "H001", name: "tags-required", severity: "warning" },
      { code: "H006", name: "tags-count", severity: "error" },
    ]);
  });
});

describe("readHouseRules", () => {
  test.each([
    { description: "no rules", expected: {}, value: undefined },
    {
      description: "a level",
      expected: { wikilink: "warn" },
      value: { wikilink: "warn" },
    },
    { description: "off", expected: {}, value: { wikilink: "off" } },
    {
      description: "a level in a list",
      expected: { wikilink: "error" },
      value: { wikilink: ["error"] },
    },
    {
      description: "tags-count's defaults",
      expected: { "tags-count": { level: "warn", max: 10, min: 5 } },
      value: { "tags-count": "warn" },
    },
    {
      description: "tags-count's bounds",
      expected: { "tags-count": { level: "warn", max: 3, min: 3 } },
      value: { "tags-count": ["warn", { max: 3, min: 3 }] },
    },
    {
      description: "tags-layout's default",
      expected: { "tags-layout": { layout: "any", level: "warn" } },
      value: { "tags-layout": "warn" },
    },
    {
      description: "tags-layout's layout",
      expected: { "tags-layout": { layout: "block", level: "error" } },
      value: { "tags-layout": ["error", { layout: "block" }] },
    },
    {
      description: "key-order's order",
      expected: { "key-order": { level: "warn", order: ["type", "title"] } },
      value: { "key-order": ["warn", { order: ["type", "title"] }] },
    },
    {
      description: "tags-vocabulary's tags",
      expected: { "tags-vocabulary": { level: "warn", tags: ["a", "b"] } },
      value: { "tags-vocabulary": ["warn", { tags: ["a", "b"] }] },
    },
    {
      description: "a rule turned off with options",
      expected: {},
      value: { "tags-vocabulary": ["off", { tags: [] }] },
    },
  ])("reads $description", ({ expected, value }) => {
    // When/Then - the rules turned on
    expect(readHouseRules(value)).toStrictEqual({
      isOk: true,
      rules: expected,
    });
  });

  test.each([
    {
      description: "a value that isn't an object",
      reason: "`okf.rules` in package.json must be an object of rule levels.",
      value: ["wikilink"],
    },
    {
      description: "an unknown rule",
      reason:
        "`okf.rules` in package.json: there's no house rule \"tag-case\"; they're index-entry-missing, index-entry-order, index-entry-stale, key-order, source-uncited, sources-sorted, tags-count, tags-kebab-case, tags-layout, tags-required, tags-sorted, tags-vocabulary, wikilink.",
      value: { "tag-case": "warn" },
    },
    {
      description: "an unknown level",
      reason:
        '`okf.rules` in package.json: "wikilink" must be "off", "warn", "error", or [level, { options }].',
      value: { wikilink: "warning" },
    },
    {
      description: "an empty list",
      reason:
        '`okf.rules` in package.json: "wikilink" must be "off", "warn", "error", or [level, { options }].',
      value: { wikilink: [] },
    },
    {
      description: "options that aren't an object",
      reason:
        '`okf.rules` in package.json: "tags-layout" must be "off", "warn", "error", or [level, { options }].',
      value: { "tags-layout": ["warn", "block"] },
    },
    {
      description: "a third item",
      reason:
        '`okf.rules` in package.json: "tags-layout" must be "off", "warn", "error", or [level, { options }].',
      value: { "tags-layout": ["warn", {}, {}] },
    },
    {
      description: "options on a rule that takes none",
      reason:
        '`okf.rules` in package.json: "wikilink" takes no options, not "strict".',
      value: { wikilink: ["warn", { strict: true }] },
    },
    {
      description: "an option a rule doesn't take",
      reason:
        '`okf.rules` in package.json: "tags-count" takes only max, min, not "least".',
      value: { "tags-count": ["warn", { least: 2 }] },
    },
    {
      description: "a min past the max",
      reason:
        '`okf.rules` in package.json: "tags-count" takes a whole-number min and max, min no more than max.',
      value: { "tags-count": ["warn", { max: 2, min: 3 }] },
    },
    {
      description: "a min that isn't a count",
      reason:
        '`okf.rules` in package.json: "tags-count" takes a whole-number min and max, min no more than max.',
      value: { "tags-count": ["warn", { min: 1.5 }] },
    },
    {
      description: "a max that isn't a count",
      reason:
        '`okf.rules` in package.json: "tags-count" takes a whole-number min and max, min no more than max.',
      value: { "tags-count": ["warn", { max: "10" }] },
    },
    {
      description: "an unknown layout",
      reason:
        '`okf.rules` in package.json: "tags-layout" takes a layout of any, block, flow.',
      value: { "tags-layout": ["warn", { layout: "inline" }] },
    },
    {
      description: "a key order with no keys",
      reason:
        '`okf.rules` in package.json: "key-order" needs its keys, each once, as [level, { "order": [...] }].',
      value: { "key-order": "warn" },
    },
    {
      description: "an empty key order",
      reason:
        '`okf.rules` in package.json: "key-order" needs its keys, each once, as [level, { "order": [...] }].',
      value: { "key-order": ["warn", { order: [] }] },
    },
    {
      description: "a key order that isn't text",
      reason:
        '`okf.rules` in package.json: "key-order" needs its keys, each once, as [level, { "order": [...] }].',
      value: { "key-order": ["warn", { order: [1] }] },
    },
    {
      description: "a key order naming a key twice",
      reason:
        '`okf.rules` in package.json: "key-order" needs its keys, each once, as [level, { "order": [...] }].',
      value: { "key-order": ["warn", { order: ["type", "type"] }] },
    },
    {
      description: "a vocabulary with no tags",
      reason:
        '`okf.rules` in package.json: "tags-vocabulary" needs its tags, as [level, { "tags": [...] }].',
      value: { "tags-vocabulary": "warn" },
    },
    {
      description: "an empty vocabulary",
      reason:
        '`okf.rules` in package.json: "tags-vocabulary" needs its tags, as [level, { "tags": [...] }].',
      value: { "tags-vocabulary": ["warn", { tags: [] }] },
    },
    {
      description: "a vocabulary that isn't text",
      reason:
        '`okf.rules` in package.json: "tags-vocabulary" needs its tags, as [level, { "tags": [...] }].',
      value: { "tags-vocabulary": ["warn", { tags: [1] }] },
    },
  ])("refuses $description", ({ reason, value }) => {
    // When/Then - refused, naming the rule
    expect(readHouseRules(value)).toStrictEqual({ isOk: false, reason });
  });
});

describe("H001 tags-required", () => {
  test.each([
    { description: "a record with tags", expected: [], text: tagged(["a"]) },
    {
      description: "a record with one bare tag",
      expected: [],
      text: concept(["tags: a"]),
    },
    {
      description: "a record with no tags",
      expected: ["kb/a.md:1 H001"],
      text: concept([]),
    },
    {
      description: "a record with an empty list",
      expected: ["kb/a.md:3 H001"],
      text: concept(["tags: []"]),
    },
    { description: "a file that isn't a concept", expected: [], text: "# A\n" },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - what it reports
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: { "tags-required": "warn" },
      })
    ).toStrictEqual(expected);
  });
});

describe("H002 tags-sorted", () => {
  test.each([
    { description: "sorted tags", expected: [], text: tagged(["a", "b", "c"]) },
    {
      description: "tags out of order, at the first",
      expected: ["kb/a.md:6 H002"],
      text: tagged(["a", "c", "b", "a"]),
    },
    {
      description: "a nested value between sorted tags",
      expected: [],
      text: tagged(["a", "[x]", "b"]),
    },
    { description: "no tags", expected: [], text: concept([]) },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - what it reports
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: { "tags-sorted": "warn" },
      })
    ).toStrictEqual(expected);
  });
});

describe("H003 tags-kebab-case", () => {
  test("reports each tag that isn't kebab-case", () => {
    // Given - one of each
    const text = tagged([
      "open-knowledge",
      "OKF",
      "two words",
      "trailing-",
      "v2",
      "[x]",
    ]);

    // When/Then - the three bad ones
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: { "tags-kebab-case": "error" },
      })
    ).toStrictEqual(["kb/a.md:5 H003", "kb/a.md:6 H003", "kb/a.md:7 H003"]);
  });
});

describe("H004 tags-vocabulary", () => {
  test("reports each tag outside the vocabulary", () => {
    // Given - a vocabulary and a record with one tag outside it
    const rules: HouseRules = {
      "tags-vocabulary": { level: "warn", tags: ["a", "b"] },
    };

    // When/Then - that tag
    expect(
      findLines({ files: { "kb/a.md": tagged(["a", "c", "b"]) }, rules })
    ).toStrictEqual(["kb/a.md:5 H004"]);
  });
});

describe("H005 tags-layout", () => {
  test.each([
    {
      description: "a block list under block",
      expected: [],
      layout: "block",
      text: tagged(["a"]),
    },
    {
      description: "a flow list under block",
      expected: ["kb/a.md:3 H005"],
      layout: "block",
      text: concept(["tags: [a]"]),
    },
    {
      description: "a flow list under flow",
      expected: [],
      layout: "flow",
      text: concept(["tags: [a]"]),
    },
    {
      description: "a block list under flow",
      expected: ["kb/a.md:4 H005"],
      layout: "flow",
      text: tagged(["a"]),
    },
    {
      description: "a flow list under any",
      expected: [],
      layout: "any",
      text: concept(["tags: [a]"]),
    },
    {
      description: "a single tag under block",
      expected: [],
      layout: "block",
      text: concept(["tags: a"]),
    },
    {
      description: "an empty list under block",
      expected: [],
      layout: "block",
      text: concept(["tags: []"]),
    },
  ] as const)("checks $description", ({ expected, layout, text }) => {
    // When/Then - what it reports
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: { "tags-layout": { layout, level: "warn" } },
      })
    ).toStrictEqual(expected);
  });
});

describe("H006 tags-count", () => {
  test.each([
    { description: "too few", expected: ["kb/a.md:4 H006"], tags: ["a"] },
    { description: "the minimum", expected: [], tags: ["a", "b"] },
    { description: "the maximum", expected: [], tags: ["a", "b", "c"] },
    {
      description: "too many",
      expected: ["kb/a.md:4 H006"],
      tags: ["a", "b", "c", "d"],
    },
    {
      description: "too few once a nested value is left out",
      expected: ["kb/a.md:4 H006"],
      tags: ["a", "[b, c]"],
    },
  ])("checks $description", ({ expected, tags }) => {
    // When/Then - what it reports, between 2 and 3
    expect(
      findLines({
        files: { "kb/a.md": tagged(tags) },
        rules: { "tags-count": { level: "warn", max: 3, min: 2 } },
      })
    ).toStrictEqual(expected);
  });
});

describe("H007, H008 and H009 index entries", () => {
  /** Every index rule, at `warn`. */
  const INDEX_RULES: HouseRules = {
    "index-entry-missing": "warn",
    "index-entry-order": "warn",
    "index-entry-stale": "warn",
  };

  /** A concept with a title and a description. */
  function described(title: string, description: string): string {
    return concept([`title: ${title}`, `description: ${description}`]);
  }

  test("finds nothing in an index okf index wrote", () => {
    // Given - two records, listed as okf index lists them
    const files = {
      "kb/a.md": concept([
        "title: Alpha",
        "description: The first.",
        "tags: [x]",
      ]),
      "kb/b.md": described("Beta", "The second."),
      "kb/index.md":
        "# KB\n\n- [Alpha](a.md) - The first.\n- [Beta](b.md) - The second.\n",
    };

    // When/Then - nothing
    expect(findLines({ files, rules: INDEX_RULES })).toStrictEqual([]);
  });

  test("reports a missing record on the record, and a stale or misordered line on the index", () => {
    // Given - one record unlisted, one line stale, and two lines out of order
    const files = {
      "kb/a.md": described("Alpha", "The first."),
      "kb/b.md": described("Beta", "The second."),
      "kb/c.md": described("Gamma", "The third."),
      "kb/d.md": described("Delta", "The fourth."),
      "kb/index.md":
        '---\nokf_version: "0.3"\n---\n# KB\n\n- [Beta](b.md) - Old.\n- [Alpha](a.md) - The first.\n- [Gamma](c.md) - The third.\n',
    };

    // When/Then - one of each, on the records, the order on the line that
    // sorts before the one above it
    expect(findLines({ files, rules: INDEX_RULES })).toStrictEqual([
      "kb/a.md:1 H009",
      "kb/b.md:1 H008",
      "kb/d.md:1 H007",
    ]);
  });

  test("lists a record in its nearest index", () => {
    // Given - a subfolder with its own index, and one without
    const files = {
      "kb/index.md": "# KB\n\n- [Top](top.md) - Top.\n",
      "kb/other/c.md": described("Other", "Other."),
      "kb/sub/b.md": described("Sub", "Sub."),
      "kb/sub/index.md": "# Sub\n",
      "kb/top.md": described("Top", "Top."),
    };

    // When/Then - each missing from its own nearest index
    expect(findLines({ files, rules: INDEX_RULES })).toStrictEqual([
      "kb/other/c.md:1 H007",
      "kb/sub/b.md:1 H007",
    ]);
  });

  test("finds nothing for a record with no index up to the bundle", () => {
    // When/Then - nothing to list it in
    expect(
      findLines({
        files: {
          "kb/a.md": described("A", "A."),
          "kb/sub/index.md": "# Sub\n",
        },
        rules: INDEX_RULES,
      })
    ).toStrictEqual([]);
  });

  test("names the record and the fix", () => {
    // Given - a stale line
    const files = {
      "kb/a.md": described("Alpha", "The first."),
      "kb/index.md": "- [Alpha](a.md) - Old.\n",
    };
    const report = buildCheckReport({
      bundles: [
        {
          bundleDir: "kb",
          files: Object.entries(files).map(([filePath, text]) =>
            readCheckedFile({
              bundleDir: "kb",
              doesExist: (p) => p in files,
              filePath,
              text,
            })
          ),
        },
      ],
      rules: buildHouseRules({
        "index-entry-missing": "warn",
        "index-entry-order": "warn",
        "index-entry-stale": "warn",
      }),
      skipped: [],
    });

    // When/Then - the message
    expect(report.findings.map(({ message }) => message)).toStrictEqual([
      "its line in kb/index.md:1 differs from the record's title or description; run okf index",
    ]);
  });
});

describe("H007, H008 and H009 on an index okf index can't read", () => {
  test("say so under each rule turned on", () => {
    // Given - a tag index that never closes
    const files = {
      "kb/a.md": concept(["title: A"]),
      "kb/index.md": "- [Old](a.md)\n<!-- tag-index:start -->\n",
    };

    // When/Then - one finding a rule, on the index
    expect(
      findLines({
        files,
        rules: { "index-entry-missing": "warn", "index-entry-stale": "error" },
      })
    ).toStrictEqual(["kb/index.md:1 H007", "kb/index.md:1 H008"]);
  });
});

describe("H010 source-uncited", () => {
  test.each([
    {
      description: "a source a footnote cites",
      expected: [],
      text: concept(["sources:", "  - id: spec"]) + "\nA claim.[^spec]\n",
    },
    {
      description: "a source nothing cites",
      expected: ["kb/a.md:4 H010"],
      text: concept(["sources:", "  - id: spec"]),
    },
    {
      description: "a source only a footnote definition names",
      expected: ["kb/a.md:4 H010"],
      text: concept(["sources:", "  - id: spec"]) + "\n[^spec]: The spec.\n",
    },
    {
      description: "a source with no id",
      expected: [],
      text: concept(["sources:", "  - resource: https://example.com"]),
    },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - what it reports
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: { "source-uncited": "warn" },
      })
    ).toStrictEqual(expected);
  });
});

describe("H012 key-order", () => {
  test.each([
    {
      description: "keys in order, unlisted keys after them",
      expected: [],
      text: concept(["title: A", "status: draft", "x-acme: a"]),
    },
    {
      description: "an unlisted key between listed ones",
      expected: ["kb/a.md:4 H012"],
      text: concept(["x-acme: a", "title: A"]),
    },
    {
      description:
        "a key ahead of one listed before it, at the key that belongs there",
      expected: ["kb/a.md:4 H012"],
      text: concept(["status: draft", "title: A"]),
    },
    {
      description: "an unlisted key ahead of every listed one",
      expected: ["kb/a.md:3 H012"],
      text: concept(["x-acme: a", "title: A"]).replace(
        "type: Decision\nx-acme: a",
        "x-acme: a\ntype: Decision"
      ),
    },
    {
      description: "a key that isn't a single value",
      expected: [],
      text: concept(["status: draft", "? [a]", ": b", "title: A"]),
    },
    {
      description: "a file that isn't a concept",
      expected: [],
      text: record(["status: draft", "title: A"]),
    },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - what it reports
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: {
          "key-order": { level: "warn", order: ["type", "title", "status"] },
        },
      })
    ).toStrictEqual(expected);
  });
});

describe("H011 wikilink", () => {
  test.each([
    {
      description: "a Markdown link",
      expected: [],
      text: `${concept([])}\n[B](b.md)\n`,
    },
    {
      description: "two wikilinks on a line",
      expected: ["kb/a.md:9 H011", "kb/a.md:9 H011"],
      text: `${concept([])}\n[[B]] and [[C]]\n`,
    },
    {
      description: "a wikilink in code",
      expected: [],
      text: `${concept([])}\n\`[[B]]\`\n`,
    },
    {
      description: "a file that isn't a concept",
      expected: [],
      text: "# A\n\n[[B]]\n",
    },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - what it reports
    expect(
      findLines({ files: { "kb/a.md": text }, rules: { wikilink: "warn" } })
    ).toStrictEqual(expected);
  });
});

describe("H013 sources-sorted", () => {
  test.each([
    {
      description: "sources sorted by id",
      expected: [],
      text: concept(["sources:", "  - id: a", "  - id: b"]),
    },
    {
      description: "sources out of order, at the first",
      expected: ["kb/a.md:7 H013"],
      text: concept([
        "sources:",
        "  - id: a",
        "    resource: https://example.com",
        "  - id: c",
        "  - id: b",
        "  - id: a",
      ]),
    },
    {
      description: "a source with no id between sorted ones",
      expected: [],
      text: concept([
        "sources:",
        "  - id: a",
        "  - resource: https://example.com",
        "  - id: b",
      ]),
    },
    { description: "no sources", expected: [], text: concept([]) },
  ])("checks $description", ({ expected, text }) => {
    // When/Then - what it reports
    expect(
      findLines({
        files: { "kb/a.md": text },
        rules: { "sources-sorted": "warn" },
      })
    ).toStrictEqual(expected);
  });

  test("names the source out of place and the one above it", () => {
    // Given - two sources out of order
    const text = concept(["sources:", "  - id: b", "  - id: a"]);

    // When - checking it
    const report = buildCheckReport({
      bundles: [
        {
          bundleDir: "kb",
          files: [
            readCheckedFile({
              bundleDir: "kb",
              doesExist: () => true,
              filePath: "kb/a.md",
              text,
            }),
          ],
        },
      ],
      rules: buildHouseRules({ "sources-sorted": "error" }),
      skipped: [],
    });

    // Then - the message, at error
    expect(
      report.findings.map(({ message, severity }) => ({ message, severity }))
    ).toStrictEqual([
      {
        message: 'sources aren\'t sorted by `id`: "a" comes after "b"',
        severity: "error",
      },
    ]);
  });
});
