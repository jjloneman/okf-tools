import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  draftRecord,
  record,
  useTestRepo,
  VERIFIED_BY,
  verifiedRecord,
} from "#test/repo";

import { describeSignOffDiff, readSignOffDiff } from "./sign-off-diff.ts";

const { repo } = useTestRepo();

/** Where every record in these tests lives. */
const FILE_PATH = "docs/decisions/a.md";

/** Read the diff for the record on disk. */
function readDiff(): ReturnType<typeof readSignOffDiff> {
  return readSignOffDiff({
    filePath: FILE_PATH,
    repoRoot: repo.root,
    text: repo.read(FILE_PATH),
    verifiedBy: VERIFIED_BY,
  });
}

/** The sign-off time most tests use. */
const SIGNED_AT = "2026-10-02T13:30:00Z";

/**
 * Commit each text of a record in turn; an empty one deletes it.
 */
function commitHistory(history: readonly string[]): void {
  history.forEach((text) => {
    if (text === "") {
      repo.git("rm", "--quiet", FILE_PATH);
      repo.commitAll("delete");
    } else {
      writeAndCommit(text);
    }
  });
}

/** A record signed off at `at`, then generated again after it. */
function regenerated(at: string): string {
  return signedAt(at).replace("2026-10-01T15:00:00Z", "2026-10-05T15:00:00Z");
}

/** A record whose `verified.at` is written as given. */
function signedAt(at: string): string {
  return record([
    "type: Decision",
    "status: stable",
    "generated: { by: claude-code/model, at: 2026-10-01T15:00:00Z }",
    `verified: { by: ${VERIFIED_BY}, at: ${at} }`,
  ]);
}

/** Write the record, commit it, and return the commit's short hash. */
function writeAndCommit(text: string): string {
  repo.write(FILE_PATH, text);
  repo.commitAll(`write ${FILE_PATH}`);

  return repo.git("rev-parse", "--short", "HEAD").trim();
}

