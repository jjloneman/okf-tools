import { describe, expect, test } from "vitest";

import type { IndexRecord, SyncIndexParams } from "./index-sync.ts";

import {
  findIndexDrift,
  syncIndex,
  TAG_INDEX_END,
  TAG_INDEX_START,
} from "./index-sync.ts";

/** The index every test syncs, unless it names another. */
const INDEX_PATH = "docs/decisions/index.md";

/** A fabricated record, `a.md`, with a title, a description, and tags. */
const A = makeRecord({
  description: "The first.",
  path: "docs/decisions/a.md",
  tags: ["api", "cli"],
  title: "A",
});

/** A fabricated record, `b.md`, with a title, a description, and a tag. */
const B = makeRecord({
  description: "The second.",
  path: "docs/decisions/b.md",
  tags: ["cli"],
  title: "B",
});

/** A fabricated record, `c.md`, with a title and a description. */
const C = makeRecord({
  description: "The third.",
  path: "docs/decisions/c.md",
  title: "C",
});

/** What a test changes about a fabricated record. */
type RecordFields = {
  /**
   * Its description.
   *
   * @example "The first."
   */
  description?: string;

  /**
   * Its path from the repo root.
   *
   * @example "docs/decisions/a.md"
   */
  path: string;

  /**
   * Its tags.
   *
   * @example `["api"]`
   */
  tags?: readonly string[];

  /**
   * Its title.
   *
   * @example "A"
   */
  title?: string;
};

/** Build a fabricated record, with no description, tags, or title unless given. */
function makeRecord(fields: RecordFields): IndexRecord {
  return {
    description: fields.description,
    path: fields.path,
    tags: fields.tags ?? [],
    title: fields.title,
  };
}

/**
 * Sync an index's text, with every record in scope and no other file on
 * disk unless the test says otherwise.
 *
 * @returns the synced text, failing the test when it can't be synced.
 */
function sync(
  text: string,
  params: Partial<Omit<SyncIndexParams, "text">> = {}
): string {
  const records = params.records ?? [A, B, C];
  const result = syncIndex({
    doesExist: params.doesExist ?? (() => false),
    indexPath: params.indexPath ?? INDEX_PATH,
    records,
    scoped: params.scoped ?? records,
    text,
  });

  if (!result.isOk) {
    throw new Error(result.problem);
  }

  return result.text;
}

