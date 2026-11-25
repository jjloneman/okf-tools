import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  draftRecord,
  useTestRepo,
  VERIFIED_BY,
  verifiedRecord,
} from "#test/repo";

import { run } from "./cli.ts";

const { repo } = useTestRepo();

let errors: string[];
let infos: string[];

beforeEach(() => {
  errors = [];
  infos = [];
  vi.spyOn(console, "error").mockImplementation((line: string) =>
    errors.push(line)
  );
  vi.spyOn(console, "log").mockImplementation((line: string) =>
    infos.push(line)
  );

  repo.write(
    "package.json",
    JSON.stringify({
      okf: { bundles: ["docs/decisions"], verifiedBy: VERIFIED_BY },
    })
  );
  repo.write("docs/decisions/a.md", draftRecord("A"));
  repo.commitAll("draft a");
});

/** Run `okf diff` from the repo root, or a directory in it. */
function runDiffIn(args: string[], directory = "."): Promise<number> {
  return run({
    args: ["diff", ...args],
    cwd: path.join(repo.root, directory),
    isInteractive: false,
    program: "okf",
  });
}

/** Sign a off in a commit, and return its short hash. */
function signA(): string {
  repo.write(
    "docs/decisions/a.md",
    verifiedRecord({ by: VERIFIED_BY, title: "A" })
  );
  repo.commitAll("sign a");

  return repo.git("rev-parse", "--short", "HEAD").trim();
}

describe("okf diff", () => {
  test("prints each record's changes since its sign-off, prefixed", async () => {
    // Given - a signed, then edited, and a draft never signed
    const signOff = signA();
    repo.write(
      "docs/decisions/a.md",
      verifiedRecord({ by: VERIFIED_BY, title: "A" }).replace(
        "Body text.",
        "Edited."
      )
    );
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - diffing both from the bundle
    const code = await runDiffIn(["a.md", "b.md"], "docs/decisions");

    // Then - a's diff, then b whole, every line under okf's prefix
    expect(code).toBe(0);
    expect(errors).toStrictEqual([]);
    expect(infos[0]).toContain(
      `[okf] docs/decisions/a.md: changes since ${VERIFIED_BY}'s sign-off in ${signOff}\n[okf]\n[okf] diff --git`
    );
    expect(infos[0]).toContain("[okf] -Body text.\n[okf] +Edited.");
    expect(infos[1]).toContain(
      `[okf] docs/decisions/b.md: never signed off by ${VERIFIED_BY}, so here is the whole record\n[okf]\n[okf] ---\n[okf] type: Decision`
    );
  });

  test("prints only the heading for a record unchanged since its sign-off", async () => {
    // Given - a signed record
    const signOff = signA();

    // When - diffing it
    const code = await runDiffIn(["docs/decisions/a.md"]);

    // Then - one line
    expect(code).toBe(0);
    expect(infos).toStrictEqual([
      `[okf] docs/decisions/a.md: unchanged since ${VERIFIED_BY}'s sign-off in ${signOff}`,
    ]);
  });

  test("diffs from another signer's sign-off with --by", async () => {
    // Given - a record signed by the default signer
    signA();

    // When - diffing from someone else's
    const code = await runDiffIn([
      "--by",
      "human:someone",
      "docs/decisions/a.md",
    ]);

    // Then - never signed by them
    expect(code).toBe(0);
    expect(infos[0]).toContain("never signed off by human:someone");
  });

  test("prints its usage for --help", async () => {
    // When - asking for help
    const code = await runDiffIn(["--help"]);

    // Then - the usage on stdout
    expect(code).toBe(0);
    expect(infos.join("\n")).toContain("[okf] usage: okf diff [options]");
  });

  test("lists diff among okf's commands", async () => {
    // When - asking okf for help
    await run({
      args: ["--help"],
      cwd: repo.root,
      isInteractive: false,
      program: "okf",
    });

    // Then - the command listed
    expect(infos.join("\n")).toContain("[okf]   diff    ");
  });

  test.each([
    {
      args: [],
      description: "no record",
      expected: "[okf] Name at least one record.",
    },
    {
      args: ["--yes", "docs/decisions/a.md"],
      description: "an unknown flag",
      expected: expect.stringContaining("--yes") as unknown,
    },
  ])("fails with its usage on $description", async ({ args, expected }) => {
    // When - running so
    const code = await runDiffIn(args);

    // Then - why, then the usage, on stderr
    expect(code).toBe(1);
    expect(errors[0]?.split("\n")[0]).toStrictEqual(expected);
    expect(errors.join("\n")).toContain("[okf] usage: okf diff [options]");
  });

  test.each([
    {
      args: ["--by", "nobody", "docs/decisions/a.md"],
      description: "a signer that isn't an actor",
      expected: /^\[okf\] "nobody" isn't an actor/u,
    },
    {
      args: ["docs/other/a.md"],
      description: "a path outside the bundles",
      expected:
        /^\[okf\] docs\/other\/a\.md isn't a record in docs\/decisions\.$/u,
    },
  ])("fails on $description", async ({ args, expected }) => {
    // When - running so
    const code = await runDiffIn(args);

    // Then - why
    expect(code).toBe(1);
    expect(errors[0]).toMatch(expected);
  });

  test("fails on a record that isn't valid UTF-8, after printing the rest", async () => {
    // Given - a record whose bytes aren't UTF-8, beside a draft
    writeFileSync(
      path.join(repo.root, "docs/decisions/a.md"),
      Buffer.from([0xff, 0xfe])
    );
    repo.write("docs/decisions/b.md", draftRecord("B"));

    // When - diffing both
    const code = await runDiffIn([
      "docs/decisions/a.md",
      "docs/decisions/b.md",
    ]);

    // Then - why, and the draft still printed
    expect(code).toBe(1);
    expect(errors).toStrictEqual([
      "[okf] docs/decisions/a.md can't be read: it isn't valid UTF-8.",
    ]);
    expect(infos[0]).toContain("[okf] docs/decisions/b.md: never signed off");
  });

  test("fails when git can't read the record's history", async () => {
    // Given - a signed record on a branch with no commits
    repo.git("checkout", "--quiet", "--orphan", "empty");
    repo.write(
      "docs/decisions/a.md",
      verifiedRecord({ by: VERIFIED_BY, title: "A" })
    );

    // When - diffing it
    const code = await runDiffIn(["docs/decisions/a.md"]);

    // Then - why
    expect(code).toBe(1);
    expect(errors[0]).toMatch(
      /^\[okf\] Couldn't read the history of docs\/decisions\/a\.md: /u
    );
  });

  test("reports an unexpected error instead of throwing", async () => {
    // Given - a package.json that is a folder, which can't be read
    rmSync(path.join(repo.root, "package.json"));
    mkdirSync(path.join(repo.root, "package.json"));

    // When - diffing
    const code = await runDiffIn(["docs/decisions/a.md"]);

    // Then - the error, as a failure
    expect(code).toBe(1);
    expect(errors[0]).toMatch(/^\[okf\] EISDIR/u);
  });
});
