import fc from "fast-check";
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import {
  draftRecord,
  record,
  useTestRepo,
  VERIFIED_BY,
  verifiedRecord,
} from "#test/repo";

import type { Outcome } from "./outcome.ts";

import {
  loadCandidate,
  loadCandidates,
  loadCandidatesAt,
  readRecordText,
  resolveBundleDirs,
  resolveRecordPaths,
  writeRecords,
} from "./repo.ts";

const { repo } = useTestRepo();

/** The value of an outcome a test expects to succeed. */
function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.isOk) {
    throw new Error(outcome.reason);
  }

  return outcome.value;
}

describe("loadCandidate", () => {
  test("explains a record that can't be read", () => {
    // Given - a record with no read permission
    repo.write("docs/decisions/a.md", draftRecord("A"));
    chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

    // When - loading it
    const loaded = loadCandidate({
      filePath: "docs/decisions/a.md",
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - a reason naming the file and the error
    expect(loaded).toStrictEqual({
      kind: "unreadable",
      reason: expect.stringMatching(
        /^docs\/decisions\/a\.md can't be read: .*EACCES/u
      ) as string,
    });
  });
});

describe("loadCandidate, given bytes that aren't UTF-8", () => {
  test.each([
    {
      bytes: Buffer.concat([
        Buffer.from(draftRecord("A")),
        Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
      ]),
      description: "a Latin-1 byte in the body",
    },
    {
      bytes: Buffer.concat([
        Buffer.from("---\ntype: Decision\ntitle: caf"),
        Buffer.from([0xe9]),
        Buffer.from("\nstatus: draft\n---\n"),
      ]),
      description: "a Latin-1 byte in the frontmatter",
    },
    {
      bytes: Buffer.concat([
        Buffer.from(draftRecord("A")),
        Buffer.from([0xed, 0xa0, 0x80, 0x0a]),
      ]),
      description: "an encoded surrogate",
    },
  ])("refuses $description, rather than replace it", ({ bytes }) => {
    // Given - a record holding bytes that aren't valid UTF-8
    repo.write("docs/decisions/a.md", "");
    writeFileSync(path.join(repo.root, "docs/decisions/a.md"), bytes);

    // When - loading it
    const loaded = loadCandidate({
      filePath: "docs/decisions/a.md",
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - unreadable, naming the file and the encoding
    expect(loaded).toStrictEqual({
      kind: "unreadable",
      reason: "docs/decisions/a.md can't be read: it isn't valid UTF-8.",
    });
  });

  test("keeps a byte order mark in the text", () => {
    // Given - a record that opens with a byte order mark
    repo.write("docs/decisions/a.md", `\uFEFF${draftRecord("A")}`);

    // When - loading it
    const loaded = loadCandidate({
      filePath: "docs/decisions/a.md",
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - a record whose text still holds the mark
    expect(loaded).toMatchObject({
      candidate: { text: `\uFEFF${draftRecord("A")}` },
      kind: "record",
    });
  });
});

describe("readRecordText", () => {
  test("reads any bytes losslessly, or refuses them", () => {
    // Given - a scratch file to write each byte string to
    const filePath = "docs/decisions/a.md";
    const absolutePath = path.join(repo.root, filePath);

    repo.write(filePath, "");

    // When/Then - the text re-encodes to the bytes, or the read throws
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uint8Array({ maxLength: 64 }),
          fc.string({ maxLength: 32, unit: "binary" }).map((text) => {
            return new Uint8Array(Buffer.from(text));
          })
        ),
        (bytes) => {
          writeFileSync(absolutePath, bytes);

          let text: string | undefined;

          try {
            text = readRecordText({ filePath, repoRoot: repo.root });
          } catch (error) {
            expect(error).toStrictEqual(new Error("it isn't valid UTF-8."));
          }

          const wasRead = readFileSync(absolutePath);

          return text === undefined || Buffer.from(text).equals(wasRead);
        }
      ),
      { numRuns: 300, seed: 27 }
    );
  });
});

describe("loadCandidates, given invalid YAML", () => {
  test("reports a record whose frontmatter isn't valid YAML", () => {
    // Given - a record with a duplicated key, and a good one
    repo.write(
      "docs/decisions/a.md",
      record(["type: Decision", "type: Again"])
    );
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - the good record listed, and the other reported
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
    ]);
    expect(skipped.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/a.md",
    ]);
    expect(skipped[0]?.reason).toMatch(
      /^docs\/decisions\/a\.md: frontmatter isn't valid YAML: /u
    );
  });
});

describe("loadCandidates, given a layout the edits refuse", () => {
  test("reports the record when listing, not at write time", () => {
    // Given - a record whose verified holds a single value, and a good one
    repo.write(
      "docs/decisions/a.md",
      record(["type: Decision", "status: draft", "verified: someone"])
    );
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - the good record listed, and the other reported with its reason
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
    ]);
    expect(skipped).toStrictEqual([
      {
        filePath: "docs/decisions/a.md",
        reason:
          "docs/decisions/a.md: `verified` holds a single value, not an entry or a list; edit the record by hand",
      },
    ]);
  });
});