describe("readSignOffDiff", () => {
  test("diffs from the sign-off commit to the disk, past later commits", () => {
    // Given - a draft, its sign-off, a committed edit, and an uncommitted one
    writeAndCommit(draftRecord("A"));
    const signOff = writeAndCommit(
      verifiedRecord({ by: VERIFIED_BY, title: "A" })
    );
    writeAndCommit(
      verifiedRecord({ by: VERIFIED_BY, title: "A" }).replace(
        "Body text.",
        "Committed edit."
      )
    );
    repo.write(
      FILE_PATH,
      verifiedRecord({ by: VERIFIED_BY, title: "A" }).replace(
        "Body text.",
        "Uncommitted edit."
      )
    );

    // When - reading the diff
    const result = readDiff();

    // Then - both edits, against the signed text
    expect(result).toStrictEqual({
      isOk: true,
      value: {
        kind: "diff",
        shortHash: signOff,
        text: expect.stringContaining(
          "-Body text.\n+Uncommitted edit.\n"
        ) as unknown,
      },
    });
  });

  test("reports an empty diff for a record unchanged since its sign-off", () => {
    // Given - a draft, then its sign-off
    writeAndCommit(draftRecord("A"));
    const signOff = writeAndCommit(
      verifiedRecord({ by: VERIFIED_BY, title: "A" })
    );

    // When - reading the diff
    const result = readDiff();

    // Then - nothing changed
    expect(result).toStrictEqual({
      isOk: true,
      value: { kind: "diff", shortHash: signOff, text: "" },
    });
  });

  test("matches a sign-off written differently on disk at the same second", () => {
    // Given - a signed record, its time rewritten with a fraction
    writeAndCommit(draftRecord("A"));
    const signOff = writeAndCommit(signedAt("2026-10-02T13:30:00Z"));
    repo.write(FILE_PATH, signedAt("2026-10-02T13:30:00.250Z"));

    // When - reading the diff
    const result = readDiff();

    // Then - the commit that signed it
    expect(result).toMatchObject({
      isOk: true,
      value: { kind: "diff", shortHash: signOff },
    });
  });

  test("finds the sign-off past a merged branch's later commit", () => {
    // Given - a sign-off on main, dated first, and a branch from before it,
    // edited later, so the branch's commit is listed between the two
    writeAndCommit(draftRecord("A"));
    repo.git("branch", "edit");
    repo.write(FILE_PATH, signedAt("2026-10-02T13:30:00Z"));
    repo.git("add", "--all");
    execFileSync("git", ["commit", "--quiet", "-m", "sign a"], {
      cwd: repo.root,
      env: { ...process.env, GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
    });
    const signOff = repo.git("rev-parse", "--short", "HEAD").trim();
    repo.git("checkout", "--quiet", "edit");
    writeAndCommit(draftRecord("A").replace("Body text.", "Branch edit."));
    repo.git("checkout", "--quiet", "main");
    repo.git("merge", "--quiet", "--no-edit", "edit");

    // When - reading the diff
    const result = readDiff();

    // Then - from the sign-off, showing the branch's edit
    expect(result).toStrictEqual({
      isOk: true,
      value: {
        kind: "diff",
        shortHash: signOff,
        text: expect.stringContaining(
          "-Body text.\n+Branch edit.\n"
        ) as unknown,
      },
    });
  });

  test("shows the whole record regenerated, then renamed, under log.follow", () => {
    // Given - a signed record, regenerated, then renamed, with git following
    // renames, which would list the commits from before the rename
    writeAndCommit(draftRecord("A"));
    writeAndCommit(signedAt(SIGNED_AT));
    writeAndCommit(regenerated(SIGNED_AT));
    repo.git("config", "log.follow", "true");
    repo.git("mv", FILE_PATH, "docs/decisions/b.md");
    repo.commitAll("rename");

    // When - reading the diff under the new name
    const result = readSignOffDiff({
      filePath: "docs/decisions/b.md",
      repoRoot: repo.root,
      text: repo.read("docs/decisions/b.md"),
      verifiedBy: VERIFIED_BY,
    });

    // Then - the whole record, since no commit under that name shows what
    // was signed
    expect(result).toMatchObject({ isOk: true, value: { kind: "noCommit" } });
  });

  test("skips a sign-off restored after a regeneration, to the one before", () => {
    // Given - signed, then regenerated without the sign-off, then the old
    // sign-off restored by hand
    writeAndCommit(draftRecord("A"));
    const signOff = writeAndCommit(signedAt(SIGNED_AT));
    writeAndCommit(
      draftRecord("A")
        .replace("2026-10-01T15:00:00Z", "2026-10-05T15:00:00Z")
        .replace("Body text.", "Regenerated.")
    );
    writeAndCommit(
      regenerated(SIGNED_AT).replace("Body text.", "Regenerated.")
    );

    // When - reading the diff
    const result = readDiff();

    // Then - from the real sign-off, showing the regeneration
    expect(result).toStrictEqual({
      isOk: true,
      value: {
        kind: "diff",
        shortHash: signOff,
        text: expect.stringContaining(
          "-Body text.\n+Regenerated.\n"
        ) as unknown,
      },
    });
  });

  test.each([
    {
      description: "a commit that added the record already signed",
      history: [signedAt(SIGNED_AT)],
    },
    {
      description: "a record deleted, then added back signed",
      history: [draftRecord("A"), "", signedAt(SIGNED_AT)],
    },
  ])("diffs from $description", ({ history }) => {
    // Given - the record's history, an empty entry deleting it
    commitHistory(history);
    const signOff = repo.git("rev-parse", "--short", "HEAD").trim();

    // When - reading the diff
    const result = readDiff();

    // Then - an empty diff from the commit that added it
    expect(result).toStrictEqual({
      isOk: true,
      value: { kind: "diff", shortHash: signOff, text: "" },
    });
  });

  test.each([
    {
      description: "a sign-off made by hand and not committed",
      disk: signedAt("2026-10-03T09:00:00Z"),
      history: [draftRecord("A")],
    },
    {
      description: "a sign-off committed in a record generated after it",
      disk: regenerated(SIGNED_AT),
      history: [draftRecord("A"), regenerated(SIGNED_AT)],
    },
    {
      description: "a sign-off time that can't be read, changed by hand",
      disk: signedAt("later"),
      history: [draftRecord("A"), signedAt("soon")],
    },
    {
      description: "a record never committed",
      disk: signedAt(SIGNED_AT),
      history: [],
    },
  ])("shows the whole record for $description", ({ disk, history }) => {
    // Given - the record's history, then the disk
    commitHistory(history);
    repo.write(FILE_PATH, disk);

    // When - reading the diff
    const result = readDiff();

    // Then - the whole record, since no commit shows what was signed
    expect(result).toStrictEqual({
      isOk: true,
      value: { kind: "noCommit", text: disk },
    });
  });

  test("shows the whole record when the signer never signed it", () => {
    // Given - a record signed by someone else
    writeAndCommit(verifiedRecord({ by: "human:someone", title: "A" }));

    // When - reading the diff
    const result = readDiff();

    // Then - the whole record
    expect(result).toStrictEqual({
      isOk: true,
      value: { kind: "unsigned", text: repo.read(FILE_PATH) },
    });
  });

  test("diffs a record that .gitattributes marks as not text", () => {
    // Given - records git is told not to diff, signed, then edited
    repo.write(".gitattributes", "*.md -diff\n");
    writeAndCommit(draftRecord("A"));
    writeAndCommit(signedAt(SIGNED_AT));
    repo.write(FILE_PATH, signedAt(SIGNED_AT).replace("Body", "Edited"));

    // When - reading the diff
    const result = readDiff();

    // Then - the lines, not "Binary files differ"
    expect(result).toMatchObject({
      isOk: true,
      value: { text: expect.stringContaining("+Edited text.") as unknown },
    });
  });

  test("shows the whole record when a shallow clone cuts off its sign-off", () => {
    // Given - signed, then edited without a regeneration, cloned one deep
    writeAndCommit(draftRecord("A"));
    writeAndCommit(signedAt(SIGNED_AT));
    writeAndCommit(signedAt(SIGNED_AT).replace("Body", "Edited"));
    const clone = mkdtempSync(path.join(tmpdir(), "okf-shallow-"));

    try {
      execFileSync(
        "git",
        ["clone", "--quiet", "--depth", "1", `file://${repo.root}`, clone],
        { stdio: "ignore" }
      );

      // When - reading the diff in the clone
      const result = readSignOffDiff({
        filePath: FILE_PATH,
        repoRoot: clone,
        text: repo.read(FILE_PATH),
        verifiedBy: VERIFIED_BY,
      });

      // Then - the whole record, since its oldest commit isn't its first
      expect(result).toMatchObject({ isOk: true, value: { kind: "noCommit" } });
    } finally {
      rmSync(clone, { force: true, recursive: true });
    }
  });

  test("fails on a branch with no commits", () => {
    // Given - a signed record on a branch with no commits yet
    repo.git("checkout", "--quiet", "--orphan", "empty");
    repo.write(FILE_PATH, signedAt("2026-10-02T13:30:00Z"));

    // When - reading the diff
    const result = readDiff();

    // Then - why
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't read the history of docs\/decisions\/a\.md: /u
      ) as unknown,
    });
  });

  test("fails when a committed version can't be read", () => {
    // Given - a signed record whose committed blob is gone
    writeAndCommit(signedAt("2026-10-02T13:30:00Z"));
    const blob = repo.git("rev-parse", `HEAD:${FILE_PATH}`).trim();
    rmSync(
      path.join(repo.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)),
      { force: true }
    );

    // When - reading the diff
    const result = readDiff();

    // Then - why, naming the commit
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringMatching(
        /^Couldn't read docs\/decisions\/a\.md at [0-9a-f]{40}: /u
      ) as unknown,
    });
  });

  test("fails when a parent's version can't be read", () => {
    // Given - a draft, then its sign-off, with the draft's blob gone
    writeAndCommit(draftRecord("A"));
    const blob = repo.git("rev-parse", `HEAD:${FILE_PATH}`).trim();
    writeAndCommit(signedAt("2026-10-02T13:30:00Z"));
    const parent = repo.git("rev-parse", "HEAD^").trim();
    rmSync(
      path.join(repo.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)),
      { force: true }
    );

    // When - reading the diff
    const result = readDiff();

    // Then - why, naming the parent
    expect(result).toStrictEqual({
      isOk: false,
      reason: expect.stringContaining(
        `Couldn't read docs/decisions/a.md at ${parent}: `
      ) as unknown,
    });
  });

  test("fails when git can't read the record on disk", () => {
    // Given - a signed, edited record git can't open
    writeAndCommit(draftRecord("A"));
    writeAndCommit(signedAt("2026-10-02T13:30:00Z"));
    const text = signedAt("2026-10-02T13:30:00Z").replace("Body", "Edited");
    repo.write(FILE_PATH, text);
    const absolutePath = path.join(repo.root, FILE_PATH);
    chmodSync(absolutePath, 0o000);

    try {
      // When - reading the diff
      const result = readSignOffDiff({
        filePath: FILE_PATH,
        repoRoot: repo.root,
        text,
        verifiedBy: VERIFIED_BY,
      });

      // Then - why
      expect(result).toStrictEqual({
        isOk: false,
        reason: expect.stringMatching(
          /^Couldn't diff docs\/decisions\/a\.md since [0-9a-f]{40}: /u
        ) as unknown,
      });
    } finally {
      chmodSync(absolutePath, 0o644);
    }
  });
});

