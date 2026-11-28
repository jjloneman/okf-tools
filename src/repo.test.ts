import fc from "fast-check";
import {
  chmodSync,
  linkSync,
  readFileSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import {
  DISK_SPELLING,
  draftRecord,
  NEAR_MISSES,
  record,
  useTestRepo,
  VERIFIED_BY,
  verifiedRecord,
} from "#test/repo";

import type { Outcome } from "./outcome.ts";

import {
  findOwningBundle,
  listBundleChanges,
  loadCandidate,
  loadCandidates,
  loadCandidatesAt,
  orderRecordPaths,
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

describe("listBundleChanges", () => {
  test("lists the bundles' changes as git prints them", () => {
    // Given - a committed record, edited since, and a new one
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.commitAll("add a");
    repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - listing the changes in the bundle
    const changes = listBundleChanges({
      bundleDirs: ["docs/decisions"],
      repoRoot: repo.root,
    });

    // Then - both, and the edited one as a status path
    expect(unwrap(changes)).toMatchObject({
      paths: new Set(["docs/decisions/a.md", "docs/decisions/b.md"]),
      statusPaths: new Set(["docs/decisions/a.md"]),
    });
  });

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "finds new records in folders renamed only in case on disk",
    () => {
      // Given - a bundle folder, and a folder in it, renamed only in case on
      // disk, with a new record in each and an edited one
      repo.write("docs/decisions/a.md", draftRecord("A"));
      repo.write("docs/decisions/sub/c.md", draftRecord("C"));
      repo.commitAll("add records");
      renameSync(
        path.join(repo.root, "docs/decisions"),
        path.join(repo.root, "docs/Decisions")
      );
      renameSync(
        path.join(repo.root, "docs/Decisions/sub"),
        path.join(repo.root, "docs/Decisions/Sub")
      );
      repo.write("docs/Decisions/a.md", `${draftRecord("A")}\nMore.\n`);
      repo.write("docs/Decisions/b.md", draftRecord("B"));
      repo.write("docs/Decisions/Sub/d.md", draftRecord("D"));

      // When - listing the changes in the bundle, as git's index spells it
      const changes = listBundleChanges({
        bundleDirs: ["docs/decisions"],
        repoRoot: repo.root,
      });

      // Then - every one, in the index's spelling of each folder
      expect(unwrap(changes)).toMatchObject({
        paths: new Set([
          "docs/decisions/a.md",
          "docs/decisions/b.md",
          "docs/decisions/sub/d.md",
        ]),
        statusPaths: new Set(["docs/decisions/a.md"]),
      });
    }
  );

  test("fails naming a bundle that can't be listed any more", () => {
    // Given - a bundle that's gone

    // When - listing its changes
    const changes = listBundleChanges({
      bundleDirs: ["docs/gone"],
      repoRoot: repo.root,
    });

    // Then - refused, naming it
    expect(changes).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^docs\/gone can't be listed: .*ENOENT/u
      ) as unknown,
    });
  });

  test("fails with git's reason when git status fails", () => {
    // Given - a bundle, and an index git can't read
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write(".git/index", "garbage\n");

    // When - listing its changes
    const changes = listBundleChanges({
      bundleDirs: ["docs/decisions"],
      repoRoot: repo.root,
    });

    // Then - git's failure, naming the bundle
    expect(changes).toStrictEqual({
      isOk: false,
      reason: expect.stringContaining(
        "Couldn't read git status for docs/decisions"
      ) as unknown,
    });
  });
});

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
        excludeGlobs: [],
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
        excludeGlobs: [],
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

  test("reports a re-stamp's reason a sign-off couldn't take out", () => {
    // Given - a reason whose key has an anchor before it
    repo.write(
      "docs/decisions/a.md",
      record(["type: Decision", "status: draft", "&k x-okf-restamp-reason: a"])
    );

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - reported when listing, with removeField's reason
    expect(candidates).toStrictEqual([]);
    expect(skipped).toStrictEqual([
      {
        filePath: "docs/decisions/a.md",
        reason:
          "docs/decisions/a.md: `x-okf-restamp-reason` doesn't start its line; edit the record by hand",
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
        excludeGlobs: [],
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

describe("loadCandidates, given a verified.at ahead of the clock", () => {
  test.each([
    {
      description: "regenerated since",
      generated: [
        "generated: { by: claude-code/model, at: 2026-11-20T10:00:00Z }",
      ],
    },
    { description: "with no generation time", generated: [] },
  ])("lists the record $description as changed", ({ generated }) => {
    // Given - a record whose sign-off is a typo for a date to come
    repo.write(
      "docs/decisions/a.md",
      record([
        "type: Decision",
        "status: stable",
        ...generated,
        `verified: { by: "${VERIFIED_BY}", at: 2099-01-01T00:00:00Z }`,
      ])
    );

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - listed as changed, so it's offered for a fresh sign-off
    expect({
      skipped,
      states: candidates.map(({ state }) => state),
    }).toStrictEqual({ skipped: [], states: ["changed"] });
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
        excludeGlobs: [],
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
        excludeGlobs: [],
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
        excludeGlobs: [],
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

describe("loadCandidates, given near-miss frontmatter", () => {
  test.each(NEAR_MISSES)(
    "reports a record with $description as skipped",
    ({ problem, text }) => {
      // Given - a record whose frontmatter block is almost right
      repo.write("docs/decisions/a.md", text);

      // When - listing the bundle's records, as the checklist does
      const loaded = unwrap(
        loadCandidates({
          bundleDirs: ["docs/decisions"],
          excludeGlobs: [],
          repoRoot: repo.root,
          verifiedBy: VERIFIED_BY,
        })
      );

      // Then - it's skipped with why, not dropped unseen
      expect(loaded).toStrictEqual({
        candidates: [],
        skipped: [
          {
            filePath: "docs/decisions/a.md",
            reason: `docs/decisions/a.md: ${problem}`,
          },
        ],
      });
    }
  );

  test("lists every file that opens with `---` as a record or a skipped one", () => {
    // Given - a clean record, every near miss, and a file with no frontmatter
    repo.write("docs/decisions/clean.md", draftRecord("Clean"));
    repo.write("docs/decisions/notes.md", "# Notes\n");
    NEAR_MISSES.forEach(({ text }, index) => {
      repo.write(`docs/decisions/near-${String(index)}.md`, text);
    });

    // When - listing the bundle's records
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - each is one or the other, and only the notes are left out
    expect(
      [...candidates, ...skipped].map(({ filePath }) => filePath).sort()
    ).toStrictEqual(
      [
        "docs/decisions/clean.md",
        ...NEAR_MISSES.map(
          (_, index) => `docs/decisions/near-${String(index)}.md`
        ),
      ].sort()
    );
  });

  test("never offers the bundle's log.md, which OKF reserves", () => {
    // Given - a log.md that carries frontmatter, beside a record
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/log.md", draftRecord("Log"));

    // When - listing the bundle's records
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - only the record
    expect({
      filePaths: candidates.map(({ filePath }) => filePath),
      skipped,
    }).toStrictEqual({ filePaths: ["docs/decisions/a.md"], skipped: [] });
  });
});

describe("loadCandidates, given folders in a bundle", () => {
  test("reads records at any depth, leaving out reserved names at every level", () => {
    // Given - records nested two deep, each level with an index and a log
    repo.write("docs/decisions/z.md", draftRecord("Z"));
    repo.write("docs/decisions/api/b.md", draftRecord("B"));
    repo.write("docs/decisions/api/index.md", draftRecord("API index"));
    repo.write("docs/decisions/api/log.md", draftRecord("API log"));
    repo.write("docs/decisions/api/v2/a.md", draftRecord("A"));
    repo.write("docs/decisions/api/v2/index.md", draftRecord("V2 index"));
    repo.write("docs/decisions/api/v2/log.md", draftRecord("V2 log"));

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - the three records, by path
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/api/b.md",
      "docs/decisions/api/v2/a.md",
      "docs/decisions/z.md",
    ]);
    expect(skipped).toStrictEqual([]);
  });

  test("leaves out the files and folders the globs exclude, dot files included", () => {
    // Given - a README, a drafts folder, and a dot folder, each with a record
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/README.md", draftRecord("Excluded"));
    repo.write("docs/decisions/api/README.md", draftRecord("Excluded"));
    repo.write("docs/decisions/drafts/b.md", draftRecord("Excluded"));
    repo.write("docs/decisions/.hidden/c.md", draftRecord("Excluded"));

    // When - loading with those excluded
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [
          "**/README.md",
          "docs/decisions/drafts",
          "docs/decisions/.*",
        ],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - only the record, nothing reported as skipped
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/a.md",
    ]);
    expect(skipped).toStrictEqual([]);
  });

  test("lists a record once when one bundle holds another", () => {
    // Given - a bundle inside another, each with a record
    repo.write("docs/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - loading the inner bundle first, then the outer one
    const { candidates } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions", "docs"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - each once, under the first bundle that holds it
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/b.md",
      "docs/a.md",
    ]);
  });

  test("never reads a folder git ignores, .git, or another clone", () => {
    // Given - a root bundle with an ignored folder and a nested clone
    repo.write(".gitignore", "node_modules/\n*.local.md\n");
    repo.write("a.md", draftRecord("A"));
    repo.write("b.local.md", draftRecord("B"));
    repo.write("node_modules/pkg/README.md", "---\nkey: [\n---\n");
    repo.write("vendor/spec/c.md", draftRecord("C"));
    repo.git("init", "--quiet", "vendor/spec");

    // When - loading the repo root as the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["."],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - the records outside them, an ignored file included
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "a.md",
      "b.local.md",
    ]);
    expect(skipped).toStrictEqual([]);
  });

  test("never follows a symlink to a folder", () => {
    // Given - a link inside the bundle to a folder of records outside it
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("elsewhere/b.md", draftRecord("B"));
    symlinkSync(
      path.join(repo.root, "elsewhere"),
      path.join(repo.root, "docs/decisions/linked")
    );

    // When - loading the bundle
    const { candidates, skipped } = unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    );

    // Then - only the record in the bundle itself
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/a.md",
    ]);
    expect(skipped).toStrictEqual([]);
  });

  test("fails naming the bundle when git can't list what it ignores", () => {
    // Given - a record, and an index git can't read
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write(".git/index", "garbage\n");

    // When - loading the bundle
    const result = loadCandidates({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: [],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - git's reason, naming the bundle
    expect(result).toStrictEqual({
      isOk: false,
      reason:
        "Couldn't list the folders git ignores in docs/decisions: fatal: .git/index: index file smaller than expected",
    });
  });

  test("fails naming the bundle when a folder in it can't be listed", () => {
    // Given - a folder in the bundle with no read permission
    repo.write("docs/decisions/locked/a.md", draftRecord("A"));
    chmodSync(path.join(repo.root, "docs/decisions/locked"), 0o000);

    // When - loading the bundle
    const result = loadCandidates({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: [],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - why, naming the bundle
    chmodSync(path.join(repo.root, "docs/decisions/locked"), 0o755);
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^docs\/decisions can't be listed: .*EACCES/u
      ) as string,
    });
  });
});