describe("loadCandidates, given a generated.at ahead of the clock", () => {
  test("reports the record instead of listing it as verified", () => {
    // Given - a record signed off, then regenerated with a time still to come
    repo.write(
      "docs/decisions/a.md",
      record([
        "type: Decision",
        "status: stable",
        "generated: { by: claude-code/model, at: 2099-11-25T20:00:00Z }",
        `verified: { by: "${VERIFIED_BY}", at: 2026-11-01T10:00:00Z }`,
      ])
    );

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - nothing listed, and the record reported with the fix
    expect({ candidates, skipped }).toStrictEqual({
      candidates: [],
      skipped: [
        {
          filePath: "docs/decisions/a.md",
          reason:
            "docs/decisions/a.md: generated.at is ahead of the clock; fix its time zone",
        },
      ],
    });
  });
});

describe("loadCandidates", () => {
  test("reports a record that can't be read instead of listing it", () => {
    // Given - two records, the first with no read permission
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));
    chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - the readable record listed, and the other reported
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
    ]);
    expect(skipped.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/a.md",
    ]);
    expect(skipped[0]?.reason).toMatch(
      /^docs\/decisions\/a\.md can't be read: /u
    );
  });

  test("fails naming a bundle that can't be listed", () => {
    // Given - a bundle with no read permission
    const bundle = path.join(repo.root, "docs/decisions");

    repo.write("docs/decisions/a.md", draftRecord("A"));
    chmodSync(bundle, 0o000);

    try {
      // When - loading it
      const loaded = loadCandidates({
        bundleDirs: ["docs/decisions"],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      });

      // Then - a failure naming the bundle
      expect(loaded).toStrictEqual({
        isOk: false,
        reason: expect.stringMatching(
          /^docs\/decisions can't be listed: EACCES/u
        ) as unknown,
      });
    } finally {
      chmodSync(bundle, 0o755);
    }
  });

  test("reads each bundle's records in order, skipping non-records", () => {
    // Given - two bundles with records, an index, a non-record, and a non-Markdown file
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.write(
      "docs/decisions/a.md",
      verifiedRecord({ by: VERIFIED_BY, title: "A" })
    );
    repo.write("docs/decisions/index.md", draftRecord("Index"));
    repo.write("docs/decisions/notes.txt", "x\n");
    repo.write("docs/decisions/assets.md/image.txt", "x\n");
    repo.write("docs/references/c.md", "# No frontmatter\n");
    repo.write("docs/references/d.md", draftRecord("D"));

    // When - loading both bundles
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions", "docs/references"],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - the records, with their states
    expect(
      candidates.map(({ filePath, state }) => [filePath, state])
    ).toStrictEqual([
      ["docs/decisions/a.md", "verified"],
      ["docs/decisions/b.md", "unverified"],
      ["docs/references/d.md", "unverified"],
    ]);
    expect(skipped).toStrictEqual([]);
  });
});

describe("loadCandidatesAt", () => {
  test("keeps the record files among the paths, in the given order", () => {
    // Given - two records, a file outside the bundle, and the bundle's index
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.write("docs/decisions/index.md", draftRecord("Index"));
    repo.write("other/c.md", draftRecord("C"));

    // When - loading them, deleted path included
    const { candidates } = loadCandidatesAt({
      bundleDirs: ["docs/decisions"],
      filePaths: [
        "docs/decisions/b.md",
        "docs/decisions/deleted.md",
        "docs/decisions/index.md",
        "other/c.md",
        "docs/decisions/a.md",
      ],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the two records, in the given order
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
      "docs/decisions/a.md",
    ]);
  });
});

describe("resolveBundleDirs", () => {
  test("accepts a folder whose name starts with two dots", () => {
    // Given - a folder named ..archive inside the repo
    repo.write("..archive/a.md", "a\n");

    // When/Then - it, not "outside the repo"
    expect(
      resolveBundleDirs({
        bundleDirs: [`${repo.root}/..archive`],
        repoRoot: repo.root,
      })
    ).toStrictEqual({ isOk: true, value: ["..archive"] });
  });

  test("returns paths from the root, each once, with the root as .", () => {
    // Given - one bundle, named twice, and the root itself
    repo.write("docs/decisions/a.md", "a\n");
    const bundleDir = `${repo.root}/docs/decisions`;

    // When - resolving them
    const result = resolveBundleDirs({
      bundleDirs: [bundleDir, bundleDir, repo.root],
      repoRoot: repo.root,
    });

    // Then - each once
    expect(result).toStrictEqual({
      isOk: true,
      value: ["docs/decisions", "."],
    });
  });

  test.each([
    {
      description: "a directory outside the repo",
      dir: "/",
      reason: "/ is outside the repo at ROOT.",
    },
    {
      description: "a missing directory",
      dir: "ROOT/missing",
      reason: "No bundle directory at ROOT/missing.",
    },
    {
      description: "a file",
      dir: "ROOT/package.json",
      reason: "No bundle directory at ROOT/package.json.",
    },
  ])("rejects $description", ({ dir, reason }) => {
    // When/Then - why
    expect(
      resolveBundleDirs({
        bundleDirs: [dir.replace("ROOT", repo.root)],
        repoRoot: repo.root,
      })
    ).toStrictEqual({
      isOk: false,
      reason: reason.replaceAll("ROOT", repo.root),
    });
  });
});

