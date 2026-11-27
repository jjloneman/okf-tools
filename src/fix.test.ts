import { chmodSync, existsSync, symlinkSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { record, useTestRepo } from "#test/repo";

import type {
  CheckedBundle,
  CheckedFile,
  CheckFinding,
} from "./check-engine.ts";
import type { BundleContext } from "./run-context.ts";

import { readCheckedFile } from "./check-engine.ts";
import { applyFixes } from "./fix.ts";

const { repo } = useTestRepo();

/** Whether the tests run as root, who can write a read-only file. */
const isRoot = process.getuid?.() === 0;

/** A concept whose tags are out of order. */
const UNSORTED = record(["type: Decision", "tags: [b, a]"]);

/** A valid root `index.md`. */
const ROOT_INDEX = '---\nokf_version: "0.3"\n---\n# KB\n';

/** The bundles and output a test fixes in. */
function buildContext(
  params: {
    /**
     * The bundles, from the repo root.
     *
     * @example `["kb"]`
     */
    bundleDirs?: readonly string[];

    /**
     * The `okf.exclude` globs.
     *
     * @example `["kb/sub/index.md"]`
     */
    excludeGlobs?: readonly string[];
  } = {}
): BundleContext {
  const { bundleDirs = ["kb"], excludeGlobs = [] } = params;

  return {
    bundleDirs,
    cwd: repo.root,
    excludeGlobs,
    output: {
      data: () => undefined,
      error: () => undefined,
      info: () => undefined,
    },
    repoRoot: repo.root,
  };
}

/** A finding of a rule on a file, as `okf check` reports it. */
function finding(params: { path: string; rule: string }): CheckFinding {
  return {
    code: "H002",
    line: 1,
    message: "out of order",
    path: params.path,
    rule: params.rule,
    severity: "warning",
  };
}

/** Read files in the bundle `kb` from the scratch repo, as `okf check` does. */
function readBundle(filePaths: readonly string[]): CheckedBundle {
  return {
    bundleDir: "kb",
    files: filePaths.map((filePath) =>
      readCheckedFile({
        bundleDir: "kb",
        doesExist: (target) => existsSync(path.join(repo.root, target)),
        filePath,
        text: repo.read(filePath),
      })
    ),
  };
}

/** A file in the bundle `kb`, as `okf check` read it. */
function readFile(params: { filePath: string; text: string }): CheckedFile {
  return readCheckedFile({
    bundleDir: "kb",
    doesExist: () => true,
    ...params,
  });
}

describe("applyFixes", () => {
  test("fixes a record whose source changed since it was written", () => {
    // Given - a record with unsorted tags and a changed source
    repo.write("kb/a.md", UNSORTED);

    // When - fixing its tags, beside its source-changed finding
    const fixed = applyFixes({
      bundles: [readBundle(["kb/a.md"])],
      context: buildContext(),
      findings: [
        finding({ path: "kb/a.md", rule: "source-changed" }),
        finding({ path: "kb/a.md", rule: "tags-sorted" }),
      ],
      houseRules: { "tags-sorted": "warn" },
    });

    // Then - its tags sorted, as for any other record
    expect(fixed).toStrictEqual({
      isOk: true,
      value: {
        refusals: [],
        written: [
          {
            filePath: "kb/a.md",
            originalText: UNSORTED,
            text: record(["type: Decision", "tags: [a, b]"]),
          },
        ],
      },
    });
  });

  test("sorts a record's sources by id", () => {
    // Given - a record whose sources are out of order
    const text = record([
      "type: Decision",
      "sources:",
      "  - id: b",
      "  - id: a",
    ]);

    repo.write("kb/a.md", text);

    // When - fixing its sources-sorted finding
    const fixed = applyFixes({
      bundles: [readBundle(["kb/a.md"])],
      context: buildContext(),
      findings: [finding({ path: "kb/a.md", rule: "sources-sorted" })],
      houseRules: { "sources-sorted": "warn" },
    });

    // Then - the sources sorted, on disk too
    const sorted = record([
      "type: Decision",
      "sources:",
      "  - id: a",
      "  - id: b",
    ]);

    expect(fixed).toStrictEqual({
      isOk: true,
      value: {
        refusals: [],
        written: [{ filePath: "kb/a.md", originalText: text, text: sorted }],
      },
    });
    expect(repo.read("kb/a.md")).toBe(sorted);
  });

  test.each([
    {
      description: "a record reached through a symlink",
      prepare: (): void => {
        repo.write("kb/a.md", UNSORTED);
        symlinkSync("a.md", path.join(repo.root, "kb/link.md"));
      },
      reason:
        "kb/link.md is reached through a symlink, and is fixed only at its own path",
    },
    {
      description: "a record changed on disk since it was read",
      prepare: (): void => {
        repo.write("kb/link.md", `${UNSORTED}More.\n`);
      },
      reason:
        "kb/link.md changed on disk while it was checked; run okf check --fix again",
    },
    {
      description: "a record deleted since it was read",
      prepare: (): void => undefined,
      reason: expect.stringMatching(
        /^kb\/link\.md can't be read again: ENOENT/u
      ) as string,
    },
  ])("writes nothing to $description, naming why", ({ prepare, reason }) => {
    // Given - the record as the check read it, then the disk since
    repo.write("kb/index.md", ROOT_INDEX);
    prepare();

    // When - fixing its unsorted tags
    const fixed = applyFixes({
      bundles: [
        {
          bundleDir: "kb",
          files: [readFile({ filePath: "kb/link.md", text: UNSORTED })],
        },
      ],
      context: buildContext(),
      findings: [finding({ path: "kb/link.md", rule: "tags-sorted" })],
      houseRules: { "tags-sorted": "warn" },
    });

    // Then - refused, nothing written
    expect(fixed).toStrictEqual({
      isOk: true,
      value: { refusals: [reason], written: [] },
    });
  });

  test.skipIf(isRoot)("fails, naming every refusal, when a write fails", () => {
    // Given - a record refused, and an index that can't be written
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", record(["type: Decision", "title: A"]));
    repo.write("kb/b.md", record(["type: Decision", "tags: &t [b, a]"]));
    chmodSync(path.join(repo.root, "kb/index.md"), 0o444);

    // When - fixing both
    let fixed: ReturnType<typeof applyFixes>;

    try {
      fixed = applyFixes({
        bundles: [readBundle(["kb/a.md", "kb/b.md", "kb/index.md"])],
        context: buildContext(),
        findings: [
          finding({ path: "kb/a.md", rule: "index-entry-missing" }),
          finding({ path: "kb/b.md", rule: "tags-sorted" }),
        ],
        houseRules: { "index-entry-missing": "warn", "tags-sorted": "warn" },
      });
    } finally {
      chmodSync(path.join(repo.root, "kb/index.md"), 0o644);
    }

    // Then - the refusal and the failed write, together
    expect(fixed).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Not fixed: kb\/b\.md: `tags` has an anchor or a tag; fix the record by hand\nCouldn't write kb\/index\.md: /u
      ) as string,
    });
  });

  test("fails when the bundles can't be listed for an index", () => {
    // Given - a record missing from its index
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", record(["type: Decision", "title: A"]));

    // When - fixing it, with a bundle that isn't there
    const fixed = applyFixes({
      bundles: [readBundle(["kb/a.md", "kb/index.md"])],
      context: buildContext({ bundleDirs: ["kb", "missing"] }),
      findings: [finding({ path: "kb/a.md", rule: "index-entry-missing" })],
      houseRules: { "index-entry-missing": "warn" },
    });

    // Then - why
    expect(fixed).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(/^missing can't be listed: /u) as string,
    });
  });

  test("syncs the index whose line is stale, not the record's nearest", () => {
    // Given - a root index line for a record whose own folder has an index
    repo.write("kb/index.md", `${ROOT_INDEX}\n- [Old](sub/x.md) - Old.\n`);
    repo.write("kb/sub/index.md", "# Sub\n\n- [New](x.md) - New.\n");
    repo.write(
      "kb/sub/x.md",
      record(["type: Decision", "title: New", "description: New."])
    );

    // When - fixing the stale line
    const fixed = applyFixes({
      bundles: [readBundle(["kb/index.md", "kb/sub/index.md", "kb/sub/x.md"])],
      context: buildContext(),
      findings: [finding({ path: "kb/sub/x.md", rule: "index-entry-stale" })],
      houseRules: { "index-entry-stale": "warn" },
    });

    // Then - the root index, where the line is
    expect(fixed).toStrictEqual({
      isOk: true,
      value: {
        refusals: [],
        written: [
          {
            filePath: "kb/index.md",
            originalText: `${ROOT_INDEX}\n- [Old](sub/x.md) - Old.\n`,
            text: repo.read("kb/index.md"),
          },
        ],
      },
    });
    expect(repo.read("kb/index.md")).toContain("[New](sub/x.md)");
  });

  test("writes nothing when okf index would leave the judged index alone", () => {
    // Given - a record whose nearest index okf.exclude leaves out
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/sub/index.md", "# Sub\n");
    repo.write("kb/sub/a.md", record(["type: Decision", "title: A"]));

    // When - fixing the root index the rule judged
    const fixed = applyFixes({
      bundles: [readBundle(["kb/index.md", "kb/sub/a.md"])],
      context: buildContext({ excludeGlobs: ["kb/sub/index.md"] }),
      findings: [finding({ path: "kb/sub/a.md", rule: "index-entry-missing" })],
      houseRules: { "index-entry-missing": "warn" },
    });

    // Then - neither index written, the excluded one least of all, and why
    expect(fixed).toStrictEqual({
      isOk: true,
      value: {
        refusals: [
          "kb/index.md is as okf index would write it, which lists the record in another index, such as one okf.exclude leaves out",
        ],
        written: [],
      },
    });
  });

  test("names an index okf index can't read, which lists no record", () => {
    // Given - a nested index git doesn't track, whose tag index never closes
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/sub/index.md", "# Sub\n\n<!-- tag-index:start -->\n");

    // When - fixing it
    const fixed = applyFixes({
      bundles: [readBundle(["kb/index.md", "kb/sub/index.md"])],
      context: buildContext(),
      findings: [
        finding({ path: "kb/sub/index.md", rule: "index-entry-order" }),
      ],
      houseRules: { "index-entry-order": "warn" },
    });

    // Then - refused, naming it
    expect(fixed).toStrictEqual({
      isOk: true,
      value: {
        refusals: [
          expect.stringMatching(/^kb\/sub\/index\.md can't be synced: /u),
        ],
        written: [],
      },
    });
  });
});
