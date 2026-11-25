import { describe, expect, test } from "vitest";

import type { BundlePlan, MigrateNote, PlannedFile } from "./migrate-plan.ts";

import { planBundle } from "./migrate-plan.ts";

/** Why frontmatter with an anchor or alias is refused. */
const ANCHORS_MESSAGE =
  "uses YAML anchors or aliases, which okf migrate doesn't edit, since a change would reach every alias; edit it by hand";

/** The fabricated bundle's folder, from the repo root. */
const BUNDLE = "docs/kb";

/** The bundle's root index.md's path, from the repo root. */
const INDEX_PATH = "docs/kb/index.md";

/** A v0.2 root index.md that already has a title and a description. */
const INDEX = `---
okf_version: "0.2"
title: Knowledge
description: What we know.
---

# Knowledge
`;

/** That index once migrated. */
const MIGRATED_INDEX = INDEX.replace('"0.2"', '"0.3"');

/** The record the record tests plan, in a folder below the bundle root. */
const RECORD_PATH = "docs/kb/guides/b.md";

/** The files the fabricated bundle holds, from the repo root. */
const FILES = [
  "docs/kb/a.md",
  "docs/kb/guides/b.md",
  "docs/kb/guides/c.md",
  "docs/kb/notes/it's.md",
  "docs/kb/notes/my c.md",
  "docs/kb/notes/d.md",
];

/**
 * Whether a path names one of the files, or a folder holding one, with or
 * without a trailing slash, as `existsSync` reads it.
 */
function existsIn(files: readonly string[]): (filePath: string) => boolean {
  return (filePath) => {
    const folder = filePath.replace(/\/$/u, "");

    return files.some(
      (file) => file === filePath || file.startsWith(`${folder}/`)
    );
  };
}

/** Plan only the fabricated bundle's index, with no records. */
function planIndex(indexText: string | undefined): BundlePlan {
  return planBundle({
    bundleDir: BUNDLE,
    doesExist: existsIn(FILES),
    indexText,
    records: [],
  });
}

/** Plan one record at `RECORD_PATH`, and read what it became. */
function planRecord(params: {
  /**
   * More files on disk than `FILES`, from the repo root.
   *
   * @example `["docs/kb/c.md"]`
   */
  extraFiles?: readonly string[];

  /**
   * The record's text.
   *
   * @example `"---\nresource: a.md\n---\n"`
   */
  text: string;
}): { after: string | undefined; notes: MigrateNote[]; plan: BundlePlan } {
  const { extraFiles, text } = params;
  const plan = planRecords({
    extraFiles,
    records: [{ filePath: RECORD_PATH, text }],
  });

  return {
    after: plan.changes.find((change) => change.filePath === RECORD_PATH)
      ?.after,
    notes: plan.notes,
    plan,
  };
}

/** Plan the fabricated bundle with the given records and v0.2 index. */
function planRecords(params: {
  /**
   * More files on disk than `FILES`, from the repo root.
   *
   * @example `["docs/kb/c.md"]`
   */
  extraFiles?: readonly string[] | undefined;

  /**
   * The records to plan.
   *
   * @example `[{ filePath: "docs/kb/guides/b.md", text: "---\n…" }]`
   */
  records: readonly PlannedFile[];
}): BundlePlan {
  const { extraFiles = [], records } = params;

  return planBundle({
    bundleDir: BUNDLE,
    doesExist: existsIn([...FILES, ...extraFiles]),
    indexText: INDEX,
    records,
  });
}

/** A note about the record at `RECORD_PATH`. */
function recordNote(
  level: MigrateNote["level"]
): (message: string) => MigrateNote {
  return (message) => ({ filePath: RECORD_PATH, level, message });
}

/** A record with the given frontmatter lines and body. */
function recordText(params: {
  /**
   * The body after the frontmatter.
   *
   * @example `"\n[A](a.md)\n"`
   */
  body?: string | undefined;

  /**
   * The frontmatter lines.
   *
   * @example `["type: Decision"]`
   */
  frontmatter: readonly string[];
}): string {
  const { body = "", frontmatter } = params;

  return `---\n${frontmatter.join("\n")}\n---\n${body}`;
}