describe("describeSignOffDiff", () => {
  test.each([
    {
      description: "a diff",
      diff: { kind: "diff", shortHash: "1a2b3c4", text: "-a\n+b\n" },
      expected: {
        body: "-a\n+b\n",
        heading: `${FILE_PATH}: changes since ${VERIFIED_BY}'s sign-off in 1a2b3c4`,
      },
    },
    {
      description: "an empty diff",
      diff: { kind: "diff", shortHash: "1a2b3c4", text: "" },
      expected: {
        body: "",
        heading: `${FILE_PATH}: unchanged since ${VERIFIED_BY}'s sign-off in 1a2b3c4`,
      },
    },
    {
      description: "no commit",
      diff: { kind: "noCommit", text: "record\n" },
      expected: {
        body: "record\n",
        heading: `${FILE_PATH}: no commit shows what ${VERIFIED_BY} signed off, so here is the whole record`,
      },
    },
    {
      description: "no sign-off",
      diff: { kind: "unsigned", text: "record\n" },
      expected: {
        body: "record\n",
        heading: `${FILE_PATH}: never signed off by ${VERIFIED_BY}, so here is the whole record`,
      },
    },
  ] as const)("words $description", ({ diff, expected }) => {
    // Given/When/Then - the heading and what to show under it
    expect(
      describeSignOffDiff({
        diff,
        filePath: FILE_PATH,
        verifiedBy: VERIFIED_BY,
      })
    ).toStrictEqual(expected);
  });
});

describe("describeSignOffDiff, given control characters", () => {
  test("shows them as escapes, keeping tabs and line breaks", () => {
    // Given - a record with an escape sequence, a lone carriage return, DEL,
    // a C1 character, a tab, a CRLF line, and an emoji
    const text = "+a\u001b[1A\u001b[2K\rb\u007f\u0085\tc\r\nd \u{1F600}\n";

    // When - wording it
    const { body } = describeSignOffDiff({
      diff: { kind: "unsigned", text },
      filePath: FILE_PATH,
      verifiedBy: VERIFIED_BY,
    });

    // Then - each control character visible, the rest kept
    expect(body).toBe("+a\\x1b[1A\\x1b[2K\\x0db\\x7f\\x85\tc\r\nd \u{1F600}\n");
  });
});
