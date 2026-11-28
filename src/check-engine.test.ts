import { describe, expect, test } from "vitest";
import { isMap, Scalar } from "yaml";

import type { CheckedFile, CheckRule } from "./check-engine.ts";

import {
  buildCheckReport,
  CHECK_SCHEMA_VERSION,
  readCheckedFile,
  readNodeLine,
} from "./check-engine.ts";

/** Read a file in the bundle `kb`, where nothing else exists. */
function readFile(params: {
  /**
   * Its path from the repo root.
   *
   * @example "kb/a.md"
   */
  filePath: string;

  /**
   * Its text.
   *
   * @example `"---\ntype: Decision\n---\n"`
   */
  text: string;
}): CheckedFile {
  return readCheckedFile({
    ...params,
    bundleDir: "kb",
    doesExist: () => false,
  });
}

describe("readCheckedFile", () => {
  test("knows no changes to any path when none are given", () => {
    // When - reading a file with no history
    const file = readFile({ filePath: "kb/a.md", text: "" });

    // Then - no changes to it or to another path
    expect([
      file.readChanges("kb/a.md"),
      file.readChanges("src"),
    ]).toStrictEqual([[], []]);
  });

  test.each([
    { description: "an index.md", filePath: "kb/index.md", kind: "index" },
    { description: "a log.md", filePath: "kb/sub/log.md", kind: "log" },
    { description: "any other file", filePath: "kb/a.md", kind: "markdown" },
  ])("names $description by its kind", ({ filePath, kind }) => {
    // When/Then - the kind its name gives it
    expect(readFile({ filePath, text: "" }).kind).toBe(kind);
  });

  test.each([
    {
      bundleDir: "kb",
      description: "a file directly in the bundle",
      filePath: "kb/a.md",
      isAtBundleRoot: true,
    },
    {
      bundleDir: "kb",
      description: "a file in a subfolder",
      filePath: "kb/sub/a.md",
      isAtBundleRoot: false,
    },
    {
      bundleDir: ".",
      description: "a file at the repo root, in the bundle `.`",
      filePath: "a.md",
      isAtBundleRoot: true,
    },
    {
      bundleDir: ".",
      description: "a file in a folder, in the bundle `.`",
      filePath: "sub/a.md",
      isAtBundleRoot: false,
    },
  ])("places $description", ({ bundleDir, filePath, isAtBundleRoot }) => {
    // When - reading it
    const file = readCheckedFile({
      bundleDir,
      doesExist: () => false,
      filePath,
      text: "",
    });

    // Then - whether it sits at the bundle's root
    expect(file.isAtBundleRoot).toBe(isAtBundleRoot);
  });

  test.each([
    { description: "a fence", doesOpenWithFence: true, text: "---\n# A\n" },
    {
      description: "a fence after a byte order mark",
      doesOpenWithFence: true,
      text: "﻿---\n# A\n",
    },
    {
      description: "a fence ending in CRLF",
      doesOpenWithFence: true,
      text: "---\r\n# A\r\n",
    },
    { description: "a fence alone", doesOpenWithFence: true, text: "---" },
    {
      description: "a fence with a trailing space",
      doesOpenWithFence: false,
      text: "--- \n# A\n",
    },
    { description: "a heading", doesOpenWithFence: false, text: "# A\n---\n" },
  ])(
    "reads whether it opens with $description",
    ({ doesOpenWithFence, text }) => {
      // When/Then - whether its first line is a fence
      expect(readFile({ filePath: "kb/a.md", text }).doesOpenWithFence).toBe(
        doesOpenWithFence
      );
    }
  );

  test("reads no frontmatter as absent", () => {
    // When/Then - absent
    expect(
      readFile({ filePath: "kb/a.md", text: "# A\n" }).frontmatter
    ).toStrictEqual({ kind: "absent" });
  });

  test.each([
    {
      description: "a fence that never closes",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 1,
        reason: "the frontmatter has no closing `---` line",
      },
      text: "---\ntype: Decision\n",
    },
    {
      description: "a first line that only starts like a fence",
      expected: { kind: "absent" },
      text: "--- \ntype: Decision\n---\n",
    },
    {
      description: "YAML that doesn't parse",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 4,
        reason: expect.stringMatching(/^Flow sequence/u) as unknown,
      },
      text: "---\ntype: Decision\ntags: [a\n---\n",
    },
    {
      description: "a key given twice",
      expected: {
        isDuplicateKey: true,
        kind: "broken",
        line: 3,
        reason: "Map keys must be unique",
      },
      text: "---\ntype: Decision\ntype: Note\n---\n",
    },
    {
      description: "a list, not a mapping",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 2,
        reason: "it isn't a mapping of keys to values",
      },
      text: "---\n- a\n- b\n---\n",
    },
    {
      description: "an alias before its anchor, in CRLF text",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 3,
        reason: "the alias `*t` names no anchor set before it",
      },
      text: "---\r\ntype: Decision\r\ntitle: *t\r\ndescription: &t A\r\n---\r\n",
    },
    {
      description: "an anchor set a second time",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 4,
        reason: "the anchor `&t` is set a second time",
      },
      text: "---\ntype: Decision\ntitle: &t A\ndescription: &t B\n---\n",
    },
    {
      description: "a block map's anchor set a second time",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 3,
        reason: "the anchor `&t` is set a second time",
      },
      text: "---\ntitle: &t A\ngenerated: &t\n  by: human:a\n---\n",
    },
    {
      description: "a key given twice before an alias with no anchor",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 4,
        reason: "the alias `*t` names no anchor set before it",
      },
      text: "---\ntype: A\ntype: B\ntitle: *t\n---\n",
    },
    {
      description: "a key given twice before YAML that doesn't parse",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 5,
        reason: expect.stringMatching(/^Flow sequence/u) as unknown,
      },
      text: "---\ntype: A\ntype: B\ntags: [a\n---\n",
    },
    {
      description: "an alias with no anchor before YAML that doesn't parse",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 2,
        reason: "the alias `*t` names no anchor set before it",
      },
      text: "---\ntitle: *t\ntags: [a\n---\n",
    },
    {
      description: "YAML that doesn't parse before an anchor set again",
      expected: {
        isDuplicateKey: false,
        kind: "broken",
        line: 3,
        reason: expect.stringMatching(/^Nested mappings/u) as unknown,
      },
      text: "---\ntitle: &t A\ntype: a: b\ndescription: &t B\n---\n",
    },
  ])("reads $description as broken", ({ expected, text }) => {
    // When/Then - broken, with the line and why
    expect(readFile({ filePath: "kb/a.md", text }).frontmatter).toStrictEqual(
      expected
    );
  });

  test("reads a mapping as parsed", () => {
    // When - reading a record with frontmatter
    const { frontmatter } = readFile({
      filePath: "kb/a.md",
      text: "---\ntype: Decision\n---\n",
    });

    // Then - parsed, with the mapping and where it starts
    expect(frontmatter.kind).toBe("parsed");
    expect(frontmatter.kind === "parsed" && isMap(frontmatter.map)).toBe(true);
    expect(frontmatter.kind === "parsed" && frontmatter.start).toBe(4);
  });

  test("reads an empty block as parsed, with no mapping", () => {
    // When - reading a record whose frontmatter is empty
    const { frontmatter } = readFile({
      filePath: "kb/a.md",
      text: "---\n---\n",
    });

    // Then - parsed, with no mapping
    expect(frontmatter.kind).toBe("parsed");
    expect(frontmatter.kind === "parsed" && frontmatter.map).toBeUndefined();
  });
});

