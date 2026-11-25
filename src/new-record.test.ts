import {
  chmodSync,
  existsSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DISK_SPELLING, record, useTestRepo } from "#test/repo";

import type { NewOptions } from "./options.ts";
import type { Output } from "./output.ts";
import type { BundleContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { TAG_INDEX_END, TAG_INDEX_START } from "./index-sync.ts";
import { runNew } from "./new-record.ts";

const { repo } = useTestRepo();

const AT = "2026-11-25T10:00:00Z";
const BY = "claude-code/2.2.0";

/** The record every test writes, unless it names another. */
const RECORD_PATH = "docs/decisions/new.md";

/** The text `okf new` writes for `NEW_OPTIONS`. */
const NEW_RECORD = [
  "---",
  "type: Decision",
  "title: New",
  "description: The new one.",
  "tags:",
  "  - cli",
  "status: draft",
  `generated: { by: ${BY}, at: ${AT} }`,
  "---",
  "",
].join("\n");

/** The options of an `okf new` run that names every field. */
const NEW_OPTIONS: NewOptions = {
  bundles: [],
  by: BY,
  description: "The new one.",
  recordPath: RECORD_PATH,
  tags: ["cli"],
  title: "New",
  type: "Decision",
};

/** Root can write to a read-only file or folder, so no write fails for it. */
const isRoot = process.getuid?.() === 0;

let errors: string[];
let infos: string[];

beforeEach(() => {
  errors = [];
  infos = [];
  vi.useFakeTimers({ now: new Date(AT), toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

/** An output that collects its lines, with no prefix. */
function collectOutput(): Output {
  return {
    data: (text) => infos.push(text),
    error: (message) => errors.push(message),
    info: (message) => infos.push(message),
  };
}

/** Run `okf new` over `docs/decisions`, from the repo root or a folder. */
function runNewRecord(params: {
  /**
   * The folder it runs from, relative to the repo root.
   *
   * @example "docs"
   */
  directory?: string;

  /**
   * Globs of folders and files that hold no records.
   *
   * @example `["docs/decisions/templates"]`
   */
  excludeGlobs?: readonly string[];

  /**
   * The options to change from `NEW_OPTIONS`.
   *
   * @example `{ recordPath: "docs/decisions/b.md" }`
   */
  options?: Partial<NewOptions>;
}): number {
  const { directory = ".", excludeGlobs = [], options = {} } = params;
  const context: BundleContext = {
    bundleDirs: ["docs/decisions"],
    cwd: path.join(repo.root, directory),
    excludeGlobs,
    output: collectOutput(),
    repoRoot: repo.root,
  };

  return runNew({ context, options: { ...NEW_OPTIONS, ...options } });
}

/** Write a bundle of one record and an index that lists it. */
function writeBundle(): void {
  repo.write(
    "docs/decisions/a.md",
    record(["type: Decision", "title: A", "description: The first."])
  );
  repo.write(
    "docs/decisions/index.md",
    "# Decisions\n\n- [A](a.md) - The first.\n"
  );
}

describe("runNew", () => {
  test("writes the record and lists it in its index", () => {
    // Given - a bundle with an index
    writeBundle();

    // When - writing a new record
    const code = runNewRecord({});

    // Then - the record written, and the index listing it
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      `Wrote ${RECORD_PATH} as a draft, and listed it in docs/decisions/index.md.`,
    ]);
    expect(repo.read(RECORD_PATH)).toBe(NEW_RECORD);
    expect(repo.read("docs/decisions/index.md")).toBe(
      "# Decisions\n\n- [A](a.md) - The first.\n- [New](new.md) - The new one.\n"
    );
  });

  test("resolves the path from the folder it runs in", () => {
    // Given - a bundle with an index
    writeBundle();

    // When - naming the record from inside the bundle
    const code = runNewRecord({
      directory: "docs/decisions",
      options: { recordPath: "new.md" },
    });

    // Then - written where it was named
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read(RECORD_PATH)).toBe(NEW_RECORD);
  });

  test("lists the record in the nearest index above its folder", () => {
    // Given - a subfolder with no index of its own
    writeBundle();
    mkdirSync(path.join(repo.root, "docs/decisions/sub"));

    // When - writing a record there
    const code = runNewRecord({
      options: { recordPath: "docs/decisions/sub/new.md" },
    });

    // Then - listed in the bundle's index
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("docs/decisions/index.md")).toContain(
      "- [New](sub/new.md) - The new one."
    );
  });

  test("writes only the record when no index would list it", () => {
    // Given - a bundle with no index
    mkdirSync(path.join(repo.root, "docs/decisions"), { recursive: true });

    // When - writing a new record
    const code = runNewRecord({});

    // Then - written, and said so
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      `Wrote ${RECORD_PATH} as a draft. No index.md in its folder or above lists it.`,
    ]);
    expect(repo.read(RECORD_PATH)).toBe(NEW_RECORD);
  });

  test("leaves an index that already lists the record as it is", () => {
    // Given - an index that lists the record before it exists
    writeBundle();
    const index =
      "# Decisions\n\n- [A](a.md) - The first.\n- [New](new.md) - The new one.\n";
    repo.write("docs/decisions/index.md", index);

    // When - writing the record
    const code = runNewRecord({});

    // Then - written, the index untouched
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      `Wrote ${RECORD_PATH} as a draft. docs/decisions/index.md already lists it.`,
    ]);
    expect(repo.read("docs/decisions/index.md")).toBe(index);
  });

  test("writes nothing when the index can't be synced", () => {
    // Given - a record the index lists that can't be read
    writeBundle();
    repo.write("docs/decisions/broken.md", "---\ntitle: [A\u001b[31m\n---\n");

    // When - writing a new record
    const code = runNewRecord({});

    // Then - refused on one line, nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(
        /^docs\/decisions\/index\.md can't be synced: a record it lists can't be read\. .* Nothing was written\.$/u
      ),
    ]);
    expect(errors[0]).not.toContain("\u001b");
    expect(existsSync(path.join(repo.root, RECORD_PATH))).toBe(false);
  });

  test("writes nothing when a folder in the bundle can't be listed", () => {
    // Given - a folder in the bundle no one can read
    writeBundle();
    const locked = path.join(repo.root, "docs/decisions/locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);

    try {
      // When - writing a new record
      const code = runNewRecord({});

      // Then - refused, nothing written
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(
          /^docs\/decisions can't be listed: .* Nothing was written\.$/u
        ),
      ]);
      expect(existsSync(path.join(repo.root, RECORD_PATH))).toBe(false);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  test.skipIf(isRoot)("says so when the record can't be written", () => {
    // Given - a bundle folder no one can write to
    writeBundle();
    const folder = path.join(repo.root, "docs/decisions");
    chmodSync(folder, 0o555);

    try {
      // When - writing a new record
      const code = runNewRecord({});

      // Then - why, the index untouched
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(
          /^Couldn't write docs\/decisions\/new\.md: EACCES/u
        ),
      ]);
      expect(repo.read("docs/decisions/index.md")).toBe(
        "# Decisions\n\n- [A](a.md) - The first.\n"
      );
    } finally {
      chmodSync(folder, 0o755);
    }
  });

  test.skipIf(isRoot)(
    "removes the record again when the index can't be written",
    () => {
      // Given - an out-of-date index no one can write
      writeBundle();
      const indexPath = path.join(repo.root, "docs/decisions/index.md");
      chmodSync(indexPath, 0o444);

      try {
        // When - writing a new record
        const code = runNewRecord({});

        // Then - the write's failure, and the record gone again
        expect(code).toBe(EXIT_CODES.failure);
        expect(errors).toStrictEqual([
          expect.stringMatching(
            /^Couldn't write docs\/decisions\/index\.md: EACCES[^\n]*\nNo files changed\.\ndocs\/decisions\/new\.md was removed again\.$/u
          ),
        ]);
        expect(existsSync(path.join(repo.root, RECORD_PATH))).toBe(false);
      } finally {
        chmodSync(indexPath, 0o644);
      }
    }
  );

  test("refuses a --by that isn't an actor", () => {
    // Given - a bundle with an index
    writeBundle();

    // When - writing a record by a name with a space
    const code = runNewRecord({ options: { by: "claude code" } });

    // Then - refused, nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      '"claude code" isn\'t an actor a record can hold, such as human:jjloneman.',
    ]);
    expect(existsSync(path.join(repo.root, RECORD_PATH))).toBe(false);
  });

  test.each([
    {
      description: "an index",
      reason: "docs/decisions/index.md isn't a record path in docs/decisions.",
      recordPath: "docs/decisions/index.md",
    },
    {
      description: "a log",
      reason: "docs/decisions/log.md isn't a record path in docs/decisions.",
      recordPath: "docs/decisions/log.md",
    },
    {
      description: "a file that isn't Markdown",
      reason: "docs/decisions/new.txt isn't a record path in docs/decisions.",
      recordPath: "docs/decisions/new.txt",
    },
    {
      description: "a path outside the bundles",
      reason: "notes/new.md isn't a record path in docs/decisions.",
      recordPath: "notes/new.md",
    },
    {
      description: "a path outside the repo",
      reason: "../new.md isn't a record path in docs/decisions.",
      recordPath: "../new.md",
    },
  ])("refuses $description", ({ reason, recordPath }) => {
    // Given - a bundle with an index
    writeBundle();

    // When - writing a record there
    const code = runNewRecord({ options: { recordPath } });

    // Then - refused
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([reason]);
    expect(infos).toStrictEqual([]);
  });

  test("refuses an excluded path", () => {
    // Given - an excluded templates folder
    writeBundle();
    mkdirSync(path.join(repo.root, "docs/decisions/templates"));

    // When - writing a record there
    const code = runNewRecord({
      excludeGlobs: ["docs/decisions/templates"],
      options: { recordPath: "docs/decisions/templates/new.md" },
    });

    // Then - refused, nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "docs/decisions/templates/new.md is excluded by `okf.exclude`.",
    ]);
    expect(
      existsSync(path.join(repo.root, "docs/decisions/templates/new.md"))
    ).toBe(false);
  });

  test("never overwrites a file", () => {
    // Given - a record already at the path
    writeBundle();

    // When - writing a new record there
    const code = runNewRecord({
      options: { recordPath: "docs/decisions/a.md" },
    });

    // Then - refused, the record as it was
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual(["docs/decisions/a.md already exists."]);
    expect(repo.read("docs/decisions/a.md")).toBe(
      record(["type: Decision", "title: A", "description: The first."])
    );
  });

  test("never writes through a broken symlink", () => {
    // Given - a symlink at the path to a file that doesn't exist
    writeBundle();
    symlinkSync("../../elsewhere.md", path.join(repo.root, RECORD_PATH));

    // When - writing a new record there
    const code = runNewRecord({});

    // Then - refused, nothing written where it points
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([`${RECORD_PATH} already exists.`]);
    expect(existsSync(path.join(repo.root, "elsewhere.md"))).toBe(false);
  });

  test("refuses a folder that doesn't exist", () => {
    // Given - a bundle with no `missing` folder
    writeBundle();

    // When - writing a record there
    const code = runNewRecord({
      options: { recordPath: "docs/decisions/missing/new.md" },
    });

    // Then - refused, saying to make it
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "No folder at docs/decisions/missing; make it before writing a record there.",
    ]);
  });

  test("refuses a folder that's a file", () => {
    // Given - a file where the folder would be
    writeBundle();
    writeFileSync(path.join(repo.root, "docs/decisions/sub"), "not a folder\n");

    // When - writing a record under it
    const code = runNewRecord({
      options: { recordPath: "docs/decisions/sub/new.md" },
    });

    // Then - refused as no folder
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "No folder at docs/decisions/sub; make it before writing a record there.",
    ]);
  });

  test("refuses a folder that's a symlink", () => {
    // Given - a folder in the bundle linked to one outside it
    writeBundle();
    mkdirSync(path.join(repo.root, "elsewhere"));
    symlinkSync(
      "../../elsewhere",
      path.join(repo.root, "docs/decisions/linked")
    );

    // When - writing a record through it
    const code = runNewRecord({
      options: { recordPath: "docs/decisions/linked/new.md" },
    });

    // Then - refused, nothing written where it points
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      `The folder docs/decisions/linked is a symlink, or inside one, to ${path.join(repo.root, "elsewhere")}. Records are edited only at their own path, since git commits a symlink, not the file it points to.`,
    ]);
    expect(existsSync(path.join(repo.root, "elsewhere/new.md"))).toBe(false);
  });

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "refuses an excluded folder typed in another case",
    () => {
      // Given - an excluded templates folder
      writeBundle();
      mkdirSync(path.join(repo.root, "docs/decisions/templates"));

      // When - writing a record there, the folder typed in upper case
      const code = runNewRecord({
        excludeGlobs: ["docs/decisions/templates"],
        options: { recordPath: "docs/decisions/Templates/new.md" },
      });

      // Then - refused as the folder git knows, nothing written
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        "docs/decisions/Templates/new.md is excluded by `okf.exclude`.",
      ]);
      expect(
        existsSync(path.join(repo.root, "docs/decisions/templates/new.md"))
      ).toBe(false);
    }
  );

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "spells a folder typed in another case as git does",
    () => {
      // Given - a committed folder whose index lists a tagged record
      const tagIndex = (lines: readonly string[]): string =>
        [TAG_INDEX_START, "", ...lines, "", TAG_INDEX_END].join("\n");
      repo.write(
        "docs/decisions/Sub/b.md",
        record([
          "type: Decision",
          "title: B",
          "description: The second.",
          "tags: [api]",
        ])
      );
      repo.write(
        "docs/decisions/Sub/index.md",
        `# Sub\n\n${tagIndex(["- `api`", "  - [B](b.md)"])}\n\n- [B](b.md) - The second.\n`
      );
      repo.commitAll("add the subfolder");

      // When - naming the folder in lower case
      const code = runNewRecord({
        options: { recordPath: "docs/decisions/sub/new.md", tags: ["api"] },
      });

      // Then - written and listed beside its sibling, the tag index whole
      expect(code).toBe(EXIT_CODES.ok);
      expect(errors).toStrictEqual([]);
      expect(infos).toStrictEqual([
        "Wrote docs/decisions/Sub/new.md as a draft, and listed it in docs/decisions/Sub/index.md.",
      ]);
      expect(repo.git("ls-files", "--others", "--exclude-standard")).toBe(
        "docs/decisions/Sub/new.md\n"
      );
      expect(repo.read("docs/decisions/Sub/index.md")).toBe(
        `# Sub\n\n${tagIndex([
          "- `api`",
          "  - [B](b.md)",
          "  - [New](new.md)",
        ])}\n\n- [B](b.md) - The second.\n- [New](new.md) - The new one.\n`
      );
    }
  );
});
