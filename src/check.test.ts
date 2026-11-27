import { execFileSync } from "node:child_process";
import { chmodSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { record, useTestRepo, VERIFIED_BY, verifiedRecord } from "#test/repo";

import type { CheckFinding, CheckReport } from "./check-engine.ts";
import type { DraftPolicy } from "./config.ts";
import type { HouseRules } from "./house-rules.ts";
import type { BundleContext } from "./run-context.ts";

import { CHECK_SCHEMA_VERSION } from "./check-engine.ts";
import {
  formatAnnotation,
  formatFinding,
  formatSummary,
  runCheck,
} from "./check.ts";
import { EXIT_CODES } from "./exit-codes.ts";

const { repo } = useTestRepo();

/** A valid root `index.md`. */
const ROOT_INDEX = '---\nokf_version: "0.3"\n---\n# KB\n';

/** A record generated in 2026 that cites `src/a.ts`. */
const CITING = record([
  "type: Decision",
  "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
  "sources: [{ resource: ../src/a.ts }]",
]);

/** A record no rule finds anything in. */
const CONCEPT = record(["type: Decision", 'title: "A"']);

/** What `--changed` says when there's no base branch to diff against. */
const NO_BASE =
  "Can't diff against the base branch; checking uncommitted changes only. In CI, fetch the base branch, such as with actions/checkout's fetch-depth: 0.";

/** A record signed off by `human:jjloneman` after it was generated. */
const SIGNED = verifiedRecord({ by: VERIFIED_BY, title: "A" });

let data: string[];
let errors: string[];
let infos: string[];

beforeEach(() => {
  data = [];
  errors = [];
  infos = [];
});

/** Run `okf check` over the scratch repo's bundles. */
function check(params: {
  /**
   * The bundles, from the repo root.
   *
   * @example `["kb"]`
   */
  bundleDirs?: readonly string[];

  /**
   * How a draft is reported, from `okf.drafts`.
   *
   * @example "block"
   */
  drafts?: DraftPolicy | undefined;

  /**
   * The `okf.exclude` globs.
   *
   * @example `["kb/drafts"]`
   */
  excludeGlobs?: readonly string[];

  /**
   * How to print the report.
   *
   * @example "text"
   */
  format?: "json" | "text";

  /**
   * The house rules turned on, from `okf.rules`.
   *
   * @example `{ "tags-sorted": "error" }`
   */
  houseRules?: HouseRules;

  /**
   * Whether `--changed` scopes the report to changed files.
   *
   * @example true
   */
  isChanged?: boolean;

  /**
   * Whether `--fix` fixes what it can first.
   *
   * @example true
   */
  isFix?: boolean;

  /**
   * Whether it runs in GitHub Actions.
   *
   * @example false
   */
  isGitHubActions?: boolean;

  /**
   * Whether a warning fails the run.
   *
   * @example false
   */
  isStrict?: boolean;
}): number {
  const {
    bundleDirs = ["kb"],
    drafts,
    excludeGlobs = [],
    format = "text",
    houseRules = {},
    isChanged = false,
    isFix = false,
    isGitHubActions = false,
    isStrict = false,
  } = params;
  const context: BundleContext = {
    bundleDirs,
    cwd: repo.root,
    excludeGlobs,
    output: {
      data: (text) => data.push(text),
      error: (message) => errors.push(message),
      info: (message) => infos.push(message),
    },
    repoRoot: repo.root,
  };

  return runCheck({
    context,
    drafts,
    format,
    houseRules,
    isChanged,
    isFix,
    isGitHubActions,
    isStrict,
  });
}

/**
 * Commit everything in the scratch repo, authored and committed at a time,
 * as a rebase or a back-dated commit leaves it.
 */
function commitAt(params: {
  /**
   * When it was authored and committed, as an ISO date-time.
   *
   * @example "2026-10-05T15:00:00Z"
   */
  at: string;

  /**
   * The commit message.
   *
   * @example "edit a"
   */
  message: string;
}): void {
  const { at, message } = params;

  repo.git("add", "--all");
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd: repo.root,
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A finding with the given fields over a warning on line 3 of `kb/a.md`. */
function finding(fields: Partial<CheckFinding>): CheckFinding {
  return {
    code: "W117",
    line: 3,
    message: "quote title",
    path: "kb/a.md",
    rule: "string-quoted",
    severity: "warning",
    ...fields,
  };
}

describe("formatAnnotation", () => {
  test("words a finding as a workflow command", () => {
    // When/Then - the command, with the file, line, and title
    expect(formatAnnotation(finding({ severity: "error" }))).toBe(
      "::error file=kb/a.md,line=3,title=W117 string-quoted::quote title"
    );
  });

  test("leaves the line out of a finding about a missing file", () => {
    // When/Then - no line property, and info as a notice
    expect(formatAnnotation(finding({ line: null, severity: "info" }))).toBe(
      "::notice file=kb/a.md,title=W117 string-quoted::quote title"
    );
  });

  test("escapes what would end the command early", () => {
    // Given - a path and message holding every character the format reserves
    const escaped = finding({
      message: "100% sure: a, b",
      path: "kb/a,b:c%.md",
    });

    // When/Then - each one escaped
    expect(formatAnnotation(escaped)).toBe(
      "::warning file=kb/a%2Cb%3Ac%25.md,line=3,title=W117 string-quoted::100%25 sure: a, b"
    );
  });
});

describe("formatFinding", () => {
  test.each([
    {
      description: "a finding on a line",
      expected: "kb/a.md:3: warning W117 string-quoted: quote title",
      fields: {},
    },
    {
      description: "a finding about a missing file",
      expected: "kb/index.md: error E001 x: missing",
      fields: {
        code: "E001",
        line: null,
        message: "missing",
        path: "kb/index.md",
        rule: "x",
        severity: "error" as const,
      },
    },
    {
      description: "a message that would break the line",
      expected: "kb/a.md:3: warning W117 string-quoted: a b",
      fields: { message: "a\nb" },
    },
  ])("words $description", ({ expected, fields }) => {
    // When/Then - one line
    expect(formatFinding(finding(fields))).toBe(expected);
  });
});

describe("formatSummary", () => {
  test.each([
    {
      counts: { error: 1, info: 1, warning: 1 },
      description: "one of each",
      expected: "1 file checked: 1 error, 1 warning, 1 info.",
      filesChecked: 1,
    },
    {
      counts: { error: 0, info: 2, warning: 3 },
      description: "none or several",
      expected: "2 files checked: 0 errors, 3 warnings, 2 info.",
      filesChecked: 2,
    },
  ])("words $description", ({ counts, expected, filesChecked }) => {
    // Given - a report with those totals
    const report: CheckReport = {
      counts,
      filesChecked,
      findings: [],
      schemaVersion: CHECK_SCHEMA_VERSION,
      skipped: [],
    };

    // When/Then - the summary
    expect(formatSummary(report)).toBe(expected);
  });
});

describe("runCheck", () => {
  test("checks each Markdown file git would track, by its own bundle", () => {
    // Given - a bundle with a nested bundle, and files it must pass over
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", CONCEPT);
    repo.write("kb/log.md", "# Log\n\n## May 1\n");
    repo.write("kb/notes.txt", "not Markdown\n");
    repo.write("kb/drafts/x.md", "# Excluded\n");
    repo.write("kb/.hidden/x.md", "# In a dot-folder\n");
    repo.write("kb/ignored.md", "# Ignored by git\n");
    repo.write(".gitignore", "kb/ignored.md\n");
    repo.write("README.md", "# Outside every bundle\n");
    repo.write("outside.md", "# Outside the bundle\n");
    repo.write("kb/gone.md", "# Deleted\n");
    repo.write("kb/inner/c.md", "# No frontmatter\n");
    repo.commitAll("add the bundle");
    rmSync(path.join(repo.root, "kb/gone.md"));
    symlinkSync("../outside.md", path.join(repo.root, "kb/outside.md"));
    symlinkSync("..", path.join(repo.root, "kb/parent.md"));
    symlinkSync("a.md", path.join(repo.root, "kb/inside.md"));

    // When - checking both bundles
    const code = check({
      bundleDirs: ["kb", "kb/inner"],
      excludeGlobs: ["kb/drafts"],
    });

    // Then - the error, the nested bundle's warnings, and the totals
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([]);
    expect(data).toStrictEqual([]);
    expect(infos).toStrictEqual([
      'kb/log.md:3: error E005 log-date-heading: a log.md date heading must be YYYY-MM-DD (§9); found "May 1"',
      "kb/inner/c.md:1: warning W120 not-a-concept: not a concept: the file has no frontmatter (§3.2)",
      'kb/inner/index.md: warning W125 bundle-version: add a bundle-root index.md with okf_version: "0.3" (§8.1)',
      "5 files checked: 1 error, 2 warnings, 0 info.",
    ]);
  });

  test("prints the report as JSON data", () => {
    // Given - a bundle with no root index.md
    repo.write("kb/a.md", CONCEPT);

    // When - checking it as JSON
    const code = check({ format: "json" });

    // Then - one JSON document, in the public shape, and a warning passes
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([]);
    expect(JSON.parse(data.join(""))).toStrictEqual({
      counts: { error: 0, info: 0, warning: 1 },
      filesChecked: 1,
      findings: [
        {
          code: "W125",
          line: null,
          message: 'add a bundle-root index.md with okf_version: "0.3" (§8.1)',
          path: "kb/index.md",
          rule: "bundle-version",
          severity: "warning",
        },
      ],
      schemaVersion: CHECK_SCHEMA_VERSION,
      skipped: [],
    });
  });

  test("prints findings as annotations in GitHub Actions", () => {
    // Given - a log with a bad heading
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/log.md", "# Log\n\n## May 1\n");

    // When - checking it in GitHub Actions
    const code = check({ isGitHubActions: true });

    // Then - an annotation as data, and the finding and summary as info
    expect(code).toBe(EXIT_CODES.failure);
    expect(data).toStrictEqual([
      '::error file=kb/log.md,line=3,title=E005 log-date-heading::a log.md date heading must be YYYY-MM-DD (§9); found "May 1"',
    ]);
    expect(infos).toStrictEqual([
      'kb/log.md:3: error E005 log-date-heading: a log.md date heading must be YYYY-MM-DD (§9); found "May 1"',
      "2 files checked: 1 error, 0 warnings, 0 info.",
    ]);
  });

  test.each([
    {
      description: "without --strict",
      expected: EXIT_CODES.ok,
      isStrict: false,
    },
    {
      description: "under --strict",
      expected: EXIT_CODES.failure,
      isStrict: true,
    },
  ])(
    "exits on a warning as it should $description",
    ({ expected, isStrict }) => {
      // Given - a bundle whose only finding is a warning
      repo.write("kb/index.md", ROOT_INDEX);
      repo.write("kb/a.md", "# Not a concept\n");

      // When - checking it
      const code = check({ isStrict });

      // Then - it fails only under --strict
      expect(code).toBe(expected);
    }
  );

  test("passes a clean bundle under --strict", () => {
    // Given - a bundle no rule finds anything in
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", CONCEPT);

    // When - checking it strictly
    const code = check({ isStrict: true });

    // Then - it passes, with the totals alone
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "2 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });

  test("skips and fails on a file that isn't UTF-8", () => {
    // Given - a record whose bytes aren't UTF-8
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", "");
    writeFileSync(path.join(repo.root, "kb/a.md"), Buffer.from([0xff]));

    // When - checking it
    const code = check({});

    // Then - skipped, said on stderr, and a failure
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "Skipped: kb/a.md can't be read: it isn't valid UTF-8.",
    ]);
    expect(infos).toStrictEqual([
      "1 file checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });

  test("fails a record changed on the branch under an old sign-off", () => {
    // Given - a signed-off record on main, and a branch that edits its body
    // without re-stamping it, beside a draft and a file it leaves alone
    repo.write("kb/a.md", SIGNED);
    repo.write("kb/b.md", CONCEPT);
    repo.commitAll("add the records");
    repo.git("switch", "--quiet", "-c", "edit");
    repo.write("kb/a.md", `${SIGNED}\nA new paragraph.\n`);
    repo.commitAll("edit a");
    repo.write("kb/c.md", record(["type: Decision", "status: draft"]));

    // When - checking only what the branch changed
    const code = check({ isChanged: true });

    // Then - the gate's error and the draft's notice, but nothing about the
    // missing root index.md or the untouched record
    expect(code).toBe(EXIT_CODES.failure);
    expect(infos).toStrictEqual([
      "kb/a.md:5: error T006 unstamped-change: the body changed since the base branch, but human:jjloneman's sign-off at 2026-10-02T13:30:00Z, from before the change, still counts; re-stamp generated with okf touch, and sign it off again",
      "kb/c.md:3: info T001 draft: the record is a draft, so no one has signed it off as settled; okf verify signs it off",
      "2 files checked: 1 error, 0 warnings, 1 info.",
    ]);
  });

  test("warns about a record whose source changed after it was written", () => {
    // Given - a record generated before its cited file's commit, beside a
    // record that cites a URL
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    repo.write(
      "kb/b.md",
      record([
        "type: Decision",
        "sources: [{ resource: https://example.com/a }]",
      ])
    );
    repo.commitAll("add the records");
    repo.write("src/a.ts", "a2\n");
    repo.commitAll("edit a");

    // When - checking them
    const code = check({});

    // Then - a warning on the record that cites the file
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      expect.stringMatching(
        /^kb\/a\.md:4: warning T007 source-changed: source \.\.\/src\/a\.ts changed in [\da-f]+, at /u
      ),
      "3 files checked: 0 errors, 1 warning, 0 info.",
    ]);
  });

  test("warns about a source changed on a merged branch, reading each path alone", () => {
    // Given - a record, then its cited file edited on a side branch merged
    // back with a merge commit
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    repo.commitAll("add the record");
    repo.git("switch", "--quiet", "-c", "side");
    repo.write("src/a.ts", "a2\n");
    repo.commitAll("edit a");
    repo.git("switch", "--quiet", "main");
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    repo.git("merge", "--quiet", "--no-edit", "side");

    // When - checking it
    const code = check({});

    // Then - the same warning as on a history with no merge
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      expect.stringMatching(
        /^kb\/a\.md:4: warning T007 source-changed: source \.\.\/src\/a\.ts changed in [\da-f]+, at /u
      ),
      "2 files checked: 0 errors, 1 warning, 0 info.",
    ]);
  });

  test("warns about a source commit authored before the record but committed after it", () => {
    // Given - a record generated between its cited file's commit's author
    // time and its committer time, as a rebase-merged commit lands
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    repo.commitAll("add the records");
    repo.write("src/a.ts", "a2\n");
    repo.git("add", "--all");
    execFileSync("git", ["commit", "--quiet", "-m", "edit a"], {
      cwd: repo.root,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-09-30T15:00:00Z",
        GIT_COMMITTER_DATE: "2026-10-02T15:00:00Z",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // When - checking it
    const code = check({});

    // Then - a warning dated by when the commit landed
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      expect.stringMatching(
        /^kb\/a\.md:4: warning T007 source-changed: source \.\.\/src\/a\.ts changed in [\da-f]+, at 2026-10-02T15:00:00Z, /u
      ),
      "2 files checked: 0 errors, 1 warning, 0 info.",
    ]);
  });

  test("passes a source changed before its record's re-stamp, rebased to land after it", () => {
    // Given - a source's commit and then its record's re-stamp, both
    // committed after the re-stamp's time, as a rebase leaves them
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    repo.commitAll("add the record");
    repo.write("src/a.ts", "a2\n");
    commitAt({ at: "2026-10-05T15:00:00Z", message: "edit a" });
    repo.write("kb/a.md", CITING.replace("2026-10-01", "2026-10-03"));
    commitAt({ at: "2026-10-05T15:00:01Z", message: "re-stamp the record" });

    // When - checking it
    const code = check({});

    // Then - the record built on the source's commit, so nothing
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "2 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });

  test("warns about a source changed on a branch merged after its record's re-stamp", () => {
    // Given - a source changed on a side branch before its record's re-stamp
    // on main, then merged with a merge commit
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    commitAt({ at: "2026-09-01T15:00:00Z", message: "add the record" });
    repo.git("switch", "--quiet", "-c", "side");
    repo.write("src/a.ts", "a2\n");
    commitAt({ at: "2026-09-02T15:00:00Z", message: "edit a" });
    repo.git("switch", "--quiet", "main");
    repo.write("kb/a.md", CITING.replace("2026-10-01", "2026-10-03"));
    commitAt({ at: "2026-10-03T15:00:00Z", message: "re-stamp the record" });
    repo.git("merge", "--quiet", "--no-ff", "--no-edit", "side");
    const record = repo.git("log", "-1", "--format=%h", "--", "kb/a.md").trim();

    // When - checking it
    const code = check({});

    // Then - a warning, though the branch's commit is older than the
    // re-stamp
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      expect.stringMatching(
        new RegExp(
          String.raw`^kb/a\.md:4: warning T007 source-changed: source \.\./src/a\.ts changed in [\da-f]+, at 2026-09-02T15:00:00Z, which isn't in the history of the record's last commit, ${record}; `,
          "u"
        )
      ),
      "2 files checked: 0 errors, 1 warning, 0 info.",
    ]);
  });

  test("fails a record whose source was deleted", () => {
    // Given - a record citing a file that's since been deleted
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.commitAll("add a");
    repo.write("kb/a.md", CITING);
    rmSync(path.join(repo.root, "src/a.ts"));
    repo.commitAll("add the record, and delete a");

    // When - checking it
    const code = check({});

    // Then - an error
    expect(code).toBe(EXIT_CODES.failure);
    expect(infos).toStrictEqual([
      "kb/a.md:4: error T008 source-gone: source ../src/a.ts no longer exists, though git history has it; cite where it is now, or remove the source",
      "2 files checked: 1 error, 0 warnings, 0 info.",
    ]);
  });

  test("names the records citing a file the branch changed under --changed", () => {
    // Given - records on main, and a branch that changes one's source alone,
    // committed and not
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("src/b.ts", "b\n");
    repo.write("kb/a.md", CITING);
    repo.write(
      "kb/b.md",
      record([
        "type: Decision",
        "generated: { by: claude-code/1.0, at: 2999-01-01T00:00:00Z }",
        "sources: [{ resource: ../src/b.ts }]",
      ])
    );
    repo.write("kb/c.md", CONCEPT);
    repo.commitAll("add the records");
    repo.git("switch", "--quiet", "-c", "edit");
    repo.write("src/a.ts", "a2\n");
    repo.commitAll("edit a");
    repo.write("src/b.ts", "b2\n");

    // When - checking only what the branch changed
    check({ isChanged: true });

    // Then - both citing records are checked, and the untouched one isn't
    expect(infos).toStrictEqual([
      expect.stringMatching(/^kb\/a\.md:4: warning T007 source-changed: /u),
      expect.stringMatching(/^kb\/b\.md:3: warning T003 generated-ahead: /u),
      "2 files checked: 0 errors, 2 warnings, 0 info.",
    ]);
  });

  test("passes a source changed alongside its record in a repo with no commits", () => {
    // Given - a record and its source, uncommitted, on a branch with no commit
    repo.git("update-ref", "-d", "HEAD");
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    repo.write("kb/b.md", CONCEPT);
    repo.git("add", "--", "kb/index.md", "kb/b.md");

    // When - checking only what changed
    check({ isChanged: true });

    // Then - every file is uncommitted, so the record kept up with its
    // source
    expect(infos).toStrictEqual([
      "3 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });

  test("says when a source's history can't be read, and checks the rest", () => {
    // Given - a record whose source's history git has lost a tree of, beside
    // one that cites nothing
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "a\n");
    repo.write("kb/a.md", CITING);
    repo.write("kb/b.md", CONCEPT);
    repo.commitAll("add the record");
    const tree = repo.git("rev-parse", "HEAD^{tree}").trim();
    repo.write("b.md", "b\n");
    repo.commitAll("add b");
    rmSync(
      path.join(repo.root, ".git/objects", tree.slice(0, 2), tree.slice(2))
    );

    // When - checking it
    const code = check({});

    // Then - each history it couldn't read is said on stderr, and every
    // record is still checked
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      expect.stringMatching(
        /^Couldn't read the history of kb\/a\.md: .*; the source rules skip it\.$/u
      ),
      expect.stringMatching(
        /^Couldn't read the history of src\/a\.ts: .*; the source rules skip it\.$/u
      ),
    ]);
    expect(infos).toStrictEqual([
      "3 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });

  test("blocks a draft under okf.drafts block", () => {
    // Given - a draft
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", record(["type: Decision", "status: draft"]));

    // When - checking it with drafts blocked
    const code = check({ drafts: "block" });

    // Then - the draft is an error
    expect(code).toBe(EXIT_CODES.failure);
    expect(infos).toStrictEqual([
      "kb/a.md:3: error T001 draft: the record is a draft, so no one has signed it off as settled; okf verify signs it off",
      "2 files checked: 1 error, 0 warnings, 0 info.",
    ]);
  });

  test.each([
    { description: "as text", format: "text" as const },
    { description: "as JSON", format: "json" as const },
  ])(
    "says when there's no base branch to diff against, $description",
    ({ format }) => {
      // Given - a committed bundle on a branch other than main, in a repo
      // with no main or remote
      repo.write("kb/index.md", ROOT_INDEX);
      repo.commitAll("add the bundle");
      repo.git("branch", "--move", "main", "trunk");

      // When - checking only what changed
      check({ format, isChanged: true });

      // Then - the note, on stderr whatever the format
      expect(errors).toStrictEqual([NO_BASE]);
    }
  );

  test("judges uncommitted changes in a repo with no commits", () => {
    // Given - a record staged in a repo whose branch has no commit yet
    repo.git("update-ref", "-d", "HEAD");
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", CONCEPT);
    repo.git("add", "--all");

    // When - checking it
    const code = check({});

    // Then - every file, with nothing to compare them with
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "2 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
  });

  test("skips and fails on a changed record the base can't be read for", () => {
    // Given - a record changed since main, whose base copy git has lost
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", CONCEPT);
    repo.commitAll("add a");
    const blob = repo.git("rev-parse", "main:kb/a.md").trim();
    repo.write("kb/a.md", `${CONCEPT}\nMore.\n`);
    rmSync(
      path.join(repo.root, ".git/objects", blob.slice(0, 2), blob.slice(2))
    );

    // When - checking it
    const code = check({});

    // Then - skipped, said on stderr, and a failure
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(/^Skipped: Couldn't read kb\/a\.md at [\da-f]+: /u),
    ]);
  });

  test("fails, naming why, when a bundle can't be listed", () => {
    // Given - a bundle that isn't there
    repo.write("kb/index.md", ROOT_INDEX);

    // When - checking it
    const code = check({ bundleDirs: ["gone"] });

    // Then - a failure that says why, and no report
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(/^gone can't be listed: /u),
    ]);
    expect(infos).toStrictEqual([]);
  });

  test("fails, naming why, when git can't list the files", () => {
    // Given - a bundle in a repo whose index git can't read
    repo.write("kb/index.md", ROOT_INDEX);
    writeFileSync(path.join(repo.root, ".git/index"), "not an index");

    // When - checking it
    const code = check({});

    // Then - a failure that says why, and no report
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(/^Couldn't list the files git tracks: /u),
    ]);
    expect(infos).toStrictEqual([]);
  });
});

describe("runCheck --fix", () => {
  /** Every fixable house rule, turned on. */
  const FIXABLE: HouseRules = {
    "index-entry-missing": "error",
    "key-order": { level: "warn", order: ["type", "title", "tags"] },
    "tags-layout": { layout: "block", level: "warn" },
    "tags-sorted": "error",
  };

  test("fixes what has one obvious fix, then reports what's left", () => {
    // Given - a record out of order in every fixable way, missing from its index
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write(
      "kb/z.md",
      record([
        "tags: [c, a, b] # kept",
        "title: A",
        "type: Decision",
        "x-acme-owner: data-team",
        "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
      ])
    );

    // When - checking with --fix
    const code = check({ houseRules: FIXABLE, isFix: true });

    // Then - both files fixed, generated untouched, nothing left to report
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      "Fixed kb/z.md.",
      "Fixed kb/index.md.",
      "2 files checked: 0 errors, 0 warnings, 0 info.",
    ]);
    expect(repo.read("kb/z.md")).toBe(
      record([
        "type: Decision",
        "title: A",
        "tags: # kept",
        "  - a",
        "  - b",
        "  - c",
        "x-acme-owner: data-team",
        "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
      ])
    );
    expect(repo.read("kb/index.md")).toContain("[A](z.md)");
  });

  test("prints the fixes on stderr beside a JSON report", () => {
    // Given - a record with unsorted tags
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", record(["type: Decision", "tags: [b, a]"]));

    // When - checking with --fix, as JSON
    const code = check({
      format: "json",
      houseRules: { "tags-sorted": "error" },
      isFix: true,
    });

    // Then - stdout holds only the report, which finds nothing left
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual(["Fixed kb/a.md."]);
    expect(infos).toStrictEqual([]);
    expect((JSON.parse(data.join("")) as CheckReport).findings).toStrictEqual(
      []
    );
  });

  test("names what it can't fix, and keeps its findings", () => {
    // Given - unsorted tags with an anchor, a flow list under the flow layout,
    // and an index okf index can't read
    repo.write("kb/index.md", `${ROOT_INDEX}\n<!-- tag-index:start -->\n`);
    repo.write("kb/a.md", record(["type: Decision", "tags: &t [b, a]"]));
    repo.write("kb/b.md", record(["type: Decision", "tags:", "  - a"]));

    // When - checking with --fix
    const code = check({
      houseRules: {
        "index-entry-missing": "warn",
        "tags-layout": { layout: "flow", level: "warn" },
        "tags-sorted": "error",
      },
      isFix: true,
    });

    // Then - each named, nothing written, the findings kept
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "Not fixed: kb/a.md: `tags` has an anchor or a tag; fix the record by hand",
      expect.stringMatching(/^Not fixed: kb\/index\.md can't be synced: /u),
    ]);
    expect(infos.filter((line) => line.startsWith("Fixed"))).toStrictEqual([]);
    expect(infos.at(-1)).toBe("3 files checked: 1 error, 2 warnings, 0 info.");
  });

  test("fixes only what changed under --changed", () => {
    // Given - two records with unsorted tags, one changed since the commit
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("kb/a.md", record(["type: Decision", "tags: [b, a]"]));
    repo.write("kb/b.md", record(["type: Decision", "tags: [d, c]"]));
    repo.commitAll("add the records");
    repo.write("kb/b.md", record(["type: Decision", "tags: [f, e]"]));

    // When - checking with --fix under --changed
    check({
      houseRules: { "tags-sorted": "error" },
      isChanged: true,
      isFix: true,
    });

    // Then - only the changed record is fixed
    expect(repo.read("kb/a.md")).toBe(
      record(["type: Decision", "tags: [b, a]"])
    );
    expect(repo.read("kb/b.md")).toBe(
      record(["type: Decision", "tags: [e, f]"])
    );
  });

  test("leaves a record in scope only for citing a changed file under --changed", () => {
    // Given - a committed record citing a source, its tags out of order,
    // and the source changed since
    repo.write("kb/index.md", ROOT_INDEX);
    repo.write("src/a.ts", "export {};\n");
    repo.write(
      "kb/a.md",
      record([
        "type: Decision",
        "tags: [b, a]",
        "generated: { by: claude-code/1.0, at: 2026-10-01T15:00:00Z }",
        "sources: [{ resource: ../src/a.ts }]",
      ])
    );
    repo.commitAll("add the record");
    repo.write("src/a.ts", "export const a = 1;\n");

    // When - checking with --fix under --changed
    check({
      houseRules: { "tags-sorted": "error" },
      isChanged: true,
      isFix: true,
    });

    // Then - the record left as it was, its finding still reported
    expect(repo.read("kb/a.md")).toContain("tags: [b, a]");
    expect(infos.some((line) => line.includes("H002 tags-sorted"))).toBe(true);
  });

  test.skipIf(process.getuid?.() === 0)(
    "fails, writing nothing, when a write fails",
    () => {
      // Given - two records to fix, the second read-only
      repo.write("kb/index.md", ROOT_INDEX);
      repo.write("kb/a.md", record(["type: Decision", "tags: [b, a]"]));
      repo.write("kb/b.md", record(["type: Decision", "tags: [d, c]"]));
      chmodSync(path.join(repo.root, "kb/b.md"), 0o444);

      // When - checking with --fix
      let code: number;

      try {
        code = check({ houseRules: { "tags-sorted": "error" }, isFix: true });
      } finally {
        chmodSync(path.join(repo.root, "kb/b.md"), 0o644);
      }

      // Then - a failure naming the file, the first restored
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(
          /^Couldn't write kb\/b\.md: .*\nNo files changed\.$/su
        ),
      ]);
      expect(repo.read("kb/a.md")).toBe(
        record(["type: Decision", "tags: [b, a]"])
      );
    }
  );
});
