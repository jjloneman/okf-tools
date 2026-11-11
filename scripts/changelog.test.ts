import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TestRepo } from "#test/repo";

import { createTestRepo } from "#test/repo";

import {
  buildReleaseLine,
  formatReleaseLine,
  getDependencyReleaseLine,
  getReleaseLine,
  parseConventionalSubject,
  readCommitSubject,
  REPO_ROOT,
} from "./changelog.ts";

const HASH = "b4fc42d0d5a0e1f2c3b4a5968778695a4b3c2d1e";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo();
});

afterEach(() => {
  repo.remove();
});

describe("buildReleaseLine", () => {
  test("reads the subject of the commit that added the changeset", () => {
    // Given - a changeset committed with a conventional subject
    repo.write(".changeset/a.md", "---\n---\n\nAdd a flag.\n");
    repo.commitAll("feat(okf-verify): ✨ add a flag (#2)");
    const hash = repo.git("rev-parse", "HEAD").trim();

    // When - building its line from that repo
    const line = buildReleaseLine({
      changeset: { commit: hash, summary: "Add a flag." },
      cwd: repo.root,
    });

    // Then - the line carries the commit's gitmoji, scope, and short hash
    expect(line).toBe(`- ✨ **okf-verify:** Add a flag. (${hash.slice(0, 7)})`);
  });

  test("falls back to the bare summary for a commit git can't find", () => {
    // Given - a hash from before a squash, which isn't in the repo

    // When - building its line
    const line = buildReleaseLine({
      changeset: { commit: HASH, summary: "Add a flag." },
      cwd: repo.root,
    });

    // Then - the summary alone
    expect(line).toBe("- Add a flag.");
  });

  test("formats a changeset git found no commit for", () => {
    // Given - an uncommitted changeset, which has no hash

    // When - building its line
    const line = buildReleaseLine({
      changeset: { summary: "Add a flag." },
      cwd: repo.root,
    });

    // Then - the summary alone
    expect(line).toBe("- Add a flag.");
  });
});

describe("formatReleaseLine", () => {
  test.each([
    {
      description: "a gitmoji, a scope, and the short hash",
      expected: "- ✨ **okf-verify:** Add a flag. (b4fc42d)",
      subject: "feat(okf-verify): ✨ add a flag (#2)",
    },
    {
      description: "no scope",
      expected: "- 🔧 Add a flag. (b4fc42d)",
      subject: "fix: 🔧 fix a bug",
    },
    {
      description: "no gitmoji",
      expected: "- **okf-verify:** Add a flag. (b4fc42d)",
      subject: "feat(okf-verify): add a flag",
    },
    {
      description: "a breaking change",
      expected: "- ✨ **cli:** **Breaking:** Add a flag. (b4fc42d)",
      subject: "feat(cli)!: ✨ drop --all",
    },
    {
      description: "a subject that doesn't parse, keeping the hash",
      expected: "- Add a flag. (b4fc42d)",
      subject: "Merge branch 'main'",
    },
  ])("builds a line from $description", ({ expected, subject }) => {
    // Given - a changeset added by a commit with that subject
    const changeset = { commit: HASH, summary: "Add a flag.\n" };

    // When - formatting its line
    const line = formatReleaseLine({ changeset, subject });

    // Then - the expected line
    expect(line).toBe(expected);
  });

  test("falls back to the bare summary when the subject is unreadable", () => {
    // Given - a changeset whose commit couldn't be read
    const changeset = { commit: HASH, summary: "Add a flag." };

    // When - formatting its line with no subject
    const line = formatReleaseLine({ changeset, subject: undefined });

    // Then - the summary alone, with no hash
    expect(line).toBe("- Add a flag.");
  });

  test("leaves out an empty summary", () => {
    // Given - a changeset with a blank summary
    const changeset = { commit: HASH, summary: "  \n" };

    // When - formatting its line
    const line = formatReleaseLine({ changeset, subject: "feat: ✨ add" });

    // Then - no double space where the summary would be
    expect(line).toBe("- ✨ (b4fc42d)");
  });

  test("leaves the hash off a changeset with no commit", () => {
    // Given - a subject but no commit hash
    const changeset = { summary: "Add a flag." };

    // When - formatting its line
    const line = formatReleaseLine({
      changeset,
      subject: "feat(okf-verify): ✨ add a flag",
    });

    // Then - the gitmoji and scope, without a hash
    expect(line).toBe("- ✨ **okf-verify:** Add a flag.");
  });

  test("indents a summary's later lines under the bullet", () => {
    // Given - a summary with a blank line and a list
    const changeset = {
      commit: HASH,
      summary: "Add a flag.\n\n- one  \n- two\n",
    };

    // When - formatting its line
    const line = formatReleaseLine({ changeset, subject: "feat: ✨ add" });

    // Then - the later lines are indented, and the blank one stays empty
    expect(line).toBe("- ✨ Add a flag. (b4fc42d)\n\n  - one\n  - two");
  });
});