describe("syncIndex", () => {
  describe("review fixes", () => {
    test("adds a record at the first run's indent", () => {
      // Given - a run nested under a group line
      const text = "- Group\n  - [B](b.md) - The second.\n";

      // When - syncing with a missing record
      const synced = sync(text, { records: [A, B] });

      // Then - the new line nested beside the others
      expect(synced).toBe(
        "- Group\n  - [A](a.md) - The first.\n  - [B](b.md) - The second.\n"
      );
    });

    test("lists a record again when the only link to it is gone in its case", () => {
      // Given - a link spelled in another case that a case-sensitive disk lacks
      const text = "# Decisions\n\n- [Old](A.md)\n";

      // When - syncing with no such file on disk
      const synced = sync(text, { records: [A] });

      // Then - the gone line dropped and the record listed, the blank line
      // the gone run sat before kept
      expect(synced).toBe("# Decisions\n\n- [A](a.md) - The first.\n\n");
    });

    test("leaves a fence opened under a record line as written", () => {
      // Given - a record line with fenced code under it, and a link in the code
      const text =
        "- [A](a.md)\n  ```md\n\n  - [B](b.md) - old\n  ```\n\n- [C](c.md)\n";

      // When - syncing it
      const synced = sync(text, { records: [A, B, C], scoped: [A, C] });

      // Then - the code as written, the lines outside it synced
      expect(synced).toBe(
        "- [A](a.md) - The first.\n  ```md\n\n  - [B](b.md) - old\n  ```\n\n- [C](c.md) - The third.\n"
      );
    });

    test("writes a title over lines on one line, and keeps it there", () => {
      // Given - a record whose title holds line breaks
      const record = makeRecord({
        description: "Folded.",
        path: "docs/decisions/a.md",
        title: "Line one\n  line two\n",
      });

      // When - syncing twice
      const once = sync("# Decisions\n", { records: [record] });
      const twice = sync(once, { records: [record] });

      // Then - one line, unchanged by the second sync
      expect(once).toBe(
        "# Decisions\n\n- [Line one line two](a.md) - Folded.\n"
      );
      expect(twice).toBe(once);
    });

    test("encodes a file name's percent sign, hash, and question mark", () => {
      // Given - a record whose file name holds all three
      const record = makeRecord({
        path: "docs/decisions/c#%?.md",
        title: "Odd",
      });

      // When - syncing twice
      const once = sync("# Decisions\n", { records: [record] });
      const twice = sync(once, { records: [record] });

      // Then - a target that reads back as the record, listed once
      expect(once).toBe("# Decisions\n\n- [Odd](c%23%25%3F.md)\n");
      expect(twice).toBe(once);
    });

    test("ignores tag-index markers quoted in fenced code", () => {
      // Given - an example of the markers in a fence, then the real ones
      const fenced = `\`\`\`md\n${TAG_INDEX_START}\n${TAG_INDEX_END}\n\`\`\``;
      const text = `# Decisions\n\n- [A](a.md) - The first.\n\n${fenced}\n\n${TAG_INDEX_START}\n${TAG_INDEX_END}\n`;

      // When - syncing a record with tags
      const synced = sync(text, { records: [A] });

      // Then - the example as written, and only the real tag index filled
      expect(synced).toBe(
        `# Decisions\n\n- [A](a.md) - The first.\n\n${fenced}\n\n${TAG_INDEX_START}\n\n- \`api\`\n  - [A](a.md)\n- \`cli\`\n  - [A](a.md)\n\n${TAG_INDEX_END}\n`
      );
    });

    test.each([
      {
        description: "nested deep under another item",
        line: "- Group\n    - [Old](a.md)",
      },
      { description: "in a numbered list", line: "1. [Old](a.md)" },
      { description: "spelled in another case", line: "- [Old](A.md)" },
    ])("adds no second line for a record linked $description", ({ line }) => {
      // Given - an index linking a record in a form that isn't a record line
      const text = `# Decisions\n\n${line}\n`;

      // When - syncing with that record in scope
      const synced = sync(text, { doesExist: () => true, records: [A] });

      // Then - the index as written
      expect(synced).toBe(text);
    });
  });

  describe("record lines", () => {
    test("rewrites each record line from its title and description", () => {
      // Given - record lines with stale titles and descriptions
      const text =
        "# Decisions\n\n- [Old A](a.md) - Old.\n- [Old B](b.md)\n- [C](c.md) - The third.\n";

      // When - syncing it
      const synced = sync(text);

      // Then - each line from its record's frontmatter
      expect(synced).toBe(
        "# Decisions\n\n- [A](a.md) - The first.\n- [B](b.md) - The second.\n- [C](c.md) - The third.\n"
      );
    });

    test("escapes the brackets and backslashes of a title", () => {
      // Given - a title that would end the link text
      const record = makeRecord({
        path: "docs/decisions/a.md",
        title: String.raw`Use [x] or \ y`,
      });

      // When - syncing its line
      const synced = sync("- [A](a.md)\n", { records: [record] });

      // Then - each escaped
      expect(synced).toBe(String.raw`- [Use \[x\] or \\ y](a.md)` + "\n");
    });

    test.each([
      {
        description: "no title, listed by its file name",
        expected: "- [a](a.md) - The first.\n",
        record: makeRecord({
          description: "The first.",
          path: "docs/decisions/a.md",
        }),
      },
      {
        description: "no description, with no separator",
        expected: "- [A](a.md)\n",
        record: makeRecord({ path: "docs/decisions/a.md", title: "A" }),
      },
      {
        description: "a blank description, with no separator",
        expected: "- [A](a.md)\n",
        record: makeRecord({
          description: " \n ",
          path: "docs/decisions/a.md",
          title: "A",
        }),
      },
      {
        description: "a description over lines, on one line",
        expected: "- [A](a.md) - The first, then more.\n",
        record: makeRecord({
          description: "  The first,\n\nthen more.\n",
          path: "docs/decisions/a.md",
          title: "A",
        }),
      },
    ])("writes a record with $description", ({ expected, record }) => {
      // Given - a line for the record
      const text = "- [Old](a.md) - Old.\n";

      // When - syncing it
      const synced = sync(text, { records: [record] });

      // Then - the line from what the record has
      expect(synced).toBe(expected);
    });

    test.each([
      { description: "a hyphen", separator: " - " },
      { description: "an em dash", separator: " — " },
      { description: "an en dash", separator: " – " },
      { description: "a spaced colon", separator: " : " },
      { description: "a colon", separator: ": " },
      { description: "tabs around a hyphen", separator: "\t-\t" },
    ])("keeps a line's separator: $description", ({ separator }) => {
      // Given - a line with that separator
      const text = `- [Old](a.md)${separator}Old.\n`;

      // When - syncing it
      const synced = sync(text, { records: [A] });

      // Then - the separator kept
      expect(synced).toBe(`- [A](a.md)${separator}The first.\n`);
    });

    test("keeps a line's bullet, indent, and target as written", () => {
      // Given - a starred, indented line whose target has a fragment
      const text = "  * [Old](./a.md#why) - Old.\n";

      // When - syncing it
      const synced = sync(text, { records: [A] });

      // Then - all three kept
      expect(synced).toBe("  * [A](./a.md#why) - The first.\n");
    });

    test.each([
      {
        description: "the later path first",
        text: "- [x](z.md)\n- [x](b.md)\n- [x](a.md)\n",
      },
      {
        description: "the earlier path first",
        text: "- [x](a.md)\n- [x](b.md)\n- [x](z.md)\n",
      },
    ])(
      "sorts a run by title ignoring case, then by path, with $description",
      ({ text }) => {
        // Given - titles that differ only in case, and one after them
        const records = [
          makeRecord({ path: "docs/decisions/z.md", title: "alpha" }),
          makeRecord({ path: "docs/decisions/b.md", title: "beta" }),
          makeRecord({ path: "docs/decisions/a.md", title: "Alpha" }),
        ];

        // When - syncing it
        const synced = sync(text, { records });

        // Then - by title, the tie by path
        expect(synced).toBe(
          "- [Alpha](a.md)\n- [alpha](z.md)\n- [beta](b.md)\n"
        );
      }
    );

    test("keeps each record under its own heading in a grouped index", () => {
      // Given - two runs under two headings, each out of order
      const text =
        "# Decisions\n\n## One\n\n- [x](c.md)\n- [x](a.md)\n\n## Two\n\n- [x](b.md)\n";

      // When - syncing it
      const synced = sync(text);

      // Then - each run sorted in place
      expect(synced).toBe(
        "# Decisions\n\n## One\n\n- [A](a.md) - The first.\n- [C](c.md) - The third.\n\n## Two\n\n- [B](b.md) - The second.\n"
      );
    });

    test("rewrites a line for a record outside its scope, but adds none", () => {
      // Given - an index that lists a record another index scopes
      const text = "# Decisions\n\n- [Old](b.md)\n";

      // When - syncing it with only b in scope
      const synced = sync(text, { records: [A, B], scoped: [B] });

      // Then - b's line rewritten, a not added
      expect(synced).toBe("# Decisions\n\n- [B](b.md) - The second.\n");
    });

    test("moves the lines indented under an item with it", () => {
      // Given - an item with lines under it, sorted after one without
      const text =
        "- [x](b.md)\n  - A note on b.\n    more on b\n- [x](a.md)\n\nAfter.\n";

      // When - syncing it
      const synced = sync(text, { records: [A, B] });

      // Then - the notes follow b
      expect(synced).toBe(
        "- [A](a.md) - The first.\n- [B](b.md) - The second.\n  - A note on b.\n    more on b\n\nAfter.\n"
      );
    });

    test("ends a run as its last line did", () => {
      // Given - a run that ends the file with no line break, after a note
      const text = "- [x](b.md)\n  - A note.";

      // When - syncing it
      const synced = sync(text, { records: [B] });

      // Then - still no final line break
      expect(synced).toBe("- [B](b.md) - The second.\n  - A note.");
    });
  });

  describe("links", () => {
    test.each([
      { description: "a URL", line: "- [Site](https://example.com/a.md)" },
      { description: "a mailto link", line: "- [Mail](mailto:a@example.com)" },
      {
        description: "an absolute path",
        line: "- [Abs](/docs/decisions/x.md)",
      },
      { description: "a bare fragment", line: "- [Here](#section)" },
      { description: "a bare query", line: "- [Query](?q=1)" },
      {
        description: "a path that climbs out of the repo",
        line: "- [Up](../../../x.md)",
      },
      {
        description: "a path that climbs to the repo's parent",
        line: "- [Up](../../..)",
      },
      { description: "a file that isn't Markdown", line: "- [Text](x.txt)" },
      {
        description: "a missing Markdown file outside the index's folder",
        line: "- [Other](../other/x.md)",
      },
      { description: "a link that isn't first", line: "- See [A](a.md)." },
      { description: "a nested item", line: "    - [A](x.md)" },
      { description: "an unclosed link", line: "- [A](a.md" },
    ])("keeps a line linking to $description", ({ line }) => {
      // Given - that line, and a record line after it
      const text = `${line}\n\n- [Old](a.md)\n`;

      // When - syncing it
      const synced = sync(text, { records: [A] });

      // Then - the line kept as written
      expect(synced).toBe(`${line}\n\n- [A](a.md) - The first.\n`);
    });

    test("keeps a line linking to a Markdown file that exists", () => {
      // Given - a link to a file on disk that isn't a record
      const text = "- [Notes](notes.md) - Kept.\n";

      // When - syncing it, with the file on disk
      const synced = sync(text, {
        doesExist: (filePath) => filePath === "docs/decisions/notes.md",
        records: [],
      });

      // Then - kept
      expect(synced).toBe(text);
    });

    test("drops a line whose record is gone", () => {
      // Given - a line for a record no longer on disk, between two others
      const text = "- [A](a.md)\n- [Gone](gone.md) - x\n- [B](b.md)\n";

      // When - syncing it
      const synced = sync(text, { records: [A, B] });

      // Then - only the gone one dropped
      expect(synced).toBe(
        "- [A](a.md) - The first.\n- [B](b.md) - The second.\n"
      );
    });

    test("keeps a gone record's line when lines are written under it", () => {
      // Given - a gone record's line with a note under it
      const text =
        "- [A](a.md)\n- [Gone](gone.md) - x\n  - A note.\n- [B](b.md)\n";

      // When - syncing it
      const synced = sync(text, { records: [A, B] });

      // Then - the gone line and its note as written, the others synced
      expect(synced).toBe(
        "- [A](a.md) - The first.\n- [Gone](gone.md) - x\n  - A note.\n- [B](b.md) - The second.\n"
      );
    });

    test("drops a run whose every record is gone", () => {
      // Given - a run of gone records under a heading
      const text =
        "# Decisions\n\n- [Gone](gone.md)\n- [Old](sub/old.md)\n\nText.\n";

      // When - syncing it with no records
      const synced = sync(text, { records: [] });

      // Then - the run gone, the lines around it kept
      expect(synced).toBe("# Decisions\n\n\nText.\n");
    });

    test("drops a gone record anywhere in a root index", () => {
      // Given - a root index linking to a gone record in a folder
      const text =
        "# Root\n\n- [Gone](docs/gone.md)\n- [Other](https://x.test)\n";

      // When - syncing it
      const synced = sync(text, { indexPath: "index.md", records: [] });

      // Then - the gone one dropped
      expect(synced).toBe("# Root\n\n- [Other](https://x.test)\n");
    });

    test.each([
      {
        description: "an angle-bracket target",
        path: "docs/decisions/my record.md",
        target: "<my record.md>",
      },
      {
        description: "a percent-encoded target",
        path: "docs/decisions/my record.md",
        target: "my%20record.md",
      },
      {
        description: "a malformed percent-encoding, read as written",
        path: "docs/decisions/100%.md",
        target: "100%.md",
      },
    ])("finds the record behind $description", ({ path, target }) => {
      // Given - a record linked that way
      const record = makeRecord({ path, title: "Mine" });

      // When - syncing its line
      const synced = sync(`- [Old](${target})\n`, { records: [record] });

      // Then - rewritten, the target as written
      expect(synced).toBe(`- [Mine](${target})\n`);
    });
  });

  describe("missing records", () => {
    test("adds a record to the first run, in its style, sorted", () => {
      // Given - two runs in another style, neither listing b
      const text =
        "* [x](c.md): Old.\n* [x](a.md): Old.\n\nText.\n\n- [x](z.md)\n";
      const z = makeRecord({ path: "docs/decisions/z.md", title: "Z" });

      // When - syncing it
      const synced = sync(text, { records: [A, B, C, z] });

      // Then - b joins the first run, as its first item is written
      expect(synced).toBe(
        "* [A](a.md): The first.\n* [B](b.md): The second.\n* [C](c.md): The third.\n\nText.\n\n- [Z](z.md)\n"
      );
    });

    test.each([
      {
        description: "a blank line after it",
        expected: "# Decisions\n\n- [A](a.md) - The first.\n\nIntro.\n",
        text: "# Decisions\n\nIntro.\n",
      },
      {
        description: "a line right after it",
        expected: "# Decisions\n\n- [A](a.md) - The first.\n\nIntro.\n",
        text: "# Decisions\nIntro.\n",
      },
      {
        description: "it as the last line",
        expected: "# Decisions\n\n- [A](a.md) - The first.\n",
        text: "# Decisions\n",
      },
      {
        description: "it as the last line, with no line break",
        expected: "# Decisions\n\n- [A](a.md) - The first.\n",
        text: "# Decisions",
      },
      {
        description: "prose before it and an empty heading",
        expected: "Intro.\n\n##\n\n- [A](a.md) - The first.\n",
        text: "Intro.\n\n##\n",
      },
    ])(
      "adds a first list under the first heading, with $description",
      (row) => {
        // When - syncing an index with no record lines
        const synced = sync(row.text, { records: [A] });

        // Then - a new list under the heading, set off by blank lines
        expect(synced).toBe(row.expected);
      }
    );

    test.each([
      {
        description: "a line break",
        expected: "Intro.\n\n- [A](a.md) - The first.\n",
        text: "Intro.\n",
      },
      {
        description: "no line break",
        expected: "Intro.\n\n- [A](a.md) - The first.\n",
        text: "Intro.",
      },
      {
        description: "a blank line",
        expected: "Intro.\n\n- [A](a.md) - The first.\n",
        text: "Intro.\n\n",
      },
      {
        description: "nothing",
        expected: "- [A](a.md) - The first.\n",
        text: "",
      },
      {
        description: "a heading in fenced code only",
        expected: "```\n# Not a heading\n```\n\n- [A](a.md) - The first.\n",
        text: "```\n# Not a heading\n```\n",
      },
    ])(
      "adds a first list at the end, with no heading, after $description",
      (row) => {
        // When - syncing an index with no heading and no record lines
        const synced = sync(row.text, { records: [A] });

        // Then - a new list at the end
        expect(synced).toBe(row.expected);
      }
    );

    test.each([
      {
        description: "a space",
        expected: "- [Mine](<my record.md>)\n",
        path: "docs/decisions/my record.md",
      },
      {
        description: "a parenthesis",
        expected: "- [Mine](<a(1).md>)\n",
        path: "docs/decisions/a(1).md",
      },
      {
        description: "a subfolder",
        expected: "- [Mine](sub/a.md)\n",
        path: "docs/decisions/sub/a.md",
      },
    ])("links a new record with $description in its path", (row) => {
      // Given - a record no line lists
      const record = makeRecord({ path: row.path, title: "Mine" });

      // When - syncing an empty index
      const synced = sync("", { records: [record] });

      // Then - a target the link can hold
      expect(synced).toBe(row.expected);
    });
  });

  describe("what it keeps", () => {
    test("leaves fenced code alone", () => {
      // Given - record lines inside backtick and tilde fences
      const text = [
        "````md",
        "- [Old](a.md)",
        "```",
        "```` not a close",
        "~~~~",
        "- [Old](a.md)",
        "````",
        "",
        "~~~~",
        "- [Old](a.md)",
        "~~~",
        "```",
        "~~~~~",
        "",
        "- [Old](a.md)",
        "",
      ].join("\n");

      // When - syncing it
      const synced = sync(text, { records: [A] });

      // Then - only the line after the fences rewritten
      expect(synced).toBe(
        text.replace(/- \[Old\]\(a\.md\)\n$/u, "- [A](a.md) - The first.\n")
      );
    });

    test("keeps a root index's frontmatter byte for byte", () => {
      // Given - a root index with frontmatter in its own style
      const frontmatter = '---\nokf_version:   "0.2"  # pinned\n---\n';
      const text = `${frontmatter}\n# Root\n\n- [Old](docs/decisions/a.md)\n`;

      // When - syncing it
      const synced = sync(text, { indexPath: "index.md", records: [A] });

      // Then - the frontmatter as it was, the line rewritten
      expect(synced).toBe(
        `${frontmatter}\n# Root\n\n- [A](docs/decisions/a.md) - The first.\n`
      );
    });

    test("adds a line after frontmatter that ends the file", () => {
      // Given - an index of frontmatter alone, with no final line break
      const text = "---\nokf_version: '0.2'\n---";

      // When - syncing it with a record no line lists
      const synced = sync(text, { records: [A] });

      // Then - the closing fence kept whole, the line after it
      expect(synced).toBe(
        "---\nokf_version: '0.2'\n---\n- [A](a.md) - The first.\n"
      );
    });

    test("leaves frontmatter that ends the file alone when nothing is added", () => {
      // Given - an index of frontmatter alone, with no final line break
      const text = "---\nokf_version: '0.2'\n---";

      // When/Then - syncing it with no records leaves it as it was
      expect(sync(text, { records: [] })).toBe(text);
    });

    test("reads a heading after a byte order mark, and keeps the mark", () => {
      // Given - an index with a byte order mark and no frontmatter
      const text = "﻿# Decisions\n";

      // When - syncing it
      const synced = sync(text, { records: [A] });

      // Then - the list under the heading, the mark kept
      expect(synced).toBe("﻿# Decisions\n\n- [A](a.md) - The first.\n");
    });

    test("writes CRLF line breaks in a CRLF index", () => {
      // Given - a CRLF index with frontmatter, a note under an item, and a tag index
      const text = [
        "---",
        "okf_version: '0.2'",
        "---",
        "# Decisions",
        "",
        "- [x](c.md) - Old.",
        "  - A note.",
        "- [x](a.md)",
        "",
        TAG_INDEX_START,
        TAG_INDEX_END,
        "",
      ].join("\r\n");

      // When - syncing it
      const synced = sync(text, { records: [A, B, C] });

      // Then - every line it writes ends in CRLF
      expect(synced).toBe(
        [
          "---",
          "okf_version: '0.2'",
          "---",
          "# Decisions",
          "",
          "- [A](a.md) - The first.",
          "- [B](b.md) - The second.",
          "- [C](c.md) - The third.",
          "  - A note.",
          "",
          TAG_INDEX_START,
          "",
          "- `api`",
          "  - [A](a.md)",
          "- `cli`",
          "  - [A](a.md)",
          "  - [B](b.md)",
          "",
          TAG_INDEX_END,
          "",
        ].join("\r\n")
      );
    });

    test("syncs to the same text twice", () => {
      // Given - an out-of-date index with every kind of line
      const text = [
        "# Decisions",
        "",
        "- [x](b.md) - Old.",
        "  - A note.",
        "- [Gone](gone.md)",
        "- [Site](https://example.com)",
        "",
        "```",
        "- [x](a.md)",
        "```",
        "",
        TAG_INDEX_START,
        "- `cli` — Commands.",
        "- `old` — Unused.",
        TAG_INDEX_END,
      ].join("\n");

      // When - syncing it, then syncing the result
      const once = sync(text);
      const twice = sync(once);

      // Then - the second sync changes nothing
      expect(once).not.toBe(text);
      expect(twice).toBe(once);
    });

    test("returns the text unchanged when it's current", () => {
      // Given - an index already in sync
      const text = "# Decisions\n\n- [A](a.md) - The first.\n";

      // When/Then - the same text
      expect(sync(text, { records: [A] })).toBe(text);
    });
  });

  describe("tag index", () => {
    test("lists each tag with its meaning and records, sorted", () => {
      // Given - a tag index with meanings, a tag no record carries, and one with none
      const text = [
        "# Decisions",
        "",
        "- [A](a.md) - The first.",
        "- [B](b.md) - The second.",
        "",
        TAG_INDEX_START,
        "",
        "- `old` – No longer used.  ",
        "  - [Gone](gone.md)",
        "- `cli` — Commands.",
        "* `bare`",
        "Some prose.",
        "",
        TAG_INDEX_END,
        "",
        "After.",
        "",
      ].join("\n");

      // When - syncing it
      const synced = sync(text, { records: [A, B] });

      // Then - every tag, meanings kept, records sorted, the empty ones held
      expect(synced).toBe(
        [
          "# Decisions",
          "",
          "- [A](a.md) - The first.",
          "- [B](b.md) - The second.",
          "",
          TAG_INDEX_START,
          "",
          "- `api`",
          "  - [A](a.md)",
          "- `bare`",
          "  - _No records yet._",
          "- `cli` — Commands.",
          "  - [A](a.md)",
          "  - [B](b.md)",
          "- `old` — No longer used.",
          "  - _No records yet._",
          "",
          TAG_INDEX_END,
          "",
          "After.",
          "",
        ].join("\n")
      );
    });

    test("lists only the scoped records, by title, escaped", () => {
      // Given - a record in scope with a bracketed title, one out of scope
      const scoped = makeRecord({
        path: "docs/decisions/sub dir/x.md",
        tags: ["cli"],
        title: "[Draft] X",
      });
      const text = `${TAG_INDEX_START}\n${TAG_INDEX_END}\n`;

      // When - syncing it with b out of scope
      const synced = sync(text, { records: [B, scoped], scoped: [scoped] });

      // Then - only the scoped one, its title escaped, its target bracketed
      expect(synced).toBe(
        `${TAG_INDEX_START}\n\n- \`cli\`\n  - [\\[Draft\\] X](<sub dir/x.md>)\n\n${TAG_INDEX_END}\n\n- [\\[Draft\\] X](<sub dir/x.md>)\n`
      );
    });

    test("leaves an empty tag index empty when no record has a tag", () => {
      // Given - an empty tag index, ending the file with no line break
      const text = `# Decisions\n\n- [C](c.md) - The third.\n\n${TAG_INDEX_START}\n\n${TAG_INDEX_END}`;

      // When - syncing it with a record that has no tags
      const synced = sync(text, { records: [C] });

      // Then - the markers alone, still with no final line break
      expect(synced).toBe(
        `# Decisions\n\n- [C](c.md) - The third.\n\n${TAG_INDEX_START}\n${TAG_INDEX_END}`
      );
    });

    test("keeps a record line after the tag index a record line", () => {
      // Given - a tag index before the list
      const text = `${TAG_INDEX_START}\n${TAG_INDEX_END}\n\n- [x](c.md)\n`;

      // When - syncing it
      const synced = sync(text, { records: [C] });

      // Then - the line after it rewritten
      expect(synced).toBe(
        `${TAG_INDEX_START}\n${TAG_INDEX_END}\n\n- [C](c.md) - The third.\n`
      );
    });

    test.each([
      {
        description: "a start marker alone",
        problem: "has a tag-index:start marker but no tag-index:end",
        text: `# D\n\n${TAG_INDEX_START}\n`,
      },
      {
        description: "an end marker alone",
        problem: "has a tag-index:end marker but no tag-index:start",
        text: `${TAG_INDEX_END}\n`,
      },
      {
        description: "two start markers",
        problem: "has 2 tag-index:start markers",
        text: `${TAG_INDEX_START}\n${TAG_INDEX_START}\n${TAG_INDEX_END}\n`,
      },
      {
        description: "the end before the start",
        problem: "has its tag-index:end marker before tag-index:start",
        text: `${TAG_INDEX_END}\n${TAG_INDEX_START}\n`,
      },
    ])("refuses $description", ({ problem, text }) => {
      // When - syncing an index with malformed markers
      const result = syncIndex({
        doesExist: () => false,
        indexPath: INDEX_PATH,
        records: [A],
        scoped: [A],
        text,
      });

      // Then - refused, saying why
      expect(result).toStrictEqual({ isOk: false, problem });
    });
  });
});