describe("planBundle, on a bundle's root index.md", () => {
  test("refuses a bundle with no root index.md", () => {
    // Given/When - a bundle with no index
    const plan = planIndex(undefined);

    // Then - refused, saying how to fix it
    expect(plan).toStrictEqual({
      changes: [],
      declared: undefined,
      notes: [
        {
          filePath: INDEX_PATH,
          level: "blocked",
          message:
            "doesn't exist, so the bundle can't declare okf_version 0.3; add one with a heading, then run okf migrate again",
        },
      ],
      state: "refused",
    });
  });

  test.each([
    {
      declared: undefined,
      description: "frontmatter that isn't valid YAML",
      indexText: "---\nokf_version: [0.2\n---\n",
      message: "has frontmatter that isn't a valid YAML mapping",
    },
    {
      declared: undefined,
      description: "frontmatter that isn't a mapping",
      indexText: "---\n- a\n- b\n---\n",
      message: "has frontmatter that isn't a valid YAML mapping",
    },
    {
      declared: undefined,
      description: "an okf_version that's a list",
      indexText: "---\nokf_version: [0.2]\n---\n",
      message:
        'has an okf_version that isn\'t a single quoted or plain version, such as "0.2"',
    },
    {
      declared: undefined,
      description: "an okf_version written as a block scalar",
      indexText: "---\nokf_version: |-\n  0.2\n---\n",
      message:
        'has an okf_version that isn\'t a single quoted or plain version, such as "0.2"',
    },
    {
      declared: undefined,
      description: "an empty okf_version",
      indexText: '---\nokf_version: ""\n---\n',
      message:
        'has an okf_version that isn\'t a single quoted or plain version, such as "0.2"',
    },
    {
      declared: undefined,
      description: "an okf_version with no value",
      indexText: "---\nokf_version:\n---\n",
      message:
        'has an okf_version that isn\'t a single quoted or plain version, such as "0.2"',
    },
    {
      declared: "v0.2",
      description: "an okf_version that isn't <major>.<minor>",
      indexText: "---\nokf_version: v0.2\n---\n",
      message:
        'declares okf_version "v0.2", which isn\'t a <major>.<minor> version',
    },
    {
      declared: "0.2.1",
      description: "an okf_version with a patch number",
      indexText: "---\nokf_version: 0.2.1\n---\n",
      message:
        'declares okf_version "0.2.1", which isn\'t a <major>.<minor> version',
    },
    {
      declared: "0.4",
      description: "a newer minor version",
      indexText: '---\nokf_version: "0.4"\n---\n',
      message:
        'declares okf_version "0.4", newer than the 0.3 okf migrate writes; upgrade okf-tools instead',
    },
    {
      declared: "1.0",
      description: "a newer major version",
      indexText: "---\nokf_version: 1.0\n---\n",
      message:
        'declares okf_version "1.0", newer than the 0.3 okf migrate writes; upgrade okf-tools instead',
    },
  ])(
    "refuses an index with $description",
    ({ declared, indexText, message }) => {
      // Given/When - an index whose version can't be migrated from
      const plan = planIndex(indexText);

      // Then - refused, with nothing changed
      expect(plan).toStrictEqual({
        changes: [],
        declared,
        notes: [{ filePath: INDEX_PATH, level: "blocked", message }],
        state: "refused",
      });
    }
  );

  test.each([
    { description: "quoted", indexText: '---\nokf_version: "0.3"\n---\n' },
    { description: "plain", indexText: "---\nokf_version: 0.3\n---\n# A\n" },
  ])("plans nothing for a $description v0.3 index", ({ indexText }) => {
    // Given/When - a bundle already on v0.3, with records that would change
    const plan = planBundle({
      bundleDir: BUNDLE,
      doesExist: existsIn(FILES),
      indexText,
      records: [
        {
          filePath: RECORD_PATH,
          text: recordText({ frontmatter: ["resource: a.md"] }),
        },
      ],
    });

    // Then - current, with nothing to do
    expect(plan).toStrictEqual({
      changes: [],
      declared: "0.3",
      notes: [],
      state: "current",
    });
  });

  test.each([
    {
      after: MIGRATED_INDEX,
      before: INDEX,
      description: "replaces a double-quoted version",
      notes: [],
    },
    {
      after:
        '---\nokf_version: "0.3" # the spec\'s\ntitle: K\ndescription: D\n---\n',
      before:
        "---\nokf_version: '0.1' # the spec's\ntitle: K\ndescription: D\n---\n",
      description: "replaces a single-quoted version, keeping its comment",
      notes: [],
    },
    {
      after: '---\nokf_version: "0.3"\ntitle: K\ndescription: D\n---\n# K\n',
      before: "---\ntitle: K\ndescription: D\n---\n# K\n",
      description: "declares a version the frontmatter lacks",
      notes: [],
    },
    {
      after:
        '---\nokf_version: "0.3"\ntitle: "Knowledge"\ndescription: "What we know, and why."\n---\n# Knowledge ##\n\nWhat we know,\n  and why.\n\nMore.\n',
      before: "# Knowledge ##\n\nWhat we know,\n  and why.\n\nMore.\n",
      description:
        "writes frontmatter for an index with none, from its heading and paragraph",
      notes: [
        { level: "filled", message: 'title filled in as "Knowledge"' },
        {
          level: "filled",
          message: 'description filled in as "What we know, and why."',
        },
      ],
    },
    {
      after:
        '﻿---\r\nokf_version: "0.3"\r\ntitle: "K"\r\ndescription: "D."\r\n---\r\n# K\r\n\r\nD.\r\n',
      before: "﻿# K\r\n\r\nD.\r\n",
      description:
        "writes frontmatter after a byte order mark, with CRLF line breaks",
      notes: [
        { level: "filled", message: 'title filled in as "K"' },
        { level: "filled", message: 'description filled in as "D."' },
      ],
    },
    {
      after:
        '---\nokf_version: "0.3"\ntitle: "K"\ndescription: "D."\n---\n# K\n\nD.\n',
      before: "---\n---\n# K\n\nD.\n",
      description: "fills in empty frontmatter",
      notes: [
        { level: "filled", message: 'title filled in as "K"' },
        { level: "filled", message: 'description filled in as "D."' },
      ],
    },
    {
      after:
        '---\nokf_version: "0.3"\n# kept\ntitle: "K"\ndescription: "D."\n---\n# K\n\nD.\n',
      before: "---\n# kept\n---\n# K\n\nD.\n",
      description: "fills in frontmatter that holds only a comment",
      notes: [
        { level: "filled", message: 'title filled in as "K"' },
        { level: "filled", message: 'description filled in as "D."' },
      ],
    },
    {
      after:
        '---\nokf_version: "0.3"\ndescription: D\ntitle: "Real"\n---\n```\n# Quoted\n```\n# Real\n',
      before:
        '---\nokf_version: "0.2"\ndescription: D\n---\n```\n# Quoted\n```\n# Real\n',
      description: "takes the title from the first heading outside code",
      notes: [{ level: "filled", message: 'title filled in as "Real"' }],
    },
    {
      after: '---\nokf_version: "0.3"\n---\nNo heading here.\n',
      before: "No heading here.\n",
      description: "asks for a title and description with no heading",
      notes: [
        {
          level: "check",
          message:
            "has no heading to take a title from; add title to its frontmatter by hand",
        },
        {
          level: "check",
          message:
            "has no heading to take a description from; add description to its frontmatter by hand",
        },
      ],
    },
    {
      after: '---\nokf_version: "0.3"\ntitle: "K"\n---\n# K\n\n- [A](a.md)\n',
      before: "# K\n\n- [A](a.md)\n",
      description: "asks for a description when a list follows the heading",
      notes: [
        { level: "filled", message: 'title filled in as "K"' },
        {
          level: "check",
          message:
            "has no paragraph after its first heading to take a description from; add description to its frontmatter by hand",
        },
      ],
    },
    {
      after:
        '---\nokf_version: "0.3"\ntitle: "K"\ndescription: "D."\n---\n# K\nD.\n> quoted\n',
      before: "# K\nD.\n> quoted\n",
      description: "ends the description where another block starts",
      notes: [
        { level: "filled", message: 'title filled in as "K"' },
        { level: "filled", message: 'description filled in as "D."' },
      ],
    },
    {
      after: '---\nokf_version: "0.3"\ndescription: "D."\n---\n#\n\nD.\n',
      before: "#\n\nD.\n",
      description: "asks for a title when the heading is empty",
      notes: [
        {
          level: "check",
          message:
            "has an empty first heading to take a title from; add title to its frontmatter by hand",
        },
        { level: "filled", message: 'description filled in as "D."' },
      ],
    },
  ])("$description", ({ after, before, notes }) => {
    // Given/When - planning an index
    const plan = planIndex(before);

    // Then - the index rewritten, with what was filled in or needs a person
    expect(plan.state).toBe("migrate");
    expect(plan.changes).toStrictEqual([
      { after, before, filePath: INDEX_PATH },
    ]);
    expect(plan.notes).toStrictEqual(
      notes.map((note) => ({ ...note, filePath: INDEX_PATH }))
    );
  });

  test("reads an undeclared index as v0.2", () => {
    // Given/When - an index with no frontmatter
    const plan = planIndex("# K\n\nD.\n");

    // Then - migrated, from no declared version
    expect(plan.state).toBe("migrate");
    expect(plan.declared).toBeUndefined();
  });

  test.each([
    {
      description: "a flow mapping a new line can't follow",
      indexText: "---\n{okf_version: '0.2'}\n---\n# K\n\nD.\n",
      message:
        "can't be migrated: the edit wouldn't leave the frontmatter as valid YAML meaning only what's intended",
    },
    {
      description: "a version under an alias key a new line would shadow",
      indexText:
        '---\nx: &k okf_version\n*k : "0.2"\ntitle: K\ndescription: D\n---\n',
      message: ANCHORS_MESSAGE,
    },
    {
      description: "an anchored version an alias repeats",
      indexText:
        '---\nokf_version: &v "0.2"\nother: *v\ntitle: K\ndescription: D\n---\n',
      message: ANCHORS_MESSAGE,
    },
  ])("refuses an index with $description", ({ indexText, message }) => {
    // Given/When - an index whose edit would change its meaning
    const plan = planIndex(indexText);

    // Then - refused, saying why
    expect(plan.state).toBe("refused");
    expect(plan.changes).toStrictEqual([]);
    expect(plan.notes).toStrictEqual([
      {
        filePath: INDEX_PATH,
        level: "blocked",
        message,
      },
    ]);
  });

  test("migrates a bundle at the repo root", () => {
    // Given - a bundle at the repo root, with a record below it
    const text = recordText({ frontmatter: ["resource: a.md"] });

    // When - planning it
    const plan = planBundle({
      bundleDir: ".",
      doesExist: existsIn(["a.md", "guides/b.md"]),
      indexText: INDEX,
      records: [{ filePath: "guides/b.md", text }],
    });

    // Then - paths from the repo root
    expect(plan.changes).toStrictEqual([
      { after: MIGRATED_INDEX, before: INDEX, filePath: "index.md" },
      {
        after: recordText({ frontmatter: ["resource: ../a.md"] }),
        before: text,
        filePath: "guides/b.md",
      },
    ]);
  });
});

