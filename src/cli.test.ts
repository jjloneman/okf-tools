import { DateTime } from "luxon";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TestRepo } from "#test/repo";

import {
  createTestRepo,
  DISK_SPELLING,
  draftRecord,
  NEAR_MISSES,
  record,
  REFUSAL_REASON,
  refusedRecord,
  verifiedRecord,
} from "#test/repo";

import type { RunParams } from "./cli.ts";

import { run } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { runInteractive } from "./interactive.ts";

// The prompts are covered in interactive.test.ts; here only the dispatch is.
vi.mock(import("./interactive.ts"), () => ({
  runInteractive: vi.fn(() => Promise.resolve(EXIT_CODES.ok)),
}));

const CONFIG = JSON.stringify({
  okf: {
    bundles: ["docs/decisions", "docs/references"],
    verifiedBy: "human:jjloneman",
  },
});

/*
 * The two names the verify command runs under, each test running under both.
 *
 * - `okf verify` takes the command as `okf`'s first argument, and prints
 *   under `[okf]`.
 *
 * - `okf-verify` is its alias, and prints under its own name.
 */
const INVOCATIONS = [
  {
    command: "okf verify",
    prefix: "[okf]",
    program: "okf",
    toArgs: (args: readonly string[]): string[] => ["verify", ...args],
  },
  {
    command: "okf-verify",
    prefix: "[okf-verify]",
    program: "okf-verify",
    toArgs: (args: readonly string[]): string[] => [...args],
  },
] as const;

let invocation: (typeof INVOCATIONS)[number];
let repo: TestRepo;
let errors: string[];
let infos: string[];

beforeEach(() => {
  repo = createTestRepo(CONFIG);
  errors = [];
  infos = [];
  vi.spyOn(console, "error").mockImplementation((line: string) =>
    errors.push(line)
  );
  vi.spyOn(console, "log").mockImplementation((line: string) =>
    infos.push(line)
  );
});

afterEach(() => {
  repo.remove();
  vi.restoreAllMocks();
  vi.mocked(runInteractive).mockClear();
});

/** A pattern for a line that starts with the current invocation's prefix. */
function prefixed(pattern: RegExp): RegExp {
  const prefix = invocation.prefix.replaceAll(/[[\]]/gu, String.raw`\$&`);

  return new RegExp(`^${prefix} ${pattern.source}`, pattern.flags);
}

/** Run the verify command under the current invocation's name. */
function runCli(params: Omit<RunParams, "program">): Promise<number> {
  return run({
    ...params,
    args: invocation.toArgs(params.args),
    program: invocation.program,
  });
}

/** Run the CLI non-interactively from the repo root, or a directory in it. */
function runIn(args: string[], directory = "."): Promise<number> {
  return runCli({
    args,
    cwd: path.join(repo.root, directory),
    isInteractive: false,
  });
}

/** A Decision record generated in October and signed off at `at`. */
function signedRecord(at: string): string {
  return record([
    "type: Decision",
    "status: stable",
    "generated: { by: claude-code/model, at: 2026-10-01T10:00:00Z }",
    `verified: { by: human:jjloneman, at: ${at} }`,
  ]);
}

describe("run with no program named", () => {
  test("runs as okf-verify", async () => {
    // When - calling run as a library caller from before okf existed
    const code = await run({
      args: ["--help"],
      cwd: repo.root,
      isInteractive: false,
    });

    // Then - the verify command's usage, under okf-verify's name
    expect(code).toBe(0);
    expect(infos.join("\n")).toContain(
      "[okf-verify] usage: okf-verify [options]"
    );
  });
});

describe("run as okf, before a command runs", () => {
  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "verify"], description: "-h before a command" },
  ])("prints okf's usage for $description", async ({ args }) => {
    // When - asking okf for help
    const code = await run({
      args,
      cwd: repo.root,
      isInteractive: false,
      program: "okf",
    });

    // Then - the command list on stdout, under okf's prefix
    expect(code).toBe(0);
    expect(infos.join("\n")).toContain("[okf] usage: okf <command> [options]");
    expect(infos.join("\n")).toContain("[okf]   verify  ");
    expect(errors).toEqual([]);
  });

  test.each([
    { args: [], description: "no command", expected: "[okf] Name a command." },
    {
      args: ["sign", "--yes"],
      description: "an unknown command",
      expected: "[okf] Unknown command: sign.",
    },
    {
      args: ["--yes", "verify"],
      description: "a flag before the command",
      expected:
        "[okf] --yes isn't a command; options follow the command, as in okf <command> --yes.",
    },
  ])("fails with okf's usage on $description", async ({ args, expected }) => {
    // When - running okf so
    const code = await run({
      args,
      cwd: repo.root,
      isInteractive: false,
      program: "okf",
    });

    // Then - why, then the command list, on stderr
    expect(code).toBe(1);
    expect(errors[0]?.split("\n")[0]).toBe(expected);
    expect(errors.join("\n")).toContain("[okf] usage: okf <command> [options]");
    expect(infos).toEqual([]);
  });

  test("okf verify --help prints the verify command's usage", async () => {
    // When - asking the verify command for help
    const code = await run({
      args: ["verify", "--help"],
      cwd: repo.root,
      isInteractive: false,
      program: "okf",
    });

    // Then - its own usage, not okf's
    expect(code).toBe(0);
    expect(infos.join("\n")).toContain("[okf] usage: okf verify [options]");
    expect(infos.join("\n")).not.toContain("okf <command>");
  });
});