describe("findIndexDrift", () => {
  test("says why it can't read an index okf index refuses", () => {
    // Given - a tag index that never closes, over a stale line
    const text = `- [Old](a.md)\n${TAG_INDEX_START}\n`;

    // When/Then - the problem, as syncIndex gives it
    expect(
      findIndexDrift({
        doesExist: () => false,
        indexPath: INDEX_PATH,
        records: [A],
        scoped: [A],
        text,
      })
    ).toStrictEqual({
      isOk: false,
      problem: expect.stringContaining("tag-index:end") as string,
    });
  });

  test("leaves a record linked twice in a row in order", () => {
    // Given - B listed twice, then C
    const text =
      "- [B](b.md) - The second.\n- [B](b.md) - The second.\n- [C](c.md) - The third.\n";

    // When/Then - nothing out of order
    expect(
      findIndexDrift({
        doesExist: () => false,
        indexPath: INDEX_PATH,
        records: [B, C],
        scoped: [B, C],
        text,
      })
    ).toStrictEqual({ drift: [], isOk: true });
  });

  test("names the line that sorts before the line above it", () => {
    // Given - a run written as B, C, A
    const text = sync("", { records: [B, C], scoped: [B, C] }).replace(
      /$/u,
      "- [A](a.md) - The first.\n"
    );

    // When/Then - A, on line 3, not B, which is in order with C
    expect(
      findIndexDrift({
        doesExist: () => false,
        indexPath: INDEX_PATH,
        records: [A, B, C],
        scoped: [A, B, C],
        text,
      })
    ).toStrictEqual({
      drift: [{ kind: "order", line: 3, recordPath: A.path }],
      isOk: true,
    });
  });

  test("reports a missing record that sorts first, and no line out of order", () => {
    // Given - a root index listing B then C, with A, which sorts first, missing
    const records = [A, B, C];
    const text = `---\nokf_version: "0.3"\n---\n${sync("", { records: [B, C], scoped: [B, C] })}`;

    // When - finding the drift with every record in scope
    const drift = findIndexDrift({
      doesExist: () => false,
      indexPath: INDEX_PATH,
      records,
      scoped: records,
      text,
    });

    // Then - only the missing record
    expect(drift).toStrictEqual({
      drift: [{ kind: "missing", line: undefined, recordPath: A.path }],
      isOk: true,
    });
  });
});