describe("planBundle, on an index's empty values", () => {
  test.each([
    {
      description: "a null title",
      indexText: '---\nokf_version: "0.2"\ntitle:\ndescription: D\n---\n# K\n',
      key: "title",
    },
    {
      description: "an empty description",
      indexText:
        '---\nokf_version: "0.2"\ntitle: K\ndescription: ""\n---\n# K\n',
      key: "description",
    },
  ])("asks a person to fill in $description", ({ indexText, key }) => {
    // Given/When - an index with the key present but empty
    const plan = planIndex(indexText);

    // Then - a check note, and nothing filled in
    expect(plan.notes).toStrictEqual([
      {
        filePath: INDEX_PATH,
        level: "check",
        message: `has an empty ${key}; fill it in by hand`,
      },
    ]);
  });
});

describe("planBundle, on review fixes", () => {
  test("never reads a footnote as a link reference", () => {
    // Given/When - a footnote whose text opens with a root file's path
    const text = recordText({
      body: "\nSee it.[^a]\n\n[^a]: a.md explains it.\n",
      frontmatter: ["type: Decision"],
    });
    const { after, notes } = planRecord({ text });

    // Then - left as written, with nothing to report
    expect(after).toBeUndefined();
    expect(notes).toStrictEqual([]);
  });

  test("rewrites a path field with a fragment, keeping it", () => {
    // Given/When - a path field naming a root file's section
    const { after } = planRecord({
      text: recordText({ frontmatter: ["superseded_by: notes/d.md#v2"] }),
    });

    // Then - rewritten from the record's folder, fragment kept, and quoted
    expect(after).toBe(
      recordText({ frontmatter: ['superseded_by: "../notes/d.md#v2"'] })
    );
  });

  test("keeps inline code in a filled-in title and description", () => {
    // Given/When - a heading and paragraph holding inline code
    const plan = planIndex(
      '---\nokf_version: "0.2"\n---\n# The `okf` notes\n\n[Records](https://example.com/r) `okf` keeps.\n'
    );

    // Then - both filled in as written
    expect(plan.notes).toStrictEqual([
      {
        filePath: INDEX_PATH,
        level: "filled",
        message: 'title filled in as "The `okf` notes"',
      },
      {
        filePath: INDEX_PATH,
        level: "filled",
        message:
          'description filled in as "[Records](https://example.com/r) `okf` keeps."',
      },
    ]);
  });
});

