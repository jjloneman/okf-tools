import { chmodSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { record, useTestRepo } from "#test/repo";

import type { Output } from "./output.ts";
import type { BundleContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { findNearestIndex, runIndex, toIndexRecord } from "./index-command.ts";
import { TAG_INDEX_START } from "./index-sync.ts";

const { repo } = useTestRepo();

let errors: string[];
let infos: string[];

beforeEach(() => {
  errors = [];
  infos = [];
});

/** An output that collects its lines, with no prefix. */
function collectOutput(): Output {
  return {
    data: (text) => infos.push(text),
    error: (message) => errors.push(message),
    info: (message) => infos.push(message),
  };
}

/** A fabricated record with a title, a description, and tags. */
function indexedRecord(params: {
  /**
   * Its description.
   *
   * @example "The first."
   */
  description: string;

  /**
   * Its tags.
   *
   * @example `["cli"]`
   */
  tags?: readonly string[];

  /**
   * Its title.
   *
   * @example "A"
   */
  title: string;
}): string {
  const { description, tags = [], title } = params;

  return record([
    "type: Decision",
    `title: ${title}`,
    `description: ${description}`,
    `tags: [${tags.join(", ")}]`,
  ]);
}

/** Run `okf index` over the given bundles, from the repo root. */
function syncBundles(params: {
  /**
   * The bundle directories, from the repo root.
   *
   * @example `["docs/decisions"]`
   */
  bundleDirs: readonly string[];

  /**
   * Globs of folders and files that hold no records.
   *
   * @example `["docs/decisions/templates"]`
   */
  excludeGlobs?: readonly string[];

  /**
   * Whether to only report.
   *
   * @example true
   */
  isCheck?: boolean;
}): number {
  const { bundleDirs, excludeGlobs = [], isCheck = false } = params;
  const context: BundleContext = {
    bundleDirs,
    cwd: repo.root,
    excludeGlobs,
    output: collectOutput(),
    repoRoot: repo.root,
  };

  return runIndex({ context, isCheck });
}

/** Write a bundle of two records and an out-of-date index for them. */
function writeBundle(): void {
  repo.write(
    "docs/decisions/a.md",
    indexedRecord({ description: "The first.", tags: ["cli"], title: "A" })
  );
  repo.write(
    "docs/decisions/b.md",
    indexedRecord({ description: "The second.", title: "B" })
  );
  repo.write("docs/decisions/index.md", "# Decisions\n\n- [Old](b.md)\n");
}

describe("runIndex", () => {
  test("writes an out-of-date index, and says so", () => {
    // Given - an index missing a record and listing another by an old title
    writeBundle();

    // When - syncing it
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - rewritten, and reported
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual(["Updated docs/decisions/index.md."]);
    expect(repo.read("docs/decisions/index.md")).toBe(
      "# Decisions\n\n- [A](a.md) - The first.\n- [B](b.md) - The second.\n"
    );
  });

  test("only reports an out-of-date index under check, and fails", () => {
    // Given - an out-of-date index
    writeBundle();

    // When - checking it
    const code = syncBundles({ bundleDirs: ["docs/decisions"], isCheck: true });

    // Then - reported, not written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/index.md is out of date; run okf index to sync it.",
    ]);
    expect(repo.read("docs/decisions/index.md")).toBe(
      "# Decisions\n\n- [Old](b.md)\n"
    );
  });

  test.each([
    { description: "syncing", isCheck: false },
    { description: "checking", isCheck: true },
  ])("says every index is current when $description", ({ isCheck }) => {
    // Given - an index already synced
    writeBundle();
    syncBundles({ bundleDirs: ["docs/decisions"] });
    infos = [];

    // When - running again
    const code = syncBundles({ bundleDirs: ["docs/decisions"], isCheck });

    // Then - nothing to do
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual(["Every index is current."]);
  });

  test("says so when the bundles have no index", () => {
    // Given - a record with no index above it
    repo.write(
      "docs/decisions/a.md",
      indexedRecord({ description: "The first.", title: "A" })
    );

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - nothing to sync
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual(["No index.md in the bundles to sync."]);
  });

  test("drops a gone record from a bundle's index that lists no record", () => {
    // Given - an index whose only record was removed
    repo.write("docs/decisions/index.md", "# Decisions\n\n- [Gone](gone.md)\n");

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - the line dropped
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("docs/decisions/index.md")).toBe("# Decisions\n\n");
  });

  test("drops a gone record from a tracked subfolder index that lists no record", () => {
    // Given - a committed subfolder index whose only record was removed
    writeBundle();
    repo.write(
      "docs/decisions/archive/index.md",
      "# Archive\n\n- [Old](old.md)\n"
    );
    repo.commitAll("add the archive");

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - the archive's stale line dropped
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("docs/decisions/archive/index.md")).toBe("# Archive\n\n");
  });

  test("leaves a tracked index outside the bundles alone", () => {
    // Given - a committed index.md in no bundle
    writeBundle();
    repo.write("notes/index.md", "# Notes\n\n- [Old](old.md)\n");
    repo.commitAll("add notes");

    // When - syncing the bundle
    syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - the other index as written
    expect(repo.read("notes/index.md")).toBe("# Notes\n\n- [Old](old.md)\n");
  });

  test("leaves a tracked index in an excluded folder alone", () => {
    // Given - a committed index in a folder okf.exclude names
    writeBundle();
    repo.write("docs/decisions/templates/index.md", "# T\n\n- [Old](old.md)\n");
    repo.commitAll("add templates");

    // When - syncing with that folder excluded
    syncBundles({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: ["docs/decisions/templates"],
    });

    // Then - the excluded index as written
    expect(repo.read("docs/decisions/templates/index.md")).toBe(
      "# T\n\n- [Old](old.md)\n"
    );
  });

  test("prints a refusal's control characters as spaces", () => {
    // Given - a record whose YAML error quotes an escape character
    writeBundle();
    repo.write("docs/decisions/broken.md", "---\ntitle: [A\u001b[31m\n---\n");

    // When - syncing
    syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - one line, with no escape character
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain("\u001b");
    expect(errors[0]).not.toContain("\n");
  });

  test("lists each record in its nearest index", () => {
    // Given - a subfolder with its own index, and one without
    writeBundle();
    repo.write(
      "docs/decisions/own/c.md",
      indexedRecord({ description: "The third.", title: "C" })
    );
    repo.write("docs/decisions/own/index.md", "# Own\n");
    repo.write(
      "docs/decisions/shared/d.md",
      indexedRecord({ description: "The fourth.", title: "D" })
    );

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - c in its own index, d in the bundle's, each index reported in order
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "Updated docs/decisions/index.md.",
      "Updated docs/decisions/own/index.md.",
    ]);
    expect(repo.read("docs/decisions/index.md")).toBe(
      "# Decisions\n\n- [A](a.md) - The first.\n- [B](b.md) - The second.\n- [D](shared/d.md) - The fourth.\n"
    );
    expect(repo.read("docs/decisions/own/index.md")).toBe(
      "# Own\n\n- [C](c.md) - The third.\n"
    );
  });

  test("reports the indexes in path order, whatever the bundles' order", () => {
    // Given - two bundles, each with an index missing its record
    repo.write(
      "docs/a/one.md",
      indexedRecord({ description: "The first.", title: "One" })
    );
    repo.write("docs/a/index.md", "# A\n");
    repo.write(
      "docs/b/two.md",
      indexedRecord({ description: "The second.", title: "Two" })
    );
    repo.write("docs/b/index.md", "# B\n");

    // When - syncing the later bundle first
    const code = syncBundles({ bundleDirs: ["docs/b", "docs/a"] });

    // Then - each index reported, in path order
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "Updated docs/a/index.md.",
      "Updated docs/b/index.md.",
    ]);
  });

  test("syncs a root index for a bundle of the whole repo", () => {
    // Given - a root index with frontmatter, and a record in a folder
    repo.write("index.md", "---\nokf_version: '0.2'\n---\n\n# Root\n");
    repo.write(
      "docs/a.md",
      indexedRecord({ description: "The first.", tags: ["cli"], title: "A" })
    );

    // When - syncing the bundle `.`
    const code = syncBundles({ bundleDirs: ["."] });

    // Then - the record listed under the heading, the frontmatter kept
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("index.md")).toBe(
      "---\nokf_version: '0.2'\n---\n\n# Root\n\n- [A](docs/a.md) - The first.\n"
    );
  });

  test("leaves a record in a bundle of the whole repo with no index unlisted", () => {
    // Given - a bundle `.` with a record and no index anywhere
    repo.write(
      "docs/a.md",
      indexedRecord({ description: "The first.", title: "A" })
    );

    // When - syncing it
    const code = syncBundles({ bundleDirs: ["."] });

    // Then - no index to sync
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual(["No index.md in the bundles to sync."]);
  });

  test("refuses only the index that lists a record it can't read", () => {
    // Given - an unreadable record under one index, and another bundle
    writeBundle();
    repo.write("docs/decisions/broken.md", "---\ntitle: [A\n---\n");
    repo.write(
      "docs/other/c.md",
      indexedRecord({ description: "The third.", title: "C" })
    );
    repo.write("docs/other/sub/broken.md", "---\ntitle: [A\n---\n");
    repo.write("docs/other/sub/index.md", "# Sub\n");
    repo.write("docs/loose/broken.md", "---\ntitle: [A\n---\n");

    // When - syncing every bundle
    const code = syncBundles({
      bundleDirs: ["docs/decisions", "docs/loose", "docs/other"],
    });

    // Then - the indexes listing a broken record refused, nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(
        /^docs\/decisions\/index\.md can't be synced: a record it lists can't be read\. docs\/decisions\/broken\.md/u
      ),
      expect.stringMatching(
        /^docs\/other\/sub\/index\.md can't be synced: a record it lists can't be read\. docs\/other\/sub\/broken\.md/u
      ),
    ]);
    expect(infos).toStrictEqual([]);
    expect(repo.read("docs/decisions/index.md")).toBe(
      "# Decisions\n\n- [Old](b.md)\n"
    );
  });

  test("refuses an index that's a symlink", () => {
    // Given - a bundle whose index is linked to a file elsewhere
    writeBundle();
    repo.write("elsewhere.md", "# Decisions\n");
    const indexPath = path.join(repo.root, "docs/decisions/index.md");
    rmSync(indexPath);
    symlinkSync("../../elsewhere.md", indexPath);

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - refused, the linked file untouched
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/index.md can't be synced: it's a symlink; an index is synced only at its own path",
    ]);
    expect(repo.read("elsewhere.md")).toBe("# Decisions\n");
  });

  test("refuses an index that isn't valid UTF-8", () => {
    // Given - an index with a byte UTF-8 can't hold
    writeBundle();
    writeFileSync(
      path.join(repo.root, "docs/decisions/index.md"),
      Buffer.from([0x23, 0x20, 0xff, 0x0a])
    );

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - refused, saying why
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/index.md can't be synced: it isn't valid UTF-8.",
    ]);
  });

  test("refuses an index with a malformed tag index", () => {
    // Given - a tag index with no end marker
    writeBundle();
    repo.write(
      "docs/decisions/index.md",
      `# Decisions\n\n${TAG_INDEX_START}\n`
    );

    // When - syncing
    const code = syncBundles({ bundleDirs: ["docs/decisions"] });

    // Then - refused, naming the marker
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/index.md can't be synced: it has a tag-index:start marker but no tag-index:end",
    ]);
  });

  test("fails when a folder in a bundle can't be listed", () => {
    // Given - a folder in the bundle no one can read
    writeBundle();
    repo.write(
      "docs/decisions/locked/c.md",
      indexedRecord({ description: "The third.", title: "C" })
    );
    const locked = path.join(repo.root, "docs/decisions/locked");
    chmodSync(locked, 0o000);

    try {
      // When - syncing
      const code = syncBundles({ bundleDirs: ["docs/decisions"] });

      // Then - it fails rather than drop the folder's records
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors.join("\n")).toContain("docs/decisions can't be listed");
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  // Root can write a read-only file, so the write can't fail for it.
  test.skipIf(process.getuid?.() === 0)(
    "refuses an index it can't write",
    () => {
      // Given - an out-of-date index no one can write
      writeBundle();
      const indexPath = path.join(repo.root, "docs/decisions/index.md");
      chmodSync(indexPath, 0o444);

      try {
        // When - syncing
        const code = syncBundles({ bundleDirs: ["docs/decisions"] });

        // Then - refused, saying why
        expect(code).toBe(EXIT_CODES.failure);
        expect(errors).toStrictEqual([
          expect.stringMatching(
            /^docs\/decisions\/index\.md can't be synced: EACCES/u
          ),
        ]);
      } finally {
        chmodSync(indexPath, 0o644);
      }
    }
  );
});