describe("getDependencyReleaseLine", () => {
  test("returns nothing, since the repo has no internal dependencies", () => {
    // Given - nothing

    // When - asking for the dependency line
    const line = getDependencyReleaseLine();

    // Then - an empty line, which changesets leaves out
    expect(line).toBe("");
  });
});

describe("getReleaseLine", () => {
  test("falls back to the bare summary for a commit git can't find", () => {
    // Given - a hash that isn't in this repo's history

    // When - changesets asks for its line
    const line = getReleaseLine({ commit: HASH, summary: "Add a flag." });

    // Then - the summary alone
    expect(line).toBe("- Add a flag.");
  });
});

describe("parseConventionalSubject", () => {
  test.each([
    {
      description: "a gitmoji with a variation selector",
      expected: { gitmoji: "🏗️", isBreaking: false, scope: "cli" },
      subject: "refactor(cli): 🏗️ split run",
    },
    {
      description: "a breaking-change marker",
      expected: { gitmoji: "✨", isBreaking: true, scope: "cli" },
      subject: "feat(cli)!: ✨ drop --all",
    },
    {
      description: "a gitmoji with a skin tone",
      expected: { gitmoji: "👍🏽", isBreaking: false },
      subject: "feat: 👍🏽 add x",
    },
    {
      description: "a joined gitmoji",
      expected: { gitmoji: "🧑‍💻", isBreaking: false },
      subject: "chore: 🧑‍💻 improve tooling",
    },
    {
      description: "a gitmoji followed by two spaces",
      expected: { gitmoji: "✨", isBreaking: false },
      subject: "feat: ✨  add x",
    },
    {
      description: "a plain first word, which isn't a gitmoji",
      expected: { isBreaking: false, scope: "cli" },
      subject: "feat(cli): add --all",
    },
    {
      description: "a subject with no type",
      expected: { isBreaking: false },
      subject: "✨ add --all",
    },
    {
      description: "a gitmoji with no description after it",
      expected: { isBreaking: false, scope: "cli" },
      subject: "feat(cli): ✨",
    },
  ])("reads $description", ({ expected, subject }) => {
    // Given - the subject

    // When - parsing it
    const parts = parseConventionalSubject(subject);

    // Then - the parts it holds
    expect(parts).toStrictEqual(expected);
  });
});

describe("readCommitSubject", () => {
  test("reads a commit's subject line", () => {
    // Given - a commit with a body
    repo.write("a.md", "a\n");
    repo.commitAll("docs: 📝 add a\n\n- body line");

    // When - reading HEAD's subject
    const subject = readCommitSubject({ cwd: repo.root, hash: "HEAD" });

    // Then - the first line only
    expect(subject).toBe("docs: 📝 add a");
  });

  test("reads each commit only once", () => {
    // Given - a commit whose subject was already read
    repo.write("a.md", "a\n");
    repo.commitAll("docs: 📝 add a");
    const hash = repo.git("rev-parse", "HEAD").trim();
    readCommitSubject({ cwd: repo.root, hash });

    // When - reading it again after the commit is amended away
    repo.git("commit", "--quiet", "--amend", "-m", "docs: 📝 renamed");
    repo.git("reflog", "expire", "--expire=now", "--all");
    repo.git("gc", "--quiet", "--prune=now");
    const subject = readCommitSubject({ cwd: repo.root, hash });

    // Then - the first answer, without asking git again
    expect(subject).toBe("docs: 📝 add a");
  });

  test("warns, and returns undefined, when git fails for another reason", () => {
    // Given - a directory that isn't a repo
    const directory = mkdtempSync(path.join(tmpdir(), "okf-tools-no-repo-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // When - reading a commit there
    const subject = readCommitSubject({ cwd: directory, hash: HASH });

    // Then - nothing, with a warning naming git's error
    expect(subject).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("not a git repository")
    );
    warn.mockRestore();
    rmSync(directory, { force: true, recursive: true });
  });

  test("returns undefined for a hash git can't find", () => {
    // Given - a hash that isn't in the repo

    // When - reading its subject
    const subject = readCommitSubject({ cwd: repo.root, hash: HASH });

    // Then - nothing
    expect(subject).toBeUndefined();
  });
});

describe("REPO_ROOT", () => {
  test("is this package's root, wherever the process runs", () => {
    // Given - the root the formatter reads git from

    // When - reading the package.json there
    const packageJson: unknown = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    );

    // Then - it's this package's
    expect(packageJson).toMatchObject({ name: "@jjloneman/okf-tools" });
  });
});