describe("planBundle, on pass C fixes", () => {
  test("takes no description from past a fenced block", () => {
    // Given/When - a heading followed by fenced code, then a paragraph
    const plan = planIndex(
      '---\nokf_version: "0.2"\ntitle: K\n---\n# K\n\n```sh\nokf index\n```\n\nLater text.\n'
    );

    // Then - asked for, not taken from the later paragraph
    expect(plan.notes).toStrictEqual([
      {
        filePath: INDEX_PATH,
        level: "check",
        message:
          "has no paragraph after its first heading to take a description from; add description to its frontmatter by hand",
      },
    ]);
  });

  test("keeps a line of only inline code in a description", () => {
    // Given/When - a paragraph whose first line is only inline code
    const plan = planIndex(
      '---\nokf_version: "0.2"\ntitle: K\n---\n# K\n`okf`\nkeeps the records.\n'
    );

    // Then - the whole paragraph
    expect(plan.notes).toStrictEqual([
      {
        filePath: INDEX_PATH,
        level: "filled",
        message: 'description filled in as "`okf` keeps the records."',
      },
    ]);
  });

  test("reads a bare . as its own folder, under both rules", () => {
    // Given/When - a path field naming its own folder
    const { after, notes } = planRecord({
      text: recordText({ frontmatter: ["resource: ."] }),
    });

    // Then - kept, with nothing to report
    expect(after).toBeUndefined();
    expect(notes).toStrictEqual([]);
  });
});

