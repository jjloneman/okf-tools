import { chmodSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { record, useTestRepo, VERIFIED_BY } from "#test/repo";

import type { MigrateMode } from "./migrate.ts";
import type { Output } from "./output.ts";
import type { RunContext } from "./run-context.ts";
import type { StatusReport } from "./status.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { formatDiff, runMigrate } from "./migrate.ts";
import { runStatus } from "./status.ts";

const { repo } = useTestRepo();

/** A v0.2 root index.md that already has a title and a description. */
const INDEX = `---
okf_version: "0.2"
title: Knowledge
description: What we know.
---

# Knowledge
`;

/** A record below the bundle root, linking to a file from the root. */
const NESTED = record(["type: Decision", "resource: a.md"]);

let data: string[];
let errors: string[];
let infos: string[];

beforeEach(() => {
  data = [];
  errors = [];
  infos = [];
});

/** An output that collects its lines, with no prefix. */
function collectOutput(): Output {
  return {
    data: (text) => data.push(text),
    error: (message) => errors.push(message),
    info: (message) => infos.push(message),
  };
}

/** Run `okf migrate` over the given bundles, from the repo root. */
function migrate(params: {
  /**
   * The bundle directories, from the repo root.
   *
   * @example `["docs/kb"]`
   */
  bundleDirs?: readonly string[];

  /**
   * Globs of folders and files that hold no records.
   *
   * @example `["docs/kb/drafts"]`
   */
  excludeGlobs?: readonly string[];

  /**
   * What to do with the plans.
   *
   * @example "write"
   */
  mode: MigrateMode;
}): number {
  const { bundleDirs = ["docs/kb"], excludeGlobs = [], mode } = params;

  return runMigrate({
    context: {
      bundleDirs,
      cwd: repo.root,
      excludeGlobs,
      output: collectOutput(),
      repoRoot: repo.root,
    },
    mode,
  });
}

/** Read the status report for the given bundles, as `okf status` prints it. */
function readStatus(bundleDirs: readonly string[]): StatusReport {
  const printed: string[] = [];
  const context: RunContext = {
    bundleDirs,
    cwd: repo.root,
    excludeGlobs: [],
    output: {
      data: (text) => printed.push(text),
      error: (message) => printed.push(message),
      info: (message) => printed.push(message),
    },
    repoRoot: repo.root,
    shouldCommit: false,
    style: "match",
    verifiedBy: VERIFIED_BY,
  };

  runStatus({
    context,
    options: {
      bundles: [],
      by: undefined,
      filters: [],
      format: "json",
      recordPaths: [],
    },
  });

  return JSON.parse(printed.join("\n")) as StatusReport;
}

/** A record signed off by `VERIFIED_BY`, with extra frontmatter and a body. */
function signedRecord(params: {
  /**
   * The body after the frontmatter.
   *
   * @example `"\n[A](a.md)\n"`
   */
  body: string;

  /**
   * Frontmatter lines after the sign-off.
   *
   * @example `["resource: a.md"]`
   */
  extra?: readonly string[];
}): string {
  const { body, extra = [] } = params;

  return [
    "---",
    "type: Decision",
    "status: stable",
    "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
    `verified: { by: ${VERIFIED_BY}, at: 2026-10-02T13:30:00Z }`,
    ...extra,
    "---",
    body,
  ].join("\n");
}

/** Write a v0.2 bundle with a record at its root and one in a folder. */
function writeBundle(): void {
  repo.write("docs/kb/index.md", INDEX);
  repo.write("docs/kb/a.md", record(["type: Decision"]));
  repo.write("docs/kb/guides/b.md", NESTED);
}

describe("runMigrate", () => {
  test("prints each change as a diff on a dry run, writing nothing", () => {
    // Given - a bundle that needs migrating
    writeBundle();

    // When - a dry run
    const code = migrate({ mode: "dry-run" });

    // Then - the diffs, and what --write would do
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(data).toStrictEqual([
      [
        "--- a/docs/kb/index.md",
        "+++ b/docs/kb/index.md",
        "@@ -2 +2 @@",
        '-okf_version: "0.2"',
        '+okf_version: "0.3"',
      ].join("\n"),
      [
        "--- a/docs/kb/guides/b.md",
        "+++ b/docs/kb/guides/b.md",
        "@@ -3 +3 @@",
        "-resource: a.md",
        "+resource: ../a.md",
      ].join("\n"),
    ]);
    expect(infos).toStrictEqual([
      "docs/kb would move from OKF v0.2 to v0.3, changing 2 files; run okf migrate --write to apply it.",
    ]);
    expect(repo.read("docs/kb/index.md")).toBe(INDEX);
    expect(repo.read("docs/kb/guides/b.md")).toBe(NESTED);
  });

  test("writes the changes, then finds the bundle current", () => {
    // Given - a bundle that needs migrating
    writeBundle();

    // When - writing, then running again
    const code = migrate({ mode: "write" });
    const again = migrate({ mode: "write" });

    // Then - migrated once, then current
    expect(code).toBe(EXIT_CODES.ok);
    expect(again).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      "Migrated docs/kb from OKF v0.2 to v0.3, changing 2 files.",
      "docs/kb is already on OKF v0.3.",
    ]);
    expect(repo.read("docs/kb/index.md")).toBe(INDEX.replace('"0.2"', '"0.3"'));
    expect(repo.read("docs/kb/guides/b.md")).toBe(
      record(["type: Decision", "resource: ../a.md"])
    );
  });

  test("fails a check while a bundle needs migrating, writing nothing", () => {
    // Given - an undeclared bundle whose only change is its index
    repo.write("docs/kb/index.md", "# Knowledge\n\nWhat we know.\n");

    // When - checking
    const code = migrate({ mode: "check" });

    // Then - it fails, saying what to run, after what it would fill in
    expect(code).toBe(EXIT_CODES.failure);
    expect(infos).toStrictEqual([
      'docs/kb/index.md title filled in as "Knowledge".',
      'docs/kb/index.md description filled in as "What we know.".',
    ]);
    expect(errors).toStrictEqual([
      "docs/kb is on OKF v0.2 (undeclared) and needs migrating to v0.3 (1 file); run okf migrate --write.",
    ]);
    expect(repo.read("docs/kb/index.md")).toBe(
      "# Knowledge\n\nWhat we know.\n"
    );
  });

  test("passes a check once every bundle is current", () => {
    // Given - a bundle on v0.3
    repo.write("docs/kb/index.md", '---\nokf_version: "0.3"\n---\n');

    // When - checking
    const code = migrate({ mode: "check" });

    // Then - it passes
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual(["docs/kb is already on OKF v0.3."]);
  });

  test("prints what needs a person beside a migration it still writes", () => {
    // Given - a v0.1 bundle with a link to nothing and no description
    repo.write("docs/kb/index.md", '---\nokf_version: "0.1"\n---\n# K\n');
    repo.write(
      "docs/kb/guides/b.md",
      record(["type: Decision", "resource: gone.md"])
    );

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - the notes on stderr, and the one file written
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      "Check: docs/kb/index.md has no paragraph after its first heading to take a description from; add description to its frontmatter by hand.",
      'Check: docs/kb/guides/b.md resource "gone.md" names no file under either rule.',
    ]);
    expect(infos).toStrictEqual([
      'docs/kb/index.md title filled in as "K".',
      "Migrated docs/kb from OKF v0.1 to v0.3, changing 1 file.",
    ]);
  });

  test("refuses a bundle a person must settle, and fails", () => {
    // Given - a bundle declaring a newer version
    repo.write("docs/kb/index.md", '---\nokf_version: "0.9"\n---\n');
    repo.write("docs/kb/guides/b.md", NESTED);

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - why, and nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      'Blocked: docs/kb/index.md declares okf_version "0.9", newer than the 0.3 okf migrate writes; upgrade okf-tools instead.',
      "docs/kb can't be migrated until the problems above are settled.",
    ]);
    expect(repo.read("docs/kb/guides/b.md")).toBe(NESTED);
  });

  test("refuses a bundle with a record it can't read", () => {
    // Given - a bundle with a record that isn't valid YAML
    writeBundle();
    repo.write("docs/kb/broken.md", "---\nstatus: [draft\n---\n");

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - refused over the record, and nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors[0]).toMatch(
      /^Blocked: docs\/kb\/broken\.md: frontmatter isn't valid YAML: .*; its paths can't be checked\.$/su
    );
    expect(errors.at(-1)).toBe(
      "docs/kb can't be migrated until the problems above are settled."
    );
    expect(repo.read("docs/kb/guides/b.md")).toBe(NESTED);
  });

  test("refuses a bundle with no root index.md", () => {
    // Given - a bundle with a record and no index
    repo.write("docs/kb/guides/b.md", NESTED);

    // When - a dry run
    const code = migrate({ mode: "dry-run" });

    // Then - refused, saying how to fix it
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "Blocked: docs/kb/index.md doesn't exist, so the bundle can't declare okf_version 0.3; add one with a heading, then run okf migrate again.",
      "docs/kb can't be migrated until the problems above are settled.",
    ]);
  });

  test("refuses a bundle whose root index.md is a symlink", () => {
    // Given - an index that links to a file elsewhere
    writeBundle();
    repo.write("elsewhere.md", INDEX);
    rmSync(path.join(repo.root, "docs/kb/index.md"));
    symlinkSync(
      path.join(repo.root, "elsewhere.md"),
      path.join(repo.root, "docs/kb/index.md")
    );

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - refused, saying why, and the linked file untouched
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors[0]).toBe(
      "Blocked: docs/kb/index.md is a symlink, which is written only at its own path; its paths can't be checked."
    );
    expect(repo.read("elsewhere.md")).toBe(INDEX);
  });

  test("refuses a bundle whose root index.md isn't UTF-8", () => {
    // Given - an index of bytes that aren't UTF-8
    writeBundle();
    writeFileSync(
      path.join(repo.root, "docs/kb/index.md"),
      Buffer.from([0xff, 0xfe, 0x00])
    );

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - refused, saying why
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors[0]).toBe(
      "Blocked: docs/kb/index.md can't be read: it isn't valid UTF-8; its paths can't be checked."
    );
  });

  test("counts each record in the deepest bundle that holds it", () => {
    // Given - a v0.3 bundle inside a v0.2 one, its record linking from its root
    writeBundle();
    repo.write("docs/kb/inner/index.md", '---\nokf_version: "0.3"\n---\n');
    repo.write(
      "docs/kb/inner/deep/x.md",
      record(["type: Decision", "resource: guides/b.md"])
    );

    // When - a dry run over both
    const code = migrate({
      bundleDirs: ["docs/kb", "docs/kb/inner"],
      mode: "dry-run",
    });

    // Then - the outer bundle plans only its own records
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      "docs/kb would move from OKF v0.2 to v0.3, changing 2 files; run okf migrate --write to apply it.",
      "docs/kb/inner is already on OKF v0.3.",
    ]);
  });

  test("migrates a bundle at the repo root beside a bundle inside it", () => {
    // Given - the repo root as a bundle, holding a v0.3 bundle
    repo.write("index.md", INDEX);
    repo.write("a.md", record(["type: Decision"]));
    repo.write("guides/b.md", NESTED);
    repo.write("docs/kb/index.md", '---\nokf_version: "0.3"\n---\n');
    repo.write("docs/kb/guides/b.md", NESTED);

    // When - writing both
    const code = migrate({ bundleDirs: [".", "docs/kb"], mode: "write" });

    // Then - only the root bundle's own records rewritten
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("guides/b.md")).toBe(
      record(["type: Decision", "resource: ../a.md"])
    );
    expect(repo.read("docs/kb/guides/b.md")).toBe(NESTED);
  });

  test("rewrites the links in a folder's index.md and log.md", () => {
    // Given - committed folder files linking from the root, beside ones it
    // skips: the root's own log, an excluded folder, a file git still
    // tracks but that's gone, and a file outside the bundle
    const link = "- [A](a.md)\n";

    repo.write("docs/kb/index.md", INDEX);
    repo.write("docs/kb/a.md", record(["type: Decision"]));
    repo.write("docs/kb/log.md", `# Log\n\n${link}`);
    repo.write("docs/kb/guides/index.md", `# Guides\n\n${link}`);
    repo.write("docs/kb/guides/log.md", `# Log\n\n${link}`);
    repo.write("docs/kb/drafts/index.md", `# Drafts\n\n${link}`);
    repo.write("docs/kb/gone/log.md", `# Log\n\n${link}`);
    repo.write("docs/other/index.md", `# Other\n\n${link}`);
    repo.commitAll("bundle");
    rmSync(path.join(repo.root, "docs/kb/gone/log.md"));

    // When - writing
    const code = migrate({ excludeGlobs: ["docs/kb/drafts"], mode: "write" });

    // Then - only the bundle's own folder files rewritten
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("docs/kb/guides/index.md")).toBe(
      "# Guides\n\n- [A](../a.md)\n"
    );
    expect(repo.read("docs/kb/guides/log.md")).toBe(
      "# Log\n\n- [A](../a.md)\n"
    );
    expect(repo.read("docs/kb/log.md")).toBe(`# Log\n\n${link}`);
    expect(repo.read("docs/kb/drafts/index.md")).toBe(`# Drafts\n\n${link}`);
    expect(repo.read("docs/other/index.md")).toBe(`# Other\n\n${link}`);
  });

  test("refuses a bundle with a folder's log.md that's a symlink", () => {
    // Given - a folder's log.md that links elsewhere
    repo.write("docs/kb/index.md", INDEX);
    repo.write("docs/kb/a.md", record(["type: Decision"]));
    repo.write("docs/elsewhere.md", "# Log\n");
    repo.write("docs/kb/guides/b.md", record(["type: Decision"]));
    symlinkSync(
      "../../elsewhere.md",
      path.join(repo.root, "docs/kb/guides/log.md")
    );
    repo.commitAll("bundle");

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - refused, naming it
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors[0]).toBe(
      "Blocked: docs/kb/guides/log.md is a symlink, which is written only at its own path; its paths can't be checked."
    );
  });

  test("rewrites untracked folder files and Markdown with no frontmatter", () => {
    // Given - uncommitted folder files linking from the root, and one in a
    // dot folder, which isn't part of the bundle
    const link = "- [A](a.md)\n";

    repo.write("docs/kb/index.md", INDEX);
    repo.write("docs/kb/a.md", record(["type: Decision"]));
    repo.write("docs/kb/guides/index.md", `# Guides\n\n${link}`);
    repo.write("docs/kb/guides/howto.md", `# How to\n\n${link}`);
    repo.write("docs/kb/.drafts/notes.md", `# Notes\n\n${link}`);

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - both rewritten, the dot folder left alone
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("docs/kb/guides/index.md")).toBe(
      "# Guides\n\n- [A](../a.md)\n"
    );
    expect(repo.read("docs/kb/guides/howto.md")).toBe(
      "# How to\n\n- [A](../a.md)\n"
    );
    expect(repo.read("docs/kb/.drafts/notes.md")).toBe(`# Notes\n\n${link}`);
  });

  test("prints a diff line without the escape sequences it holds", () => {
    // Given - a rewritten line that holds an escape sequence
    repo.write("docs/kb/index.md", INDEX);
    repo.write("docs/kb/a.md", record(["type: Decision"]));
    repo.write("docs/kb/guides/b.md", "# B\n\n[A](a.md)\u001b]0;x\u0007\n");

    // When - a dry run
    migrate({ mode: "dry-run" });

    // Then - the sequence's control characters are gone
    expect(data.join("\n")).toContain("+[A](../a.md) ]0;x");
    expect(data.join("\n")).not.toContain("\u001b");
    expect(data.join("\n")).not.toContain("\u0007");
  });

  test("changes nothing when a change can't be written", () => {
    // Given - a record that can't be written
    writeBundle();
    const indexBefore = repo.read("docs/kb/index.md");
    chmodSync(path.join(repo.root, "docs/kb/guides/b.md"), 0o444);

    // When - writing
    const code = migrate({ mode: "write" });

    // Then - why, exit 1, and the index still on its old version
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^Couldn't write docs\/kb\/guides\/b\.md: .*EACCES.*\nNo files changed\.$/su
    );
    expect(infos).toStrictEqual([]);
    expect(repo.read("docs/kb/index.md")).toBe(indexBefore);
  });

  test("fails when the bundles can't be listed", () => {
    // Given/When - a bundle that doesn't exist
    const code = migrate({ bundleDirs: ["docs/missing"], mode: "dry-run" });

    // Then - why, and exit 1
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("docs/missing");
  });

  test.each([
    { description: "v0.1", version: "0.1" },
    { description: "v0.2", version: "0.2" },
  ])(
    "keeps every sign-off when migrating a $description bundle",
    ({ version }) => {
      // Given - nested signed-off records, with links of every kind
      repo.write(
        "docs/kb/index.md",
        `---\nokf_version: "${version}"\ntitle: K\ndescription: D\n---\n# K\n`
      );
      repo.write(
        "docs/kb/a.md",
        signedRecord({ body: "\n[C](guides/deep/c.md)\n" })
      );
      repo.write(
        "docs/kb/guides/b.md",
        signedRecord({
          body: [
            "",
            "Root-relative [A](a.md) and [C](guides/deep/c.md#top).",
            "Already relative [A](../a.md) and [C](deep/c.md).",
            "In code `[A](a.md)` and:",
            "",
            "```md",
            "[A](a.md)",
            "```",
            "",
          ].join("\n"),
          extra: [
            "resource: a.md",
            "sources: [{ resource: guides/deep/c.md }]",
          ],
        })
      );
      repo.write(
        "docs/kb/guides/deep/c.md",
        signedRecord({ body: "\n[B](guides/b.md)\n" })
      );
      repo.commitAll("add the bundle");
      const before = readStatus(["docs/kb"]);

      // When - writing, then running again
      const code = migrate({ mode: "write" });
      const again = migrate({ mode: "dry-run" });

      // Then - links rewritten, sign-offs as they were, and nothing left
      expect(code).toBe(EXIT_CODES.ok);
      expect(again).toBe(EXIT_CODES.ok);
      expect(errors).toStrictEqual([]);
      expect(infos.at(-1)).toBe("docs/kb is already on OKF v0.3.");
      expect(readStatus(["docs/kb"])).toStrictEqual(before);
      expect(before.records.map((entry) => entry.group)).toStrictEqual([
        "settled",
        "settled",
        "settled",
      ]);
      expect(repo.read("docs/kb/guides/b.md")).toBe(
        signedRecord({
          body: [
            "",
            "Root-relative [A](../a.md) and [C](deep/c.md#top).",
            "Already relative [A](../a.md) and [C](deep/c.md).",
            "In code `[A](a.md)` and:",
            "",
            "```md",
            "[A](a.md)",
            "```",
            "",
          ].join("\n"),
          extra: ["resource: ../a.md", "sources: [{ resource: deep/c.md }]"],
        })
      );
      expect(repo.read("docs/kb/guides/deep/c.md")).toBe(
        signedRecord({ body: "\n[B](../b.md)\n" })
      );
      expect(repo.read("docs/kb/a.md")).toBe(
        signedRecord({ body: "\n[C](guides/deep/c.md)\n" })
      );
    }
  );
});