describe("findOwningBundle", () => {
  test.each([
    {
      bundleDirs: ["docs", "docs/decisions"],
      description: "the deepest bundle that holds the path",
      expected: "docs/decisions",
      filePath: "docs/decisions/a.md",
    },
    {
      bundleDirs: ["docs", "docs/decisions"],
      description: "the outer bundle for a path beside the inner one",
      expected: "docs",
      filePath: "docs/a.md",
    },
    {
      bundleDirs: [".", "docs"],
      description: "the bundle `.` for a path in no other",
      expected: ".",
      filePath: "notes/a.md",
    },
    {
      bundleDirs: [".", "x"],
      description: "a one-letter bundle over the bundle `.`",
      expected: "x",
      filePath: "x/a.md",
    },
    {
      bundleDirs: ["docs/decisions"],
      description: "no bundle for a sibling sharing its prefix",
      expected: undefined,
      filePath: "docs/decisions-old/a.md",
    },
  ])("finds $description", ({ bundleDirs, expected, filePath }) => {
    // When/Then - the owning bundle, if any
    expect(findOwningBundle({ bundleDirs, filePath })).toBe(expected);
  });
});

describe("orderRecordPaths", () => {
  test("orders by first holding bundle, then path, each once", () => {
    // When - ordering paths from two overlapping bundles and none
    const ordered = orderRecordPaths({
      bundleDirs: ["docs/decisions", "docs"],
      filePaths: [
        "docs/z.md",
        "docs/decisions/b.md",
        "other/c.md",
        "docs/decisions/a/x.md",
        "docs/decisions/b.md",
        "docs/a.md",
      ],
    });

    // Then - the inner bundle's paths, then the outer's, the stray left out
    expect(ordered).toStrictEqual([
      "docs/decisions/a/x.md",
      "docs/decisions/b.md",
      "docs/a.md",
      "docs/z.md",
    ]);
  });

  test("lets the repo root hold every path", () => {
    // When - ordering under the root
    const ordered = orderRecordPaths({
      bundleDirs: ["."],
      filePaths: ["b.md", "a/c.md"],
    });

    // Then - both, by path
    expect(ordered).toStrictEqual(["a/c.md", "b.md"]);
  });

  test("never takes a sibling folder that shares the bundle's prefix", () => {
    // When - ordering a path in docs/decisions-old under docs/decisions
    const ordered = orderRecordPaths({
      bundleDirs: ["docs/decisions"],
      filePaths: ["docs/decisions-old/a.md"],
    });

    // Then - nothing
    expect(ordered).toStrictEqual([]);
  });
});