describe("planBundle, on a record's path fields", () => {
  test("refuses a record whose rewritten path is anchored", () => {
    // Given - a path an alias repeats, so rewriting it would reach the alias
    const text = recordText({
      frontmatter: ["resource: &r a.md", "computation: *r"],
    });

    // When - planning it
    const { notes, plan } = planRecord({ text });

    // Then - refused, leaving it for a person
    expect(plan.state).toBe("refused");
    expect(notes).toStrictEqual([
      { filePath: RECORD_PATH, level: "blocked", message: ANCHORS_MESSAGE },
    ]);
  });

  test("quotes a rewritten path YAML would read as something else", () => {
    // Given - a path to a file named `null` beside the record
    const text = recordText({ frontmatter: ["resource: guides/null"] });

    // When - planning it
    const { after } = planRecord({
      extraFiles: ["docs/kb/guides/null"],
      text,
    });

    // Then - quoted, so no reader takes it for a null
    expect(after).toBe(recordText({ frontmatter: ['resource: "null"'] }));
  });

  test("rewrites every path field that names a file only from the root", () => {
    // Given - a record in a folder with each path field written from the root
    const text = recordText({
      frontmatter: [
        "type: Decision",
        "resource: a.md",
        'computation: "guides/c.md"',
        "superseded_by: 'notes/d.md'",
        "sources:",
        "  - resource: notes/d.md",
        "    title: D",
        "  - a plain citation",
        "executor: { resource: a.md }",
        "attester:",
        "  resource: guides/c.md",
        "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
        "verified: { by: human:jjloneman, at: 2026-10-02T13:30:00Z }",
      ],
    });

    // When - planning it
    const { after, notes, plan } = planRecord({ text });

    // Then - each rewritten from the record's folder, in its own quoting
    expect(plan.state).toBe("migrate");
    expect(notes).toStrictEqual([]);
    expect(after).toBe(
      recordText({
        frontmatter: [
          "type: Decision",
          "resource: ../a.md",
          'computation: "c.md"',
          "superseded_by: '../notes/d.md'",
          "sources:",
          "  - resource: ../notes/d.md",
          "    title: D",
          "  - a plain citation",
          "executor: { resource: ../a.md }",
          "attester:",
          "  resource: c.md",
          "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
          "verified: { by: human:jjloneman, at: 2026-10-02T13:30:00Z }",
        ],
      })
    );
  });

  test.each([
    {
      description: "a sources mapping",
      expected: ["sources:", "  resource: ../a.md"],
      frontmatter: ["sources:", "  resource: a.md"],
    },
    {
      description: "a single-quoted path with an apostrophe",
      expected: ["resource: '../notes/it''s.md'"],
      frontmatter: ["resource: 'notes/it''s.md'"],
    },
    {
      description: "a plain path that needs quoting once rewritten",
      expected: ['resource: "../notes/my c.md"'],
      frontmatter: ["resource: notes/my c.md"],
    },
    {
      description: "a folder",
      expected: ["resource: ."],
      frontmatter: ["resource: guides"],
    },
    {
      description: "a folder with a trailing slash",
      expected: ["resource: ./"],
      frontmatter: ["resource: guides/"],
    },
    {
      description: "a percent-encoded path",
      expected: ["resource: ../notes/my%20c.md"],
      frontmatter: ["resource: notes/my%20c.md"],
    },
  ])("rewrites $description", ({ expected, frontmatter }) => {
    // Given/When - a record with that path field
    const { after, notes } = planRecord({ text: recordText({ frontmatter }) });

    // Then - rewritten from the record's folder
    expect(notes).toStrictEqual([]);
    expect(after).toBe(recordText({ frontmatter: expected }));
  });

  test.each([
    { description: "a path from its own folder", value: "c.md" },
    { description: "a ./ path", value: "./c.md" },
    { description: "a ../ path", value: "../a.md" },
    { description: "a path from the repo root", value: "/docs/kb/a.md" },
    { description: "a URL", value: "https://example.com/a.md" },
    { description: "an empty path", value: '""' },
    { description: "a scope descriptor", value: "the whole bundle" },
    { description: "the bundle's parent", value: ".." },
    { description: "executor as text", key: "executor", value: "a.md" },
    {
      description: "a list of sources as text",
      key: "sources",
      value: "[a.md]",
    },
    { description: "a field that isn't text", value: "[a.md]" },
  ])("leaves $description alone", ({ key = "resource", value }) => {
    // Given/When - a path field that needs no rewrite
    const { after, notes } = planRecord({
      text: recordText({ frontmatter: [`${key}: ${value}`] }),
    });

    // Then - no change, and nothing to look at
    expect(after).toBeUndefined();
    expect(notes).toStrictEqual([]);
  });

  test.each([
    { description: "a path that names no file", value: "gone.md" },
    { description: "a path out of the bundle", value: "x/../../out.md" },
  ])("asks a person to look at $description", ({ value }) => {
    // Given/When - a path that resolves to no file in the bundle
    const { after, notes, plan } = planRecord({
      extraFiles: ["docs/out.md"],
      text: recordText({ frontmatter: [`resource: ${value}`] }),
    });

    // Then - a note, and the bundle still migrates
    expect(plan.state).toBe("migrate");
    expect(after).toBeUndefined();
    expect(notes).toStrictEqual([
      recordNote("check")(
        `resource ${JSON.stringify(value)} names no file under either rule`
      ),
    ]);
  });

  test("reads a malformed percent-encoding as written", () => {
    // Given/When - a path that can't be decoded, naming a file as written
    const { after } = planRecord({
      extraFiles: ["docs/kb/notes/100%.md"],
      text: recordText({ frontmatter: ["resource: notes/100%.md"] }),
    });

    // Then - rewritten all the same
    expect(after).toBe(
      recordText({ frontmatter: ["resource: ../notes/100%.md"] })
    );
  });

  test("refuses the bundle over a path that names two files", () => {
    // Given/When - a path naming one file from the root, another from its folder
    const { notes, plan } = planRecord({
      extraFiles: ["docs/kb/c.md"],
      text: recordText({ frontmatter: ["resource: c.md"] }),
    });

    // Then - the whole bundle refused, saying which files
    expect(plan.state).toBe("refused");
    expect(plan.changes).toStrictEqual([]);
    expect(notes).toStrictEqual([
      recordNote("blocked")(
        'resource "c.md" names docs/kb/c.md from the bundle root but docs/kb/guides/c.md from its own folder; point it at one by hand'
      ),
    ]);
  });

  test("refuses the bundle over a block scalar that needs a rewrite", () => {
    // Given/When - a path field written as a block scalar
    const { notes, plan } = planRecord({
      text: recordText({ frontmatter: ["resource: |-", "  a.md"] }),
    });

    // Then - refused, saying what to write by hand
    expect(plan.state).toBe("refused");
    expect(notes).toStrictEqual([
      recordNote("blocked")(
        'resource "a.md" names a file only from the bundle root, in a block scalar okf migrate doesn\'t rewrite; change it to "../a.md" by hand'
      ),
    ]);
  });

  test("refuses a rewrite that would leave the frontmatter invalid", () => {
    // Given/When - a record whose frontmatter is already invalid YAML
    const { notes, plan } = planRecord({
      text: recordText({ frontmatter: ["resource: a.md", "resource: b.md"] }),
    });

    // Then - refused, with its other notes dropped
    expect(plan.state).toBe("refused");
    expect(notes).toStrictEqual([
      recordNote("blocked")(
        "can't be migrated: the edit wouldn't leave the frontmatter as valid YAML meaning only what's intended"
      ),
    ]);
  });
});