describe("formatDiff", () => {
  test.each([
    {
      after: "a\nx\nc\n",
      before: "a\nb\nc\n",
      description: "a changed line",
      expected: ["@@ -2 +2 @@", "-b", "+x"],
    },
    {
      after: "x\na\n",
      before: "a\n",
      description: "a line added at the top",
      expected: ["@@ -0,0 +1 @@", "+x"],
    },
    {
      after: "a\n",
      before: "a\nb\nc\n",
      description: "lines removed at the end",
      expected: ["@@ -2,2 +1,0 @@", "-b", "-c"],
    },
    {
      after: "x\r\nb\r\ny\r\nz\r\n",
      before: "a\r\nb\r\nc\r\n",
      description: "two hunks, with CRLF line breaks",
      expected: ["@@ -1 +1 @@", "-a", "+x", "@@ -3 +3,2 @@", "-c", "+y", "+z"],
    },
    {
      after: "a\n",
      before: "",
      description: "a new file",
      expected: ["@@ -0,0 +1 @@", "+a"],
    },
    {
      after: "a\nb\n",
      before: "a\n",
      description: "a line added at the end",
      expected: ["@@ -1,0 +2 @@", "+b"],
    },
    {
      after: "x\ny\n",
      before: "a\nb\n",
      description: "every line replaced",
      expected: ["@@ -1,2 +1,2 @@", "-a", "-b", "+x", "+y"],
    },
    {
      after: "a\n",
      before: "a\n",
      description: "no change",
      expected: [],
    },
  ])("prints $description", ({ after, before, expected }) => {
    // Given/When - diffing two texts
    const diff = formatDiff({ after, before, filePath: "docs/a.md" });

    // Then - the headers, then each hunk with no context
    expect(diff).toBe(
      ["--- a/docs/a.md", "+++ b/docs/a.md", ...expected].join("\n")
    );
  });
});