describe("loadCandidatesAt", () => {
  test("leaves out excluded paths and reserved names at depth", () => {
    // Given - a nested record, a nested log, and an excluded record
    repo.write("docs/decisions/api/a.md", draftRecord("A"));
    repo.write("docs/decisions/api/log.md", draftRecord("Log"));
    repo.write("docs/decisions/drafts/b.md", draftRecord("B"));

    // When - loading all three, the drafts excluded
    const { candidates } = loadCandidatesAt({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: ["docs/decisions/drafts"],
      filePaths: [
        "docs/decisions/api/a.md",
        "docs/decisions/api/log.md",
        "docs/decisions/drafts/b.md",
      ],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - only the nested record
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/decisions/api/a.md",
    ]);
  });

  test("keeps the record files among the paths, in the given order", () => {
    // Given - two records, a file outside the bundle, and the bundle's index
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.write("docs/decisions/index.md", draftRecord("Index"));
    repo.write("other/c.md", draftRecord("C"));

    // When - loading them, deleted path included
    const { candidates } = loadCandidatesAt({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: [],
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

describe("loadCandidatesAt, given names in another Unicode form", () => {
  test("keeps a record whose folder the bundle names decomposed", () => {
    // Given - a composed folder, and the bundle spelled decomposed
    repo.write("docs/caf\u00e9/a.md", draftRecord("A"));

    // When - loading the path as git prints it, composed
    const { candidates } = loadCandidatesAt({
      bundleDirs: ["docs/cafe\u0301"],
      excludeGlobs: [],
      filePaths: ["docs/caf\u00e9/a.md"],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    // Then - the record, since both name one folder
    expect(candidates.map(({ filePath }) => filePath)).toStrictEqual([
      "docs/caf\u00e9/a.md",
    ]);
  });
});

describe("resolveRecordPaths, given names in another Unicode form", () => {
  test("keeps a record named in two Unicode forms once", () => {
    // Given - a record, named composed and decomposed
    repo.write("docs/decisions/caf\u00e9.md", draftRecord("Cafe"));

    // When - resolving both spellings
    const resolved = resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: repo.root,
      excludeGlobs: [],
      recordPaths: [
        "docs/decisions/caf\u00e9.md",
        "docs/decisions/cafe\u0301.md",
      ],
      repoRoot: repo.root,
    });

    // Then - one path, or the second refused as missing on a disk that
    // tells the forms apart
    expect(resolved).toMatchObject(
      DISK_SPELLING.isNormalizationInsensitive
        ? { isOk: true, value: ["docs/decisions/caf\u00e9.md"] }
        : { isOk: false }
    );
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
    repo.write("docs/decisions/log.md", "l\n");
    repo.write("docs/decisions/notes.txt", "n\n");
    repo.write("docs/decisions/folder.md/inner.txt", "x\n");
    repo.write("docs/decisions/api/b.md", "b\n");
    repo.write("docs/decisions/api/index.md", "i\n");
    repo.write("docs/decisions/drafts/c.md", "c\n");
  });

  test("accepts a record in a folder of the bundle", () => {
    // When - naming a nested record
    const result = resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: repo.root,
      excludeGlobs: [],
      recordPaths: ["docs/decisions/api/b.md"],
      repoRoot: repo.root,
    });

    // Then - it
    expect(result).toStrictEqual({
      isOk: true,
      value: ["docs/decisions/api/b.md"],
    });
  });

  test("refuses a record the globs exclude", () => {
    // When - naming a record in an excluded folder
    const result = resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: repo.root,
      excludeGlobs: ["docs/decisions/drafts"],
      recordPaths: ["docs/decisions/drafts/c.md"],
      repoRoot: repo.root,
    });

    // Then - why
    expect(result).toStrictEqual({
      isOk: false,
      reason: "docs/decisions/drafts/c.md is excluded by `okf.exclude`.",
    });
  });

  test("returns paths from the root, each once", () => {
    // When - naming one record twice, from a subdirectory
    const result = resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: `${repo.root}/docs`,
      excludeGlobs: [],
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
      description: "a nested folder's index",
      reason: "docs/decisions/api/index.md isn't a record in docs/decisions.",
      recordPath: "docs/decisions/api/index.md",
    },
    {
      description: "the bundle's log",
      reason: "docs/decisions/log.md isn't a record in docs/decisions.",
      recordPath: "docs/decisions/log.md",
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
        excludeGlobs: [],
        recordPaths: [recordPath],
        repoRoot: repo.root,
      })
    ).toStrictEqual({ isOk: false, reason });
  });
});