describe("resolveRecordPaths", () => {
  beforeEach(() => {
    repo.write("docs/decisions/a.md", "a\n");
    repo.write("docs/decisions/index.md", "i\n");
    repo.write("docs/decisions/notes.txt", "n\n");
    repo.write("docs/decisions/folder.md/inner.txt", "x\n");
  });

  test("returns paths from the root, each once", () => {
    // When - naming one record twice, from a subdirectory
    const result = resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: `${repo.root}/docs`,
      recordPaths: ["decisions/a.md", `${repo.root}/docs/decisions/a.md`],
      repoRoot: repo.root,
    });

    // Then - it once
    expect(result).toStrictEqual({
      isOk: true,
      value: ["docs/decisions/a.md"],
    });
  });

  test.each([
    {
      description: "a file outside the repo",
      reason: "/etc/hosts isn't a record in docs/decisions.",
      recordPath: "/etc/hosts",
    },
    {
      description: "a file outside the bundles",
      reason: "package.json isn't a record in docs/decisions.",
      recordPath: "package.json",
    },
    {
      description: "a non-Markdown file",
      reason: "docs/decisions/notes.txt isn't a record in docs/decisions.",
      recordPath: "docs/decisions/notes.txt",
    },
    {
      description: "the bundle's index",
      reason: "docs/decisions/index.md isn't a record in docs/decisions.",
      recordPath: "docs/decisions/index.md",
    },
    {
      description: "a missing record",
      reason: "No record at docs/decisions/missing.md.",
      recordPath: "docs/decisions/missing.md",
    },
  ])("rejects $description", ({ reason, recordPath }) => {
    // When/Then - why
    expect(
      resolveRecordPaths({
        bundleDirs: ["docs/decisions"],
        cwd: repo.root,
        recordPaths: [recordPath],
        repoRoot: repo.root,
      })
    ).toStrictEqual({ isOk: false, reason });
  });
});

describe("writeRecords", () => {
  test("writes each record's new text", () => {
    // Given - a record on disk
    repo.write("docs/a.md", "old\n");

    // When - writing its edit
    const result = writeRecords({
      edits: [{ filePath: "docs/a.md", originalText: "old\n", text: "new\n" }],
      repoRoot: repo.root,
    });

    // Then - the new text
    expect(result).toStrictEqual({ isOk: true, value: undefined });
    expect(repo.read("docs/a.md")).toBe("new\n");
  });

  test("restores the records already written when a later write fails", () => {
    // Given - two records, the second read-only
    repo.write("docs/a.md", "old a\n");
    repo.write("docs/b.md", "old b\n");
    chmodSync(path.join(repo.root, "docs/b.md"), 0o444);

    // When - writing both
    const result = writeRecords({
      edits: [
        { filePath: "docs/a.md", originalText: "old a\n", text: "new a\n" },
        { filePath: "docs/b.md", originalText: "old b\n", text: "new b\n" },
      ],
      repoRoot: repo.root,
    });

    // Then - the failure named, and the first record back as it was
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't write docs\/b\.md: .*EACCES[\s\S]*No files changed\.$/u
      ) as unknown,
    });
    expect(repo.read("docs/a.md")).toBe("old a\n");
  });

  test("never writes through a record that has become a symlink", () => {
    // Given - a record, then a second one replaced by a link to other text
    repo.write("docs/a.md", "old a\n");
    repo.write("drafts/real.md", "other\n");
    symlinkSync("../drafts/real.md", path.join(repo.root, "docs/b.md"));

    // When - writing both
    const result = writeRecords({
      edits: [
        { filePath: "docs/a.md", originalText: "old a\n", text: "new a\n" },
        { filePath: "docs/b.md", originalText: "old b\n", text: "new b\n" },
      ],
      repoRoot: repo.root,
    });

    // Then - the link's write fails, and neither file is left changed
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't write docs\/b\.md: .*ELOOP[\s\S]*No files changed\.$/u
      ) as unknown,
    });
    expect(repo.read("docs/a.md")).toBe("old a\n");
    expect(repo.read("drafts/real.md")).toBe("other\n");
  });
});