describe("readNodeLine", () => {
  test("finds the line of a node in the frontmatter", () => {
    // Given - a record whose title is on line 3
    const file = readFile({
      filePath: "kb/a.md",
      text: "---\ntype: Decision\ntitle: A\n---\n",
    });
    const map =
      file.frontmatter.kind === "parsed" ? file.frontmatter.map : undefined;

    // When/Then - line 3
    expect(readNodeLine({ file, node: map?.get("title", true) })).toBe(3);
  });

  test.each([
    {
      description: "a node with no position",
      file: (): CheckedFile =>
        readFile({ filePath: "kb/a.md", text: "---\ntype: Decision\n---\n" }),
      node: new Scalar("x"),
    },
    {
      description: "a value that isn't a node",
      file: (): CheckedFile =>
        readFile({ filePath: "kb/a.md", text: "---\ntype: Decision\n---\n" }),
      node: "x",
    },
    {
      description: "a file with no parsed frontmatter",
      file: (): CheckedFile => readFile({ filePath: "kb/a.md", text: "# A\n" }),
      node: new Scalar("x"),
    },
  ])("falls back to line 1 for $description", ({ file, node }) => {
    // When/Then - the first line
    expect(readNodeLine({ file: file(), node })).toBe(1);
  });
});

describe("buildCheckReport", () => {
  test("runs file and bundle rules, sorted by path then line", () => {
    // Given - two bundles, and rules finding things in both, some file-wide
    const bundles = [
      {
        bundleDir: "kb",
        files: [
          readFile({ filePath: "kb/b.md", text: "" }),
          readFile({ filePath: "kb/a.md", text: "" }),
        ],
      },
      { bundleDir: "notes", files: [] },
    ];
    const rules: CheckRule[] = [
      {
        checkBundle: (bundle) => [
          { line: null, message: "missing", path: `${bundle.bundleDir}/a.md` },
        ],
        code: "E001",
        name: "bundle-rule",
        severity: "error",
      },
      {
        checkFile: (file) => [
          { line: 3, message: `late in ${file.filePath}` },
          { line: null, message: `all of ${file.filePath}` },
          { line: 1, message: `early in ${file.filePath}` },
        ],
        code: "W001",
        name: "file-rule",
        severity: "warning",
      },
      { code: "I001", name: "silent-rule", severity: "info" },
    ];

    // When - building the report
    const report = buildCheckReport({
      bundles,
      rules,
      skipped: [{ path: "kb/c.md", reason: "kb/c.md can't be read" }],
    });

    // Then - each bundle's findings in order, then the totals
    const warning = { code: "W001", rule: "file-rule", severity: "warning" };
    const error = { code: "E001", rule: "bundle-rule", severity: "error" };

    expect(report).toStrictEqual({
      counts: { error: 2, info: 0, warning: 6 },
      filesChecked: 2,
      findings: [
        { ...error, line: null, message: "missing", path: "kb/a.md" },
        { ...warning, line: null, message: "all of kb/a.md", path: "kb/a.md" },
        { ...warning, line: 1, message: "early in kb/a.md", path: "kb/a.md" },
        { ...warning, line: 3, message: "late in kb/a.md", path: "kb/a.md" },
        { ...warning, line: null, message: "all of kb/b.md", path: "kb/b.md" },
        { ...warning, line: 1, message: "early in kb/b.md", path: "kb/b.md" },
        { ...warning, line: 3, message: "late in kb/b.md", path: "kb/b.md" },
        { ...error, line: null, message: "missing", path: "notes/a.md" },
      ],
      schemaVersion: CHECK_SCHEMA_VERSION,
      skipped: [{ path: "kb/c.md", reason: "kb/c.md can't be read" }],
    });
  });

  test("reports nothing for no bundles", () => {
    // When/Then - an empty report
    expect(
      buildCheckReport({ bundles: [], rules: [], skipped: [] })
    ).toStrictEqual({
      counts: { error: 0, info: 0, warning: 0 },
      filesChecked: 0,
      findings: [],
      schemaVersion: CHECK_SCHEMA_VERSION,
      skipped: [],
    });
  });
});