describe("resolveRecordPaths, given a name git's index spells another way", () => {
  /** The records `resolveRecordPaths` resolves the names to. */
  function resolveNames(...recordPaths: string[]): Outcome<string[]> {
    return resolveRecordPaths({
      bundleDirs: ["docs/decisions"],
      cwd: repo.root,
      excludeGlobs: [],
      recordPaths,
      repoRoot: repo.root,
    });
  }

  /** The paths `loadCandidates` lists in the bundle. */
  function listCandidatePaths(): string[] {
    return unwrap(
      loadCandidates({
        bundleDirs: ["docs/decisions"],
        excludeGlobs: [],
        repoRoot: repo.root,
        verifiedBy: VERIFIED_BY,
      })
    ).candidates.map(({ filePath }) => filePath);
  }

  beforeEach(() => {
    repo.write("docs/decisions/a.md", draftRecord("A"));
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.commitAll("add records");
  });

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "takes the index's spelling of a record renamed only in case on disk",
    () => {
      // Given - a committed record renamed only in case on disk
      renameSync(
        path.join(repo.root, "docs/decisions/a.md"),
        path.join(repo.root, "docs/decisions/A.md")
      );

      // When - naming it as the disk spells it, and listing the bundle
      const resolved = resolveNames("docs/decisions/A.md");
      const listed = listCandidatePaths();

      // Then - both spelled as git's index does
      expect({ listed, resolved }).toStrictEqual({
        listed: ["docs/decisions/a.md", "docs/decisions/b.md"],
        resolved: { isOk: true, value: ["docs/decisions/a.md"] },
      });
    }
  );

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "takes the index's folder for a new record in a folder renamed in case",
    () => {
      // Given - the bundle's folder renamed only in case on disk, and a new
      // record in it
      renameSync(
        path.join(repo.root, "docs/decisions"),
        path.join(repo.root, "docs/Decisions")
      );
      repo.write("docs/Decisions/c.md", draftRecord("C"));

      // When - resolving the bundle and the record as the disk spells them
      const bundles = resolveBundleDirs({
        bundleDirs: [path.join(repo.root, "docs/Decisions")],
        repoRoot: repo.root,
      });
      const resolved = resolveNames("docs/Decisions/c.md");

      // Then - both in the index's spelling of the folder
      expect({ bundles, resolved }).toStrictEqual({
        bundles: { isOk: true, value: ["docs/decisions"] },
        resolved: { isOk: true, value: ["docs/decisions/c.md"] },
      });
    }
  );

  test.skipIf(DISK_SPELLING.isCaseInsensitive)(
    "keeps the disk's spelling of a hard link differing only in case",
    () => {
      // Given - a hard link to a committed record, named in another case,
      // which git counts as a separate path
      linkSync(
        path.join(repo.root, "docs/decisions/a.md"),
        path.join(repo.root, "docs/decisions/A.md")
      );

      // When - naming the link, and listing the bundle
      const resolved = resolveNames("docs/decisions/A.md");
      const listed = listCandidatePaths();

      // Then - each kept as the disk spells it
      expect({ listed, resolved }).toStrictEqual({
        listed: [
          "docs/decisions/A.md",
          "docs/decisions/a.md",
          "docs/decisions/b.md",
        ],
        resolved: { isOk: true, value: ["docs/decisions/A.md"] },
      });
    }
  );

  test("lists a folder whose names can't be looked up, skipping them", () => {
    // Given - a committed record renamed only in case on disk, in a folder
    // that can be listed but not searched
    const folder = path.join(repo.root, "docs/decisions");

    renameSync(path.join(folder, "a.md"), path.join(folder, "A.md"));

    chmodSync(folder, 0o444);

    // When - listing the bundle
    const loaded = loadCandidates({
      bundleDirs: ["docs/decisions"],
      excludeGlobs: [],
      repoRoot: repo.root,
      verifiedBy: VERIFIED_BY,
    });

    chmodSync(folder, 0o755);

    // Then - listed without throwing, none of its records readable
    expect(loaded).toStrictEqual({
      isOk: true,
      value: { candidates: [], skipped: [] },
    });
  });

  test.skipIf(DISK_SPELLING.isCaseInsensitive)(
    "keeps the disk's spelling of another file differing only in case",
    () => {
      // Given - a new record whose name differs from a committed one's only
      // in case
      repo.write("docs/decisions/A.md", draftRecord("Other A"));

      // When - naming it
      const resolved = resolveNames("docs/decisions/A.md");

      // Then - kept, since it's another file
      expect(resolved).toStrictEqual({
        isOk: true,
        value: ["docs/decisions/A.md"],
      });
    }
  );

  test.skipIf(DISK_SPELLING.isCaseInsensitive)(
    "keeps the disk's spelling when the index's file is gone from disk",
    () => {
      // Given - a committed record deleted, and a new one differing from it
      // only in case
      unlinkSync(path.join(repo.root, "docs/decisions/a.md"));
      repo.write("docs/decisions/A.md", draftRecord("Other A"));

      // When - naming the new one
      const resolved = resolveNames("docs/decisions/A.md");

      // Then - kept as the disk spells it
      expect(resolved).toStrictEqual({
        isOk: true,
        value: ["docs/decisions/A.md"],
      });
    }
  );
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