describe("planBundle, on a record's links", () => {
  test("rewrites each kind of link that names a file only from the root", () => {
    // Given - inline links, an image, an angle target, and a definition
    const body = [
      "",
      'See [A](a.md), [C](guides/c.md#usage "C"), and ![D](notes/d.md?raw).',
      "Also [mine](<notes/my c.md>) and [ref][r].",
      "",
      "[r]: notes/d.md",
      "",
    ].join("\n");
    const text = recordText({ body, frontmatter: ["type: Decision"] });

    // When - planning it
    const { after, notes } = planRecord({ text });

    // Then - each target rewritten, its fragment and query kept
    expect(notes).toStrictEqual([]);
    expect(after).toBe(
      recordText({
        body: [
          "",
          'See [A](../a.md), [C](c.md#usage "C"), and ![D](../notes/d.md?raw).',
          "Also [mine](<../notes/my c.md>) and [ref][r].",
          "",
          "[r]: ../notes/d.md",
          "",
        ].join("\n"),
        frontmatter: ["type: Decision"],
      })
    );
  });

  test("leaves links in code, escaped, or already relative alone", () => {
    // Given - links that aren't the body's own, or need no rewrite
    const body = [
      "",
      "`[A](a.md)` and ``[B](a.md)``",
      "```md",
      "[C](a.md)",
      "```",
      "\\[D\\](a.md), [E](../a.md), [F](c.md), [G](#top), [H](https://x.org)",
      "",
    ].join("\n");

    // When - planning it
    const { after, notes } = planRecord({
      text: recordText({ body, frontmatter: ["type: Decision"] }),
    });

    // Then - nothing changed
    expect(after).toBeUndefined();
    expect(notes).toStrictEqual([]);
  });

  test("asks a person to look at a link that names no file", () => {
    // Given/When - a link that resolves under neither rule
    const { notes, plan } = planRecord({
      text: recordText({
        body: "\n[Gone](gone.md#x)\n",
        frontmatter: ["type: Decision"],
      }),
    });

    // Then - a note, and the bundle still migrates
    expect(plan.state).toBe("migrate");
    expect(notes).toStrictEqual([
      recordNote("check")(
        "links to gone.md#x, which names no file under either rule"
      ),
    ]);
  });

  test("keeps a link that names a file from its own folder", () => {
    // Given/When - a link naming one file from the root, another from its
    // folder, which v0.2 read it from too
    const { after, notes, plan } = planRecord({
      extraFiles: ["docs/kb/c.md"],
      text: recordText({
        body: "\n[C](<c.md>)\n",
        frontmatter: ["type: Decision"],
      }),
    });

    // Then - kept, with nothing to report
    expect(plan.state).toBe("migrate");
    expect(after).toBeUndefined();
    expect(notes).toStrictEqual([]);
  });

  test("rewrites a path field and a link in the same record", () => {
    // Given - both
    const text = recordText({
      body: "\n[A](a.md)\n",
      frontmatter: ["resource: a.md"],
    });

    // When - planning it
    const { after } = planRecord({ text });

    // Then - both rewritten
    expect(after).toBe(
      recordText({
        body: "\n[A](../a.md)\n",
        frontmatter: ["resource: ../a.md"],
      })
    );
  });
});

