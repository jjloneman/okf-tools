import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { record, useTestRepo } from "#test/repo";

import type { Output } from "./output.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { runNew } from "./new-record.ts";

/*
 * Which disk calls fail from now on, as on a disk that starts refusing them
 * mid-run.
 *
 * - `shouldFailRemoval` fails every `rmSync`.
 *
 * - `shouldFailWrite` fails every write through a descriptor, after the open
 *   has already created the file.
 */
const { disk } = vi.hoisted(() => ({
  disk: { shouldFailRemoval: false, shouldFailWrite: false },
}));

// Stands in for a disk that stops letting a file be written or removed after
// it was created, which no real test machine shows; every other call goes to
// disk for real.
vi.mock(import("node:fs"), async (importOriginal) => {
  const original = await importOriginal();

  return {
    ...original,
    rmSync: (...args: Parameters<typeof original.rmSync>) => {
      if (disk.shouldFailRemoval) {
        throw new Error("EPERM: operation not permitted");
      }

      original.rmSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof original.writeFileSync>) => {
      if (disk.shouldFailWrite && typeof args[0] === "number") {
        throw new Error("ENOSPC: no space left on device");
      }

      original.writeFileSync(...args);
    },
  };
});

const { repo } = useTestRepo();

/** The record every test writes. */
const RECORD_PATH = "docs/decisions/new.md";

/** Root can write a read-only file, so the index write can't fail for it. */
const isRoot = process.getuid?.() === 0;

let errors: string[];

beforeEach(() => {
  errors = [];
  repo.write("docs/decisions/a.md", record(["type: Decision", "title: A"]));
  repo.write("docs/decisions/index.md", "# Decisions\n");
});

afterEach(() => {
  disk.shouldFailRemoval = false;
  disk.shouldFailWrite = false;
});

/** Run `okf new` for `RECORD_PATH` over `docs/decisions`. */
function runNewRecord(): number {
  const output: Output = {
    data: () => undefined,
    error: (message) => errors.push(message),
    info: () => undefined,
  };

  return runNew({
    context: {
      bundleDirs: ["docs/decisions"],
      cwd: repo.root,
      excludeGlobs: [],
      output,
      repoRoot: repo.root,
    },
    options: {
      bundles: [],
      by: "claude-code/2.2.0",
      description: undefined,
      recordPath: RECORD_PATH,
      tags: [],
      title: undefined,
      type: "Decision",
    },
  });
}

describe("runNew when the record can't be filled after it's created", () => {
  test("removes the empty record again, the index untouched", () => {
    // Given - writes failing once the record is created
    disk.shouldFailWrite = true;

    // When - writing a new record
    const code = runNewRecord();

    // Then - why, and nothing left behind
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      `Couldn't write ${RECORD_PATH}: ENOSPC: no space left on device\nNo files changed.`,
    ]);
    expect(existsSync(path.join(repo.root, RECORD_PATH))).toBe(false);
    expect(repo.read("docs/decisions/index.md")).toBe("# Decisions\n");
  });

  test("says the empty record is left behind when removing it fails", () => {
    // Given - writes and removals both failing
    disk.shouldFailWrite = true;
    disk.shouldFailRemoval = true;

    // When - writing a new record
    const code = runNewRecord();

    // Then - both failures, and the empty record named
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      `Couldn't write ${RECORD_PATH}: ENOSPC: no space left on device\nIt's left behind, since removing it failed: EPERM: operation not permitted`,
    ]);
    expect(repo.read(RECORD_PATH)).toBe("");
    expect(repo.read("docs/decisions/index.md")).toBe("# Decisions\n");
  });
});

describe("runNew when the record can't be removed again", () => {
  test.skipIf(isRoot)("says the record is left behind, and why", () => {
    // Given - an out-of-date index no one can write, and removal failing
    const indexPath = path.join(repo.root, "docs/decisions/index.md");
    chmodSync(indexPath, 0o444);
    disk.shouldFailRemoval = true;

    try {
      // When - writing a new record
      const code = runNewRecord();

      // Then - the write's failure, and the record named as left behind
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(
          /^Couldn't write docs\/decisions\/index\.md: EACCES[^\n]*\nNo files changed\.\ndocs\/decisions\/new\.md is left behind, since removing it failed: EPERM: operation not permitted$/u
        ),
      ]);
      expect(existsSync(path.join(repo.root, RECORD_PATH))).toBe(true);
    } finally {
      chmodSync(indexPath, 0o644);
    }
  });
});