describe("findNearestIndex", () => {
  test.each([
    {
      description: "the record's own folder",
      expected: "docs/decisions/sub/index.md",
      indexes: ["docs/decisions/index.md", "docs/decisions/sub/index.md"],
    },
    {
      description: "a folder above it, in the bundle",
      expected: "docs/decisions/index.md",
      indexes: ["docs/decisions/index.md"],
    },
    {
      description: "no folder up to the bundle, though one above has an index",
      expected: undefined,
      indexes: ["docs/index.md"],
    },
  ])("finds $description", ({ expected, indexes }) => {
    // Given - the indexes on disk
    for (const indexPath of indexes) {
      repo.write(indexPath, "# Index\n");
    }

    // When - finding the index for a record in a subfolder
    const indexPath = findNearestIndex({
      bundleDirs: ["docs/decisions"],
      filePath: "docs/decisions/sub/a.md",
      repoRoot: repo.root,
    });

    // Then - the nearest one inside the bundle
    expect(indexPath).toBe(expected);
  });
});

describe("toIndexRecord", () => {
  test("reads a record's title, description, and tags, with none for no tags", () => {
    // Given - a candidate whose summary has no tags
    const candidate = {
      filePath: "docs/decisions/a.md",
      state: "unverified" as const,
      summary: {
        description: "The first.",
        generatedAt: undefined,
        staleAfter: undefined,
        status: undefined,
        title: "A",
        type: "Decision",
        verifiedAt: undefined,
        writtenStatus: undefined,
      },
      text: "",
    };

    // When/Then - the record as an index lists it
    expect(toIndexRecord(candidate)).toStrictEqual({
      description: "The first.",
      path: "docs/decisions/a.md",
      tags: [],
      title: "A",
    });
  });
});
