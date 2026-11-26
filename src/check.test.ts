import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";

import { record, useTestRepo, VERIFIED_BY, verifiedRecord } from "#test/repo";

import type { CheckFinding, CheckReport } from "./check-engine.ts";
import type { DraftPolicy } from "./config.ts";
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
   * Whether `--changed` scopes the report to changed files.
   *
   * @example true
   */
  isChanged?: boolean;

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
    isChanged = false,
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
    isChanged,
    isGitHubActions,
    isStrict,
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