describe("planBundle, on what v0.3 no longer reads", () => {
  test.each([
    {
      description: "a v0.1 timestamp without generated",
      frontmatter: ["timestamp: 2026-01-01T00:00:00Z"],
      notes: [
        "has a v0.1 `timestamp`, which v0.3 no longer reads; move it into `generated` by hand",
      ],
    },
    {
      body: "\n# Citations\n\n- A book.\n",
      description: "a v0.1 citations list without sources",
      frontmatter: ["type: Decision"],
      notes: [
        "has a v0.1 `# Citations` list, which v0.3 no longer reads; move it into `sources` by hand",
      ],
    },
    {
      description: "a timestamp beside generated",
      frontmatter: [
        "timestamp: 2026-01-01T00:00:00Z",
        "generated: { by: x/1, at: 2026-01-01T00:00:00Z }",
      ],
      notes: [],
    },
    {
      body: "\n# Citations\n",
      description: "a citations heading beside sources",
      frontmatter: ["sources: [{ title: A book }]"],
      notes: [],
    },
    {
      body: "\n```\n# Citations\n```\n",
      description: "a citations heading in code",
      frontmatter: ["type: Decision"],
      notes: [],
    },
  ])("reports $description", ({ body, frontmatter, notes }) => {
    // Given/When - a record in a folder
    const { notes: planned } = planRecord({
      text: recordText({ body, frontmatter }),
    });

    // Then - the notes, if any
    expect(planned).toStrictEqual(notes.map(recordNote("check")));
  });

  test("reports a v0.1 record at the bundle root, but never rewrites it", () => {
    // Given - a record at the bundle root with a path and a link
    const text = recordText({
      body: "\n[C](guides/c.md)\n",
      frontmatter: ["resource: guides/c.md", "timestamp: 2026-01-01T00:00:00Z"],
    });

    // When - planning it
    const plan = planRecords({
      records: [{ filePath: "docs/kb/a.md", text }],
    });

    // Then - only the index changes, with a note on the record
    expect(plan.changes.map((change) => change.filePath)).toStrictEqual([
      INDEX_PATH,
    ]);
    expect(plan.notes).toStrictEqual([
      {
        filePath: "docs/kb/a.md",
        level: "check",
        message:
          "has a v0.1 `timestamp`, which v0.3 no longer reads; move it into `generated` by hand",
      },
    ]);
  });

  test("rewrites the links of a file with no frontmatter", () => {
    // Given/When - a folder's file, such as its log.md, with no frontmatter
    const { after } = planRecord({ text: "# B\n\n[A](a.md)\n" });

    // Then - its link rewritten
    expect(after).toBe("# B\n\n[A](../a.md)\n");
  });
});