describe.each(INVOCATIONS)("as $command", (current) => {
  beforeEach(() => {
    invocation = current;
  });

  describe("run, before any records are read", () => {
    test("prints the usage for --help", async () => {
      // When - asking for help
      const code = await runIn(["--help"]);

      // Then - the usage on stdout
      expect(code).toBe(0);
      expect(infos.join("\n")).toContain(
        `${invocation.prefix} usage: ${invocation.command} [options]`
      );
    });

    test("prints the problem and the usage for bad arguments", async () => {
      // When - passing --yes alone
      const code = await runIn(["--yes"]);

      // Then - both on stderr
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("needs --changed");
      expect(errors.join("\n")).toContain(
        `${invocation.prefix} usage: ${invocation.command} [options]`
      );
    });

    test("refuses the prompts without a terminal", async () => {
      // Given - a bundle to scan
      repo.write("docs/decisions/a.md", draftRecord("A"));
      repo.write("docs/references/b.md", draftRecord("B"));

      // When - running without --yes or a terminal
      const code = await runIn([]);

      // Then - a pointer to --yes
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "pass --yes with --changed or record paths"
      );
      expect(runInteractive).not.toHaveBeenCalled();
    });

    test.each([
      {
        args: [],
        description: "a directory outside any repo",
        directory: "/",
        expected: "Couldn't find the repo root",
      },
      {
        args: ["--bundle", "missing"],
        description: "a missing bundle",
        directory: ".",
        expected: "No bundle directory at",
      },
      {
        args: ["--by", "has space", "--bundle", "."],
        description: "an unusable actor",
        directory: ".",
        expected: "isn't an actor a record can hold",
      },
    ])("fails on $description", async ({ args, directory, expected }) => {
      // When - running there
      const code = await runCli({
        args,
        cwd: directory === "/" ? "/" : path.join(repo.root, directory),
        isInteractive: true,
      });

      // Then - why, on stderr
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(expected);
    });

    test("fails on an unreadable package.json", async () => {
      // Given - a repo whose package.json isn't JSON
      repo.remove();
      repo = createTestRepo("{");

      // When - running
      const code = await runIn(["--bundle", "."]);

      // Then - why
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("package.json isn't valid JSON");
    });

    test("runs with flags alone when there is no package.json", async () => {
      // Given - a repo without a package.json, with one draft
      repo.git("rm", "--quiet", "package.json");
      repo.commitAll("drop package.json");
      repo.write("decisions/a.md", draftRecord("A"));

      // When - verifying it with flags
      const code = await runIn([
        "--yes",
        "--bundle",
        "decisions",
        "--by",
        "human:jjloneman",
        "decisions/a.md",
      ]);

      // Then - verified
      expect(code).toBe(0);
      expect(repo.read("decisions/a.md")).toContain(
        "verified: { by: human:jjloneman"
      );
    });
  });

  describe("run, interactively", () => {
    test("hands a terminal run to the prompts with the resolved context", async () => {
      // Given - both bundles exist
      repo.write("docs/decisions/a.md", draftRecord("A"));
      repo.write("docs/references/b.md", draftRecord("B"));

      // When - running in a terminal from a subdirectory
      const code = await runCli({
        args: ["--no-commit"],
        cwd: path.join(repo.root, "docs"),
        isInteractive: true,
      });

      // Then - the prompts get the bundles from the root
      expect(code).toBe(0);
      expect(runInteractive).toHaveBeenCalledWith({
        bundleDirs: ["docs/decisions", "docs/references"],
        cwd: path.join(repo.root, "docs"),
        excludeGlobs: [],
        output: {
          error: expect.any(Function) as unknown,
          info: expect.any(Function) as unknown,
        },
        repoRoot: repo.root,
        shouldCommit: false,
        verifiedBy: "human:jjloneman",
      });
    });

    test("reports an unexpected error instead of throwing", async () => {
      // Given - both bundles, and prompts that throw
      repo.write("docs/decisions/a.md", draftRecord("A"));
      repo.write("docs/references/b.md", draftRecord("B"));
      vi.mocked(runInteractive).mockRejectedValueOnce(
        new Error("prompts broke")
      );

      // When - running in a terminal
      const code = await runCli({
        args: [],
        cwd: repo.root,
        isInteractive: true,
      });

      // Then - the error, as a failure
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("prompts broke");
    });
  });

  describe("run --yes", () => {
    beforeEach(() => {
      repo.write("docs/decisions/a.md", draftRecord("A"));
      repo.write(
        "docs/decisions/b.md",
        verifiedRecord({ by: "human:jjloneman", title: "B" })
      );
      repo.write("docs/references/c.md", draftRecord("C"));
      repo.write("docs/references/d.md", draftRecord("D"));
      repo.commitAll("add records");
      repo.git("checkout", "--quiet", "-b", "feature");
    });

    test("--changed verifies every changed record across bundles in one commit", async () => {
      // Given - two records changed on the branch, one already verified
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
      repo.write(
        "docs/decisions/b.md",
        `${verifiedRecord({ by: "human:jjloneman", title: "B" })}\nMore.\n`
      );
      repo.write("docs/references/c.md", `${draftRecord("C")}\nMore.\n`);
      repo.commitAll("edit");

      // When - verifying the changed ones
      const code = await runIn(["--yes", "--changed"]);

      // Then - one commit with both drafts, the verified one skipped
      expect(code).toBe(0);
      expect(repo.git("show", "--name-only", "--format=%B", "HEAD")).toBe(
        "docs(okf): 📝 verify 2 decision records\n\n- A (a.md)\n- C (c.md)\n\n\ndocs/decisions/a.md\ndocs/references/c.md\n"
      );
      expect(infos).toContain(
        `${invocation.prefix} skipped docs/decisions/b.md: already verified, unchanged`
      );
      expect(infos.at(-1)).toMatch(prefixed(/committed [0-9a-f]+$/u));
    });

    test("--changed verifies a changed record in a folder, skipping excluded ones", async () => {
      // Given - nested changes, one in a folder the config excludes
      writeFileSync(
        path.join(repo.root, "package.json"),
        JSON.stringify({
          okf: {
            bundles: ["docs/decisions", "docs/references"],
            exclude: ["docs/decisions/drafts"],
            verifiedBy: "human:jjloneman",
          },
        })
      );
      repo.write("docs/decisions/api/e.md", draftRecord("E"));
      repo.write("docs/decisions/api/log.md", "# Log\n");
      repo.write("docs/decisions/drafts/f.md", "---\nkey: [\n---\n");
      repo.commitAll("add nested records");

      // When - verifying the changed ones
      const code = await runIn(["--yes", "--changed"]);

      // Then - only the nested record is committed
      expect(code).toBe(0);
      expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
        "docs/decisions/api/e.md\n"
      );
    });

    test("--changed fails on a changed record of invalid YAML", async () => {
      // Given - two changed records, one with a duplicated key
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
      repo.write("docs/references/c.md", "---\ntype: A\ntype: B\n---\n");

      // When - verifying the changed ones
      const code = await runIn(["--yes", "--changed", "--no-commit"]);

      // Then - a failure naming it, and nothing verified
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "docs/references/c.md: frontmatter isn't valid YAML"
      );
      expect(repo.read("docs/decisions/a.md")).toContain("status: draft");
    });

    test.each(NEAR_MISSES)(
      "fails on a changed record with $description, named or not",
      async ({ problem, text }) => {
        // Given - a changed draft whose frontmatter block is almost right
        repo.write("docs/decisions/a.md", text);

        // When - verifying the changed records, then naming it
        const changedCode = await runIn(["--yes", "--changed", "--no-commit"]);
        const namedCode = await runIn([
          "--yes",
          "--no-commit",
          "docs/decisions/a.md",
        ]);

        // Then - both fail naming it and why, and nothing is written
        expect({ changedCode, namedCode }).toStrictEqual({
          changedCode: 1,
          namedCode: 1,
        });
        expect(
          errors.filter((line) =>
            line.includes(`docs/decisions/a.md: ${problem}`)
          )
        ).toHaveLength(2);
        expect(repo.read("docs/decisions/a.md")).toBe(text);
      }
    );

    test("--changed fails on a record regenerated ahead of the clock", async () => {
      // Given - a record signed off long ago, then regenerated an hour ahead
      const ahead = DateTime.utc().plus({ hours: 1 }).startOf("second").toISO({
        suppressMilliseconds: true,
      });

      repo.write(
        "docs/decisions/a.md",
        record([
          "type: Decision",
          "status: stable",
          `generated: { by: claude-code/model, at: ${ahead} }`,
          "verified: { by: human:jjloneman, at: 2026-11-01T10:00:00Z }",
        ])
      );
      repo.commitAll("regenerate");

      // When - verifying the changed ones
      const code = await runIn(["--yes", "--changed", "--no-commit"]);

      // Then - a failure naming it, never a skip as already verified
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "docs/decisions/a.md: generated.at is ahead of the clock; fix its time zone"
      );
      expect(infos.join("\n")).not.toContain("already verified");
    });

    test.each([
      { args: ["--changed"], description: "--changed" },
      { args: ["docs/decisions/a.md"], description: "a named path" },
    ])(
      "$description signs again a record whose sign-off is ahead of the clock",
      async ({ args }) => {
        // Given - a sign-off dated 2099, then a regeneration before it
        repo.write(
          "docs/decisions/a.md",
          record([
            "type: Decision",
            "status: stable",
            "generated: { by: claude-code/model, at: 2026-11-20T10:00:00Z }",
            "verified: { by: human:jjloneman, at: 2099-01-01T00:00:00Z }",
          ])
        );
        repo.commitAll("regenerate");

        // When - verifying it
        const code = await runIn(["--yes", "--no-commit", ...args]);

        // Then - signed off now, renewing the entry dated 2099
        const text = repo.read("docs/decisions/a.md");

        expect(code).toBe(0);
        expect(infos).toContain(
          `${invocation.prefix} verified docs/decisions/a.md`
        );
        expect(text).not.toContain("2099");
        expect(text.match(/by: human:jjloneman/gu)).toHaveLength(1);
      }
    );

    test("commits a fresh sign-off over an uncommitted one ahead of the clock", async () => {
      // Given - a committed sign-off, and a later one dated 2099 left on disk
      repo.write("docs/decisions/a.md", signedRecord("2026-11-01T10:00:00Z"));
      repo.commitAll("sign off");
      repo.write("docs/decisions/a.md", signedRecord("2099-01-01T00:00:00Z"));

      // When - verifying it by name
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - signed again and committed, never as an uncommitted sign-off
      expect(code).toBe(0);
      expect(infos.join("\n")).not.toContain("not yet committed");
      expect(repo.git("show", "HEAD:docs/decisions/a.md")).not.toContain(
        "2099"
      );
    });

    test("commits a renewal left uncommitted over a sign-off ahead of the clock", async () => {
      // Given - a committed sign-off dated 2099, renewed on disk but not committed
      repo.write("docs/decisions/a.md", signedRecord("2099-01-01T00:00:00Z"));
      repo.commitAll("sign off");
      await runIn(["--yes", "--no-commit", "docs/decisions/a.md"]);
      infos.length = 0;

      // When - running the committing command again
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - the renewal committed as it is
      expect(code).toBe(0);
      expect(infos).toContain(
        `${invocation.prefix} committing docs/decisions/a.md: already verified, not yet committed`
      );
      expect(repo.git("show", "HEAD:docs/decisions/a.md")).not.toContain(
        "2099"
      );
    });

    test("skips an older revision restored over a sign-off ahead of the clock", async () => {
      // Given - an older signed revision restored over a committed 2099 sign-off
      const older = `${signedRecord("2026-11-01T10:00:00Z")}\nOlder.\n`;

      repo.write("docs/decisions/a.md", signedRecord("2099-01-01T00:00:00Z"));
      repo.commitAll("sign off");
      repo.write("docs/decisions/a.md", older);

      // When - verifying it by name
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - skipped as verified, never committed as a new sign-off
      expect(code).toBe(2);
      expect(infos).toContain(
        `${invocation.prefix} skipped docs/decisions/a.md: already verified, unchanged`
      );
      expect(repo.read("docs/decisions/a.md")).toBe(older);
    });

    test("--changed fails on a changed record that can't be read", async () => {
      // Given - two changed records, one with no read permission
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
      repo.write("docs/references/c.md", `${draftRecord("C")}\nMore.\n`);
      chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

      // When - verifying the changed ones
      const code = await runIn(["--yes", "--changed", "--no-commit"]);

      // Then - a failure naming it, and nothing verified
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(
        /docs\/decisions\/a\.md can't be read: /u
      );
      expect(repo.read("docs/references/c.md")).toContain("status: draft");
    });

    test("--changed falls back to uncommitted changes without a base branch", async () => {
      // Given - no main to diff against, and one uncommitted edit
      repo.git("branch", "--delete", "--force", "main");
      repo.write("docs/references/d.md", `${draftRecord("D")}\nMore.\n`);

      // When - verifying the changed ones
      const code = await runIn(["--yes", "--changed", "--no-commit"]);

      // Then - a warning, and the uncommitted record verified but not committed
      expect(code).toBe(0);
      expect(infos[0]).toContain("Can't diff against the base branch");
      expect(infos).toContain(
        `${invocation.prefix} verified docs/references/d.md`
      );
      expect(infos.at(-1)).toBe(
        `${invocation.prefix} Left uncommitted (--no-commit).`
      );
      expect(repo.git("status", "--porcelain")).toBe(
        " M docs/references/d.md\n"
      );
    });

    test("named records are verified relative to the cwd", async () => {
      // When - naming one record from a subdirectory
      const code = await runIn(["--yes", "references/d.md"], "docs");

      // Then - it alone, committed under its bundle's scope
      expect(code).toBe(0);
      expect(repo.git("log", "-1", "--format=%s")).toBe(
        "docs(references): 📝 verify 1 decision record\n"
      );
    });

    test("warns when a named record carries other uncommitted changes", async () => {
      // Given - an uncommitted edit to the record
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);

      // When - verifying it
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - the warning names it, and the commit includes the edit
      expect(code).toBe(0);
      expect(infos.join("\n")).toContain(
        `which the commit will include:\n${invocation.prefix} docs/decisions/a.md`
      );
      expect(repo.git("show", "HEAD", "--", "docs/decisions/a.md")).toContain(
        "+More."
      );
    });

    test.for([
      { args: ["--yes", "--changed"], description: "every changed record" },
      {
        args: ["--yes", "docs/decisions/new.md"],
        description: "a named record",
      },
    ])(
      "doesn't warn that a brand-new record has other changes, signing $description",
      async ({ args }) => {
        // Given - an untracked draft, the most common record to sign
        repo.write("docs/decisions/new.md", draftRecord("New"));

        // When - verifying it
        const code = await runIn(args);

        // Then - committed, with no warning about other uncommitted changes
        expect(code).toBe(0);
        expect(infos.join("\n")).not.toContain("other uncommitted changes");
        expect(
          repo.git("status", "--porcelain", "--", "docs/decisions/new.md")
        ).toBe("");
      }
    );

    test.each([
      { description: "a draft", status: "draft", verified: [] },
      {
        description: "a record signed off before",
        status: "stable",
        verified: [
          "verified: { by: human:jjloneman, at: 2026-11-01T10:00:00Z }",
        ],
      },
    ])(
      "refuses $description generated ahead of the clock",
      async ({ status, verified }) => {
        // Given - a record whose generated.at is a typo for a date to come
        const text = record([
          "type: Decision",
          `status: ${status}`,
          "generated: { by: claude-code/model, at: 2099-11-25T20:00:00Z }",
          ...verified,
        ]);

        repo.write("docs/decisions/a.md", text);

        // When - naming it
        const code = await runIn([
          "--yes",
          "--no-commit",
          "docs/decisions/a.md",
        ]);

        // Then - a failure asking for the time zone, and nothing written
        expect(code).toBe(1);
        expect(errors.join("\n")).toContain(
          "docs/decisions/a.md: generated.at is ahead of the clock; fix its time zone"
        );
        expect(repo.read("docs/decisions/a.md")).toBe(text);
      }
    );

    test("exits 2 when nothing needs verifying", async () => {
      // When - naming an already verified record
      const code = await runIn(["--yes", "docs/decisions/b.md"]);

      // Then - nothing to do
      expect(code).toBe(2);
      expect(infos.at(-1)).toBe(`${invocation.prefix} Nothing to verify.`);
    });

    test.each([
      {
        description: "a path outside the bundles",
        expected: "package.json isn't a record in",
        recordPath: "package.json",
      },
      {
        description: "a file with no frontmatter",
        expected: "docs/decisions/e.md has no frontmatter block.",
        recordPath: "docs/decisions/e.md",
      },
    ])("fails on $description", async ({ expected, recordPath }) => {
      // Given - a non-record in the bundle
      repo.write("docs/decisions/e.md", "# Just notes\n");

      // When - naming it
      const code = await runIn(["--yes", recordPath]);

      // Then - why
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(expected);
    });

    test("fails without touching anything when a named record refuses the edit", async () => {
      // Given - a record whose verified key is a nested mapping, which the editor refuses
      repo.write("docs/decisions/e.md", refusedRecord("Decision"));

      // When - naming it with a good one
      const code = await runIn([
        "--yes",
        "docs/decisions/a.md",
        "docs/decisions/e.md",
      ]);

      // Then - the refusal named before any write, and no file changed
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        `docs/decisions/e.md: ${REFUSAL_REASON}`
      );
      expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
    });

    test("fails, leaving the edit on disk, when the commit is rejected", async () => {
      // Given - a hook that rejects every commit
      repo.installFailingHook({ output: "hook says no" });

      // When - verifying a record
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - the hook's output, and the file still edited
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        `the commit failed:\n${invocation.prefix} hook says no`
      );
      expect(repo.read("docs/decisions/a.md")).toContain("status: stable");
      expect(infos.at(-1)).toBe(
        `${invocation.prefix} Once the commit can go through, run the same command again to commit it.`
      );
    });

    test("a re-run after a rejected commit commits the sign-off as it is", async () => {
      // Given - a sign-off left on disk by a commit a hook rejected
      repo.installFailingHook({ output: "hook says no" });
      await runIn(["--yes", "docs/decisions/a.md"]);
      unlinkSync(path.join(repo.root, ".git/hooks/pre-commit"));

      const signedOff = repo.read("docs/decisions/a.md");

      infos.length = 0;

      // When - running the same command again
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - committed unchanged, with no warning about its own change
      expect(code).toBe(0);
      expect(repo.git("status", "--porcelain")).toBe("");
      expect(repo.read("docs/decisions/a.md")).toBe(signedOff);
      expect(infos).toStrictEqual([
        `${invocation.prefix} committing docs/decisions/a.md: already verified, not yet committed`,
        expect.stringMatching(prefixed(/committed [0-9a-f]+$/u)),
      ]);
    });

    test("--changed commits a verified record HEAD doesn't have, beside a draft", async () => {
      // Given - a new record verified on disk but never committed, and a draft
      repo.write(
        "docs/decisions/e.md",
        verifiedRecord({ by: "human:jjloneman", title: "E" })
      );
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);

      // When - verifying every changed record
      const code = await runIn(["--yes", "--changed"]);

      // Then - both in one commit, the draft edited and the new one as it is
      expect(code).toBe(0);
      expect(repo.git("show", "--name-only", "--format=%s", "HEAD")).toBe(
        "docs(decisions): 📝 verify 2 decision records\n\ndocs/decisions/a.md\ndocs/decisions/e.md\n"
      );
      expect(infos).toContain(
        `${invocation.prefix} verified docs/decisions/a.md`
      );
      expect(infos).not.toContain(
        `${invocation.prefix} verified docs/decisions/e.md`
      );
    });

    test("--no-commit still skips a verified record that isn't committed", async () => {
      // Given - a sign-off on disk, not committed
      repo.write(
        "docs/decisions/a.md",
        verifiedRecord({ by: "human:jjloneman", title: "A" })
      );

      // When - naming it without committing
      const code = await runIn(["--yes", "--no-commit", "docs/decisions/a.md"]);

      // Then - nothing to do
      expect(code).toBe(2);
      expect(infos[0]).toBe(
        `${invocation.prefix} skipped docs/decisions/a.md: already verified, unchanged`
      );
    });

    test("skips a verified record when HEAD can't be read", async () => {
      // Given - a verified record on a branch with no commits yet
      repo.git("checkout", "--quiet", "--orphan", "empty");

      // When - naming it
      const code = await runIn(["--yes", "docs/decisions/b.md"]);

      // Then - skipped, as when it's committed
      expect(code).toBe(2);
      expect(infos[0]).toBe(
        `${invocation.prefix} skipped docs/decisions/b.md: already verified, unchanged`
      );
    });

    test("commits a verified record whose HEAD copy isn't a record", async () => {
      // Given - a file committed with no frontmatter, now a verified record
      repo.write("docs/decisions/e.md", "# Just notes\n");
      repo.commitAll("add notes");
      repo.write(
        "docs/decisions/e.md",
        verifiedRecord({ by: "human:jjloneman", title: "E" })
      );

      // When - naming it
      const code = await runIn(["--yes", "docs/decisions/e.md"]);

      // Then - committed as it is
      expect(code).toBe(0);
      expect(repo.git("status", "--porcelain")).toBe("");
    });

    test("a re-run commits a renewed sign-off over an older committed one", async () => {
      // Given - b.md regenerated on disk, re-verified, and the commit rejected
      repo.write(
        "docs/decisions/b.md",
        verifiedRecord({ by: "human:jjloneman", title: "B" }).replace(
          "at: 2026-10-01T15:00:00Z",
          "at: 2026-10-03T15:00:00Z"
        )
      );
      repo.installFailingHook({ output: "hook says no" });
      await runIn(["--yes", "docs/decisions/b.md"]);
      unlinkSync(path.join(repo.root, ".git/hooks/pre-commit"));

      // When - running the same command again
      const code = await runIn(["--yes", "docs/decisions/b.md"]);

      // Then - the renewed sign-off is committed
      expect(code).toBe(0);
      expect(repo.git("status", "--porcelain")).toBe("");
    });

    test("warns when an uncommitted sign-off carries other changes too", async () => {
      // Given - a sign-off left by a rejected commit, then a body edit
      repo.installFailingHook({ output: "hook says no" });
      await runIn(["--yes", "docs/decisions/a.md"]);
      unlinkSync(path.join(repo.root, ".git/hooks/pre-commit"));
      repo.write(
        "docs/decisions/a.md",
        `${repo.read("docs/decisions/a.md")}\nMore.\n`
      );

      // When - running the same command again
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - committed whole, with the warning naming it
      expect(code).toBe(0);
      expect(infos.join("\n")).toContain(
        `which the commit will include:\n${invocation.prefix} docs/decisions/a.md`
      );
    });

    test("skips an older sign-off restored over the committed one", async () => {
      // Given - b.md committed with a later sign-off, and the older copy restored
      const older = verifiedRecord({ by: "human:jjloneman", title: "B" });

      repo.write(
        "docs/decisions/b.md",
        older.replace("at: 2026-10-02T13:30:00Z", "at: 2026-10-05T13:30:00Z")
      );
      repo.commitAll("renew b");
      repo.write("docs/decisions/b.md", older);

      // When - naming it
      const code = await runIn(["--yes", "docs/decisions/b.md"]);

      // Then - skipped, and left uncommitted
      expect(code).toBe(2);
      expect(repo.git("status", "--porcelain")).toBe(
        " M docs/decisions/b.md\n"
      );
    });

    test("still skips a verified record git ignores, and verifies the rest", async () => {
      // Given - a verified record never committed, which git ignores
      repo.write(".gitignore", "docs/decisions/e.md\n");
      repo.commitAll("ignore e");
      repo.write(
        "docs/decisions/e.md",
        verifiedRecord({ by: "human:jjloneman", title: "E" })
      );

      // When - naming it beside a draft
      const code = await runIn([
        "--yes",
        "docs/decisions/a.md",
        "docs/decisions/e.md",
      ]);

      // Then - skipped, and the draft committed
      expect(code).toBe(0);
      expect(infos).toContain(
        `${invocation.prefix} skipped docs/decisions/e.md: already verified, unchanged`
      );
      expect(repo.git("status", "--porcelain")).toBe("");
    });

    test("fails when git status can't confirm an uncommitted sign-off", async () => {
      // Given - a sign-off on disk, not committed, and an index git can't read
      repo.write(
        "docs/decisions/a.md",
        verifiedRecord({ by: "human:jjloneman", title: "A" })
      );
      repo.write(".git/index", "garbage\n");

      // When - naming it
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - why, and the record as it was
      expect(code).toBe(1);
      expect(errors[0]).toMatch(
        prefixed(/Couldn't read git status for docs\/decisions\/a\.md: /u)
      );
    });

    test("leaves the record untouched when a merge is in progress", async () => {
      // Given - a merge stopped before its commit
      repo.git("checkout", "--quiet", "-b", "other");
      repo.write("other.txt", "x\n");
      repo.commitAll("other");
      repo.git("checkout", "--quiet", "feature");
      repo.write("feature.txt", "y\n");
      repo.commitAll("feature");
      repo.git("merge", "--quiet", "--no-ff", "--no-commit", "other");

      // When - verifying a draft
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - refused before any write
      expect(code).toBe(1);
      expect(errors).toStrictEqual([
        `${invocation.prefix} A merge is in progress, and git won't commit only some files during one; finish or abort it first.\n${invocation.prefix} No files changed.`,
      ]);
      expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
    });

    test("leaves an ignored record untouched", async () => {
      // Given - a draft that git ignores
      repo.write(".gitignore", "docs/decisions/e.md\n");
      repo.commitAll("ignore e");
      repo.write("docs/decisions/e.md", draftRecord("E"));

      // When - verifying it
      const code = await runIn(["--yes", "docs/decisions/e.md"]);

      // Then - refused with git's reason, and the file as it was
      expect(code).toBe(1);
      expect(errors[0]).toMatch(
        prefixed(
          /git won't stage docs\/decisions\/e\.md: The following paths are ignored/u
        )
      );
      expect(repo.read("docs/decisions/e.md")).toBe(draftRecord("E"));
    });

    test("restores every record when one can't be written", async () => {
      // Given - two drafts, the second read-only
      chmodSync(path.join(repo.root, "docs/references/d.md"), 0o444);

      // When - verifying both
      const code = await runIn([
        "--yes",
        "docs/decisions/a.md",
        "docs/references/d.md",
      ]);

      // Then - a failure naming it, no "verified" lines, and the first untouched
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "Couldn't write docs/references/d.md"
      );
      expect(infos.some((line) => line.includes("verified "))).toBe(false);
      expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
    });

    test.for([
      {
        args: ["--changed"],
        description: "--changed",
        paths: "docs/decisions, docs/references",
      },
      {
        args: ["docs/decisions/a.md"],
        description: "a named record",
        paths: "docs/decisions/a.md",
      },
    ])(
      "$description fails naming the paths when git status fails",
      async ({ args, paths }) => {
        // Given - an index git can't read
        repo.write(".git/index", "garbage\n");

        // When - verifying
        const code = await runIn(["--yes", ...args]);

        // Then - a failure naming the paths, and nothing written
        expect(code).toBe(1);
        expect(errors).toStrictEqual([
          `${invocation.prefix} Couldn't read git status for ${paths}: fatal: .git/index: index file smaller than expected`,
        ]);
        expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
      }
    );

    test.for([
      {
        args: ["--no-commit", "docs/decisions/a.md"],
        code: 0,
        description: "a run that doesn't commit",
      },
      {
        args: ["docs/decisions/b.md"],
        code: 2,
        description: "a run with nothing to verify",
      },
    ])("$description never needs git status", async ({ args, code }) => {
      // Given - an index git can't read
      repo.write(".git/index", "garbage\n");

      // When - verifying named records
      const exitCode = await runIn(["--yes", ...args]);

      // Then - the run ends as it would with a working index
      expect({ errors, exitCode }).toStrictEqual({
        errors: [],
        exitCode: code,
      });
    });

    test("refuses a named record that can't be read", async () => {
      // Given - a record that can't be read
      chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

      // When - verifying it
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - the reason, as a failure
      expect(code).toBe(1);
      expect(errors.join("\n")).toMatch(
        /docs\/decisions\/a\.md can't be read: .*EACCES/u
      );
    });
  });

  describe("run --yes, given records that are bytes, not only text", () => {
    /** A draft whose body holds a Latin-1 é, a byte that isn't valid UTF-8. */
    const LATIN1_DRAFT = Buffer.concat([
      Buffer.from(draftRecord("Latin-1")),
      Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
    ]);

    /** A draft with a byte order mark and a UTF-8 é in its body. */
    const UTF8_DRAFT = Buffer.from(`\uFEFF${draftRecord("UTF-8")}café\n`);

    /** Read a file's bytes, relative to the repo root. */
    function readBytes(filePath: string): Buffer {
      return readFileSync(path.join(repo.root, filePath));
    }

    /** Write a file's bytes, relative to the repo root. */
    function writeBytes(params: { bytes: Buffer; filePath: string }): void {
      const { bytes, filePath } = params;

      writeFileSync(path.join(repo.root, filePath), bytes);
    }

    beforeEach(() => {
      repo.write("docs/decisions/b.md", draftRecord("B"));
      repo.write("docs/references/c.md", draftRecord("C"));
    });

    test("refuses a record that isn't valid UTF-8, leaving its bytes alone", async () => {
      // Given - a draft whose body isn't valid UTF-8
      writeBytes({ bytes: LATIN1_DRAFT, filePath: "docs/decisions/a.md" });

      // When - verifying it with a good one
      const code = await runIn([
        "--yes",
        "--no-commit",
        "docs/decisions/a.md",
        "docs/decisions/b.md",
      ]);

      // Then - the reason, as a failure, and neither file changed
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "docs/decisions/a.md can't be read: it isn't valid UTF-8."
      );
      expect(readBytes("docs/decisions/a.md")).toStrictEqual(LATIN1_DRAFT);
      expect(repo.read("docs/decisions/b.md")).toBe(draftRecord("B"));
    });

    test("restores a record's exact bytes when a later write fails", async () => {
      // Given - a draft with a byte order mark and an é, then a read-only one
      writeBytes({ bytes: UTF8_DRAFT, filePath: "docs/decisions/a.md" });
      chmodSync(path.join(repo.root, "docs/decisions/b.md"), 0o444);

      // When - verifying both, so the second write fails after the first
      const code = await runIn([
        "--yes",
        "--no-commit",
        "docs/decisions/a.md",
        "docs/decisions/b.md",
      ]);

      // Then - "No files changed" holds byte for byte
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain("No files changed");
      expect(readBytes("docs/decisions/a.md")).toStrictEqual(UTF8_DRAFT);
    });

    test("keeps a byte order mark when it verifies a record", async () => {
      // Given - a draft with a byte order mark and an é
      writeBytes({ bytes: UTF8_DRAFT, filePath: "docs/decisions/a.md" });

      // When - verifying it
      const code = await runIn(["--yes", "--no-commit", "docs/decisions/a.md"]);

      // Then - the same bytes before and after the frontmatter edit
      const after = readBytes("docs/decisions/a.md").toString("utf8");

      expect(code).toBe(0);
      expect(after.startsWith("\uFEFF---\n")).toBe(true);
      expect(after).toContain("status: stable");
      expect(after.endsWith("café\n")).toBe(true);
    });
  });

  describe("run --yes, given a symlink in the repo", () => {
    /** The reason a linked path is refused, after the path it leads to. */
    const LINK_EXPLANATION =
      "Records are edited only at their own path, since git commits a symlink, not the file it points to.";

    let outsideDir: string;

    beforeEach(() => {
      outsideDir = realpathSync(
        mkdtempSync(path.join(tmpdir(), "okf-outside-"))
      );
      mkdirSync(path.join(repo.root, "docs/references"), { recursive: true });
    });

    afterEach(() => {
      rmSync(outsideDir, { force: true, recursive: true });
    });

    test("never writes through a record linked to a file outside the repo", async () => {
      // Given - a record that is a symlink to a draft outside the repo
      const outside = path.join(outsideDir, "elsewhere.md");

      writeFileSync(outside, draftRecord("Elsewhere"));
      mkdirSync(path.join(repo.root, "docs/decisions"), { recursive: true });
      symlinkSync(outside, path.join(repo.root, "docs/decisions/link.md"));

      // When - verifying it
      const code = await runIn([
        "--yes",
        "--no-commit",
        "docs/decisions/link.md",
      ]);

      // Then - refused, naming where it leads, and the file left alone
      expect({ code, errors }).toStrictEqual({
        code: 1,
        errors: [
          `${invocation.prefix} docs/decisions/link.md is a symlink, or inside one, to ${outside}. ${LINK_EXPLANATION}`,
        ],
      });
      expect(readFileSync(outside, "utf8")).toBe(draftRecord("Elsewhere"));
    });

    test.each([
      {
        description: "a file elsewhere in the repo",
        target: "../../drafts/real.md",
        targetPath: "drafts/real.md",
      },
      {
        description: "another record in the same bundle",
        target: "b.md",
        targetPath: "docs/decisions/b.md",
      },
    ])(
      "refuses a record linked to $description, leaving it committed",
      async ({ target, targetPath }) => {
        // Given - a committed record that is a symlink to a committed draft
        repo.write(targetPath, draftRecord("Real"));
        mkdirSync(path.join(repo.root, "docs/decisions"), { recursive: true });
        symlinkSync(target, path.join(repo.root, "docs/decisions/link.md"));
        repo.commitAll("add a linked record");

        // When - verifying the link, committing
        const code = await runIn(["--yes", "docs/decisions/link.md"]);

        // Then - refused, with nothing written
        expect({ code, errors }).toStrictEqual({
          code: 1,
          errors: [
            `${invocation.prefix} docs/decisions/link.md is a symlink, or inside one, to ${path.join(repo.root, targetPath)}. ${LINK_EXPLANATION}`,
          ],
        });
        expect(repo.git("status", "--porcelain")).toBe("");
      }
    );

    test("fails a --changed run that finds a linked record", async () => {
      // Given - a new record that is a symlink to a draft
      repo.write("drafts/real.md", draftRecord("Real"));
      mkdirSync(path.join(repo.root, "docs/decisions"), { recursive: true });
      symlinkSync(
        "../../drafts/real.md",
        path.join(repo.root, "docs/decisions/link.md")
      );

      // When - verifying every changed record
      const code = await runIn(["--yes", "--no-commit", "--changed"]);

      // Then - refused, with the draft left alone
      expect(code).toBe(1);
      expect(errors.join("\n")).toContain(
        "docs/decisions/link.md is a symlink, or inside one"
      );
      expect(repo.read("drafts/real.md")).toBe(draftRecord("Real"));
    });

    test("refuses a bundle reached through a symlink", async () => {
      // Given - a committed bundle directory that is a symlink to a folder
      repo.write("real/a.md", draftRecord("A"));
      mkdirSync(path.join(repo.root, "docs"), { recursive: true });
      symlinkSync("../real", path.join(repo.root, "docs/decisions"));
      repo.commitAll("add a behind a symlink");

      // When - verifying the record through the linked bundle
      const code = await runIn(["--yes", "docs/decisions/a.md"]);

      // Then - refused before any record is read, with nothing written
      expect({ code, errors }).toStrictEqual({
        code: 1,
        errors: [
          `${invocation.prefix} The bundle ${path.join(repo.root, "docs/decisions")} is a symlink, or inside one, to ${path.join(repo.root, "real")}. ${LINK_EXPLANATION}`,
        ],
      });
      expect(repo.git("status", "--porcelain")).toBe("");
    });
  });

  describe("run --yes, given another spelling of a path", () => {
    /** The record's name, decomposed, as some tools write it. */
    const DECOMPOSED = "docs/decisions/cafe\u0301.md";

    /** The same name, composed, as git on macOS prints it. */
    const COMPOSED = "docs/decisions/caf\u00e9.md";

    let outsideDir: string;

    beforeEach(() => {
      outsideDir = realpathSync(
        mkdtempSync(path.join(tmpdir(), "okf-outside-"))
      );
      mkdirSync(path.join(repo.root, "docs/references"), { recursive: true });
    });

    afterEach(() => {
      rmSync(outsideDir, { force: true, recursive: true });
    });

    test("signs a record when the cwd reaches the repo through a symlink", async () => {
      // Given - a symlink to the repo, and a draft
      const link = path.join(outsideDir, "repo-link");

      symlinkSync(repo.root, link);
      repo.write("docs/decisions/a.md", draftRecord("A"));

      // When - verifying it from the linked path
      const code = await runCli({
        args: ["--yes", "docs/decisions/a.md"],
        cwd: link,
        isInteractive: false,
      });

      // Then - signed and committed at its path in the repo
      expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
      expect(repo.git("status", "--porcelain")).toBe("");
      expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
        "docs/decisions/a.md\n"
      );
    });

    test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
      "signs a record from a cwd spelled in another case",
      async () => {
        // Given - a draft, and the repo root spelled in upper case
        repo.write("docs/decisions/a.md", draftRecord("A"));

        // When - verifying it from that spelling
        const code = await runCli({
          args: ["--yes", "docs/decisions/a.md"],
          cwd: repo.root.toUpperCase(),
          isInteractive: false,
        });

        // Then - signed and committed
        expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
        expect(repo.git("status", "--porcelain")).toBe("");
      }
    );

    test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
      "finds a changed record when the bundle is configured in another case",
      async () => {
        // Given - a bundle configured in another case, and a new draft in it
        repo.write(
          "package.json",
          JSON.stringify({
            okf: { bundles: ["docs/Decisions"], verifiedBy: "human:jjloneman" },
          })
        );
        repo.commitAll("configure the bundle");
        repo.write("docs/decisions/a.md", draftRecord("A"));

        // When - verifying every changed record
        const code = await runIn(["--yes", "--changed"]);

        // Then - found under git's spelling, signed and committed
        expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
        expect(repo.git("status", "--porcelain")).toBe("");
        expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
          "docs/decisions/a.md\n"
        );
      }
    );

    test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
      "commits a record named, with its bundle, in another case",
      async () => {
        // Given - a committed draft
        repo.write("docs/decisions/a.md", draftRecord("A"));
        repo.commitAll("add a");

        // When - naming the bundle and the record in another case
        const code = await runIn([
          "--yes",
          "--bundle",
          "docs/Decisions",
          "DOCS/Decisions/A.md",
        ]);

        // Then - signed and committed at the path git knows
        expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
        expect(repo.git("status", "--porcelain")).toBe("");
        expect(repo.read("docs/decisions/a.md")).toContain("status: stable");
      }
    );

    test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
      "refuses the bundle's index.md named in another case",
      async () => {
        // Given - a bundle with an index
        repo.write("docs/decisions/index.md", draftRecord("Index"));

        // When - naming the index in another case
        const code = await runIn(["--yes", "docs/decisions/INDEX.md"]);

        // Then - refused as not a record
        expect({ code, errors }).toStrictEqual({
          code: 1,
          errors: [
            `${invocation.prefix} docs/decisions/INDEX.md isn't a record in docs/decisions, docs/references.`,
          ],
        });
      }
    );

    test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
      "keeps git's spelling when the disk's differs only in case",
      async () => {
        // Given - a committed draft whose folder was renamed only in case on
        // disk, so git still spells it as configured
        repo.write("docs/decisions/a.md", draftRecord("A"));
        repo.commitAll("add a");
        renameSync(
          path.join(repo.root, "docs/decisions"),
          path.join(repo.root, "docs/Decisions")
        );
        repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);

        // When - verifying every changed record
        const code = await runIn(["--yes", "--changed"]);

        // Then - found, signed and committed under git's spelling
        expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
        expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
          "docs/decisions/a.md\n"
        );
      }
    );

    test.skipIf(!DISK_SPELLING.isNormalizationInsensitive)(
      "finds a changed record in a bundle whose folder is decomposed",
      async () => {
        // Given - a bundle configured composed, its folder decomposed on disk
        repo.write(
          "package.json",
          JSON.stringify({
            okf: { bundles: ["docs/caf\u00e9"], verifiedBy: "human:jjloneman" },
          })
        );
        repo.commitAll("configure the bundle");
        repo.write("docs/cafe\u0301/a.md", draftRecord("A"));

        // When - verifying every changed record
        const code = await runIn(["--yes", "--changed"]);

        // Then - found, signed and committed
        expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
        expect(repo.git("status", "--porcelain")).toBe("");
      }
    );

    test("commits a record whose name is decomposed Unicode", async () => {
      // Given - a committed draft whose file name is decomposed
      repo.write(DECOMPOSED, draftRecord("Cafe"));
      repo.commitAll("add cafe");

      // When - naming it as the disk spells it
      const code = await runIn(["--yes", DECOMPOSED]);

      // Then - signed and committed
      expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
      expect(repo.git("status", "--porcelain")).toBe("");
    });

    test.skipIf(!DISK_SPELLING.isNormalizationInsensitive)(
      "commits a decomposed record named in composed Unicode",
      async () => {
        // Given - a committed draft whose file name is decomposed
        repo.write(DECOMPOSED, draftRecord("Cafe"));
        repo.commitAll("add cafe");

        // When - naming it composed, as typed on most keyboards
        const code = await runIn(["--yes", COMPOSED]);

        // Then - signed and committed
        expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
        expect(repo.git("status", "--porcelain")).toBe("");
      }
    );

    test("commits an uncommitted sign-off on a decomposed record", async () => {
      // Given - a committed draft whose name is decomposed, signed off on disk
      repo.write(DECOMPOSED, draftRecord("Cafe"));
      repo.commitAll("add cafe");
      await runIn(["--yes", "--no-commit", DECOMPOSED]);
      infos.length = 0;

      // When - naming it again, as the disk spells it
      const code = await runIn(["--yes", DECOMPOSED]);

      // Then - the sign-off is committed as it is
      expect({ code, errors }).toStrictEqual({ code: 0, errors: [] });
      expect(infos[0]).toBe(
        `${invocation.prefix} committing ${DECOMPOSED}: already verified, not yet committed`
      );
      expect(repo.git("status", "--porcelain")).toBe("");
    });
  });
});
