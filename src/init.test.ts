import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useTestRepo } from "#test/repo";

import { AGENT_BLOCK, BLOCK_END, BLOCK_START } from "./agent-block.ts";
import { run } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";

const { repo } = useTestRepo();

/** The block as `okf init` writes it. */
const BLOCK = `${BLOCK_START}\n${AGENT_BLOCK}\n\n${BLOCK_END}`;

/** A block an older version wrote. */
const STALE_BLOCK = `${BLOCK_START}\n- an old rule\n${BLOCK_END}`;

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
  repo.write("docs/decisions/index.md", "# Decisions\n");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The scratch repo's `package.json`, parsed. */
function readManifest(): unknown {
  return JSON.parse(repo.read("package.json"));
}

/** Run `okf init` from the repo root, or a directory in it. */
function runInit(args: readonly string[], directory = "."): Promise<number> {
  return run({
    args: ["init", ...args],
    cwd: path.join(repo.root, directory),
    isInteractive: false,
    program: "okf",
  });
}

describe("okf init", () => {
  test("writes the config and creates AGENTS.md in a fresh repo", async () => {
    // Given - a repo with a bundle folder and an empty package.json

    // When - initializing it
    const code = await runInit([
      "--bundle",
      "docs/decisions",
      "--by",
      "human:jjloneman",
    ]);

    // Then - the config and the block are written, and nothing else
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(readManifest()).toStrictEqual({
      okf: { bundles: ["docs/decisions"], verifiedBy: "human:jjloneman" },
    });
    expect(repo.read("AGENTS.md")).toBe(`${BLOCK}\n`);
    expect(existsSync(path.join(repo.root, ".github"))).toBe(false);
    expect(infos).toStrictEqual([
      "[okf] Updated package.json.",
      "[okf] Created AGENTS.md.",
    ]);
  });

  test("keeps every other key, the layout, and the file's own rules", async () => {
    // Given - a tab-indented CRLF package.json, and an AGENTS.md of its own
    repo.write(
      "package.json",
      '{\r\n\t"name": "x",\r\n\t"okf": {\r\n\t\t"exclude": ["**/README.md"]\r\n\t},\r\n\t"private": true\r\n}\r\n'
    );
    repo.write("AGENTS.md", "# Agents\n\n- a repo rule\n");

    // When - initializing it
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - the new keys join the block in place, and the rules are kept
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("package.json")).toBe(
      '{\r\n\t"name": "x",\r\n\t"okf": {\r\n\t\t"exclude": ["**/README.md"],\r\n\t\t"bundles": ["docs/decisions"]\r\n\t},\r\n\t"private": true\r\n}\r\n'
    );
    expect(repo.read("AGENTS.md")).toBe(
      `# Agents\n\n- a repo rule\n\n${BLOCK}\n`
    );
  });

  test("keeps a one-line package.json on one line", async () => {
    // Given - a package.json on one line, with no final line break
    repo.write(
      "package.json",
      '{"name":"x\\u00e9","okf": {"bundles": ["docs/decisions"]},"n":1.0}'
    );

    // When - setting the actor
    const code = await runInit(["--by", "human:jjloneman"]);

    // Then - only the okf value changes, compact like the rest
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("package.json")).toBe(
      '{"name":"x\\u00e9","okf": {"bundles":["docs/decisions"],"verifiedBy":"human:jjloneman"},"n":1.0}'
    );
  });

  test("reads --bundle from where it's run, and stores it from the root", async () => {
    // Given - a run from inside docs
    // When - naming the bundle relative to docs
    const code = await runInit(["--bundle", "decisions"], "docs");

    // Then - stored from the repo root
    expect(code).toBe(EXIT_CODES.ok);
    expect(readManifest()).toStrictEqual({
      okf: { bundles: ["docs/decisions"] },
    });
  });

  test("changes nothing on a second run", async () => {
    // Given - a repo already initialized
    await runInit(["--bundle", "docs/decisions", "--by", "human:jjloneman"]);
    const packageJson = repo.read("package.json");
    infos = [];

    // When - running it again with no flags
    const code = await runInit([]);

    // Then - both files are reported current and left as they were
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("package.json")).toBe(packageJson);
    expect(repo.read("AGENTS.md")).toBe(`${BLOCK}\n`);
    expect(infos).toStrictEqual([
      "[okf] package.json's okf config is up to date.",
      "[okf] AGENTS.md's okf block is up to date.",
    ]);
  });

  test("refreshes a stale block in place", async () => {
    // Given - a configured repo whose block an older version wrote
    repo.write(
      "package.json",
      JSON.stringify({
        okf: { bundles: ["docs/decisions"], verifiedBy: "human:x" },
      })
    );
    repo.write("AGENTS.md", `# A\n\n${STALE_BLOCK}\n\n# B\n`);

    // When - running it
    const code = await runInit([]);

    // Then - only the text between the markers changes
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("AGENTS.md")).toBe(`# A\n\n${BLOCK}\n\n# B\n`);
    expect(infos).toStrictEqual([
      "[okf] package.json's okf config is up to date.",
      "[okf] Updated AGENTS.md.",
    ]);
  });

  test("says how to name an actor when none is set", async () => {
    // When - initializing with a bundle alone
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - it works, and says okf verify will need --by
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos[0]).toBe(
      "[okf] No `okf.verifiedBy` set, so okf verify will need --by <actor>; pass --by to okf init to set one."
    );
  });

  test("writes the Copilot file under --copilot, then keeps it current", async () => {
    // Given - a repo initialized with --copilot
    await runInit(["--bundle", "docs/decisions", "--copilot"]);
    expect(repo.read(".github/copilot-instructions.md")).toBe(`${BLOCK}\n`);

    // When - the block goes stale, and init runs without the flag
    repo.write(".github/copilot-instructions.md", `${STALE_BLOCK}\n`);
    infos = [];
    const code = await runInit([]);

    // Then - the file that holds a block is refreshed anyway
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read(".github/copilot-instructions.md")).toBe(`${BLOCK}\n`);
    expect(infos).toContain("[okf] Updated .github/copilot-instructions.md.");
  });

  test("leaves a Copilot file with no block alone without --copilot", async () => {
    // Given - a Copilot file of the repo's own
    repo.write(".github/copilot-instructions.md", "# Copilot\n");

    // When - initializing without --copilot
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - it's untouched
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read(".github/copilot-instructions.md")).toBe("# Copilot\n");
  });

  test.each([
    {
      args: [],
      description: "no bundles anywhere",
      error:
        /^\[okf\] No bundles: pass --bundle <dir>, or set `okf\.bundles` in .*package\.json\.$/u,
    },
    {
      args: ["--bundle", "docs/missing"],
      description: "a bundle that doesn't exist",
      error: /^\[okf\] No bundle directory at .*docs\/missing\.$/u,
    },
    {
      args: ["--bundle", "docs/decisions", "--by", "jj"],
      description: "an actor a record can't hold",
      error: /^\[okf\] "jj" isn't an actor a record can hold/u,
    },
  ])("refuses $description and writes nothing", async ({ args, error }) => {
    // When - initializing with it
    const code = await runInit(args);

    // Then - a refusal, and neither file is touched
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([expect.stringMatching(error)]);
    expect(repo.read("package.json")).toBe("{}\n");
    expect(existsSync(path.join(repo.root, "AGENTS.md"))).toBe(false);
  });

  test.each([
    {
      description: "isn't valid JSON",
      error: /^\[okf\] package\.json isn't valid JSON/u,
      text: "{",
    },
    {
      description: "holds an array",
      error: /^\[okf\] package\.json must hold a JSON object\.$/u,
      text: "[]",
    },
    {
      description: "has a bad okf block",
      error: /^\[okf\] `okf` in package\.json must be an object\.$/u,
      text: '{"okf": 1}',
    },
  ])("refuses a package.json that $description", async ({ error, text }) => {
    // Given - the package.json
    repo.write("package.json", text);

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - a refusal
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([expect.stringMatching(error)]);
    expect(existsSync(path.join(repo.root, "AGENTS.md"))).toBe(false);
  });

  test("refuses a configured actor a record can't hold", async () => {
    // Given - a config whose actor okf verify would reject
    repo.write(
      "package.json",
      JSON.stringify({ okf: { bundles: ["docs/decisions"], verifiedBy: "jj" } })
    );

    // When - initializing with no flags
    const code = await runInit([]);

    // Then - a refusal, and no AGENTS.md
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(/^\[okf\] "jj" isn't an actor a record can hold/u),
    ]);
    expect(existsSync(path.join(repo.root, "AGENTS.md"))).toBe(false);
  });

  test("refuses a repo with no package.json", async () => {
    // Given - no package.json
    rmSync(path.join(repo.root, "package.json"));

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - a refusal that says where to add one
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      `[okf] No package.json at ${repo.root}; okf-tools reads its config from there, so add one first.`,
    ]);
  });

  test("refuses malformed markers and writes nothing", async () => {
    // Given - an AGENTS.md with a start marker and no end
    repo.write("AGENTS.md", `${BLOCK_START}\n`);

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - a refusal, with package.json untouched too
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "[okf] AGENTS.md has an okf:start marker but no okf:end; fix the markers by hand, then run okf init again. Nothing was written.",
    ]);
    expect(repo.read("package.json")).toBe("{}\n");
  });

  test("refuses an AGENTS.md that's a folder", async () => {
    // Given - a folder named AGENTS.md
    mkdirSync(path.join(repo.root, "AGENTS.md"));

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - a refusal
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual(["[okf] AGENTS.md isn't a file."]);
  });

  test("refuses an instruction file linked from outside the repo", async () => {
    // Given - .github linked to a folder outside the repo
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "okf-out-")));
    symlinkSync(outside, path.join(repo.root, ".github"));

    try {
      // When - writing the Copilot file
      const code = await runInit(["--bundle", "docs/decisions", "--copilot"]);

      // Then - a refusal, and nothing written outside
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        `[okf] .github/copilot-instructions.md leads through a symlink to ${outside}, outside the repo; okf init writes only inside it.`,
      ]);
      expect(existsSync(path.join(outside, "copilot-instructions.md"))).toBe(
        false
      );
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  test("refuses an AGENTS.md that's a broken symlink", async () => {
    // Given - AGENTS.md linked to a file that doesn't exist
    symlinkSync(
      path.join(tmpdir(), "okf-missing", "AGENTS.md"),
      path.join(repo.root, "AGENTS.md")
    );

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - a refusal, rather than a write through the link
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(
        /^\[okf\] Couldn't follow AGENTS\.md, a broken symlink or one that can't be read: ENOENT/u
      ),
    ]);
  });

  test("refuses a package.json linked from outside the repo", async () => {
    // Given - package.json linked to a file outside the repo
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "okf-out-")));
    writeFileSync(path.join(outside, "package.json"), "{}\n");
    rmSync(path.join(repo.root, "package.json"));
    symlinkSync(
      path.join(outside, "package.json"),
      path.join(repo.root, "package.json")
    );

    try {
      // When - initializing
      const code = await runInit(["--bundle", "docs/decisions"]);

      // Then - a refusal, and the outside file is untouched
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        `[okf] package.json leads through a symlink to ${outside}/package.json, outside the repo; okf init writes only inside it.`,
      ]);
      expect(readFileSync(path.join(outside, "package.json"), "utf8")).toBe(
        "{}\n"
      );
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  test("writes through a link to a folder in the repo named with dots", async () => {
    // Given - AGENTS.md linked into a folder whose name starts with ..
    repo.write("..shared/AGENTS.md", "# Shared\n");
    symlinkSync(
      path.join(repo.root, "..shared", "AGENTS.md"),
      path.join(repo.root, "AGENTS.md")
    );

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - the linked file gets the block
    expect(code).toBe(EXIT_CODES.ok);
    expect(repo.read("..shared/AGENTS.md")).toBe(`# Shared\n\n${BLOCK}\n`);
  });

  test("refuses --copilot when .github is a file, writing nothing", async () => {
    // Given - a file named .github
    repo.write(".github", "not a folder\n");

    // When - asking for the Copilot file
    const code = await runInit(["--bundle", "docs/decisions", "--copilot"]);

    // Then - a refusal before any write
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      "[okf] .github isn't a folder, so .github/copilot-instructions.md can't be written.",
    ]);
    expect(repo.read("package.json")).toBe("{}\n");
    expect(existsSync(path.join(repo.root, "AGENTS.md"))).toBe(false);
  });

  test("skips a Copilot file it can't read when it isn't asked for", async () => {
    // Given - a folder where the Copilot file would be
    mkdirSync(path.join(repo.root, ".github/copilot-instructions.md"), {
      recursive: true,
    });

    // When - initializing without --copilot
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - AGENTS.md is written, and the folder is left alone
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(repo.read("AGENTS.md")).toBe(`${BLOCK}\n`);
  });

  test("reports an AGENTS.md it can't read", async () => {
    // Given - an AGENTS.md no one may read
    repo.write("AGENTS.md", "# Agents\n");
    chmodSync(path.join(repo.root, "AGENTS.md"), 0o000);

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - the error, and nothing written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([expect.stringMatching(/^\[okf\] EACCES/u)]);
    expect(repo.read("package.json")).toBe("{}\n");
  });

  test("says which files were written when a later write fails", async () => {
    // Given - a stale block in a read-only AGENTS.md
    repo.write("AGENTS.md", `${STALE_BLOCK}\n`);
    chmodSync(path.join(repo.root, "AGENTS.md"), 0o444);

    // When - initializing
    const code = await runInit(["--bundle", "docs/decisions"]);

    // Then - package.json was written first, and the failure says so
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(
        /^\[okf\] Couldn't write AGENTS\.md: .*EACCES.* Written before it: package\.json\.$/u
      ),
    ]);
  });

  test("says nothing was written when the first write fails", async () => {
    // Given - a current config, and a stale block in a read-only AGENTS.md
    repo.write(
      "package.json",
      JSON.stringify({ okf: { bundles: ["docs/decisions"] } })
    );
    repo.write("AGENTS.md", `${STALE_BLOCK}\n`);
    chmodSync(path.join(repo.root, "AGENTS.md"), 0o444);

    // When - initializing
    const code = await runInit([]);

    // Then - the failure says nothing was written
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(/Written before it: nothing\.$/u),
    ]);
  });

  test("refuses to run outside a repo", async () => {
    // Given - a folder in no repo
    const outside = realpathSync(mkdtempSync(path.join(tmpdir(), "okf-out-")));

    try {
      // When - initializing there
      const code = await run({
        args: ["init"],
        cwd: outside,
        isInteractive: false,
        program: "okf",
      });

      // Then - git's reason
      expect(code).toBe(EXIT_CODES.failure);
      expect(errors).toStrictEqual([
        expect.stringMatching(/^\[okf\] Couldn't find the repo root/u),
      ]);
    } finally {
      rmSync(outside, { force: true, recursive: true });
    }
  });

  test("prints its usage for --help", async () => {
    // When - asking for help
    const code = await runInit(["--help"]);

    // Then - the usage, and no error
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos[0]).toMatch(/^\[okf\] usage: okf init \[options\]/u);
  });

  test("prints why and its usage for a usage error", async () => {
    // When - passing an unknown flag
    const code = await runInit(["--yes"]);

    // Then - the reason, then the usage
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors[0]).toMatch(/^\[okf\] Unknown option '--yes'/u);
    expect(errors[0]).toMatch(/\[okf\] usage: okf init \[options\]/u);
  });
});

describe("okf init --check", () => {
  test("passes when every block is current", async () => {
    // Given - an initialized repo, with the Copilot file too
    await runInit(["--bundle", "docs/decisions", "--copilot"]);
    infos = [];

    // When - checking
    const code = await runInit(["--check"]);

    // Then - both blocks are current
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([
      "[okf] AGENTS.md's okf block is up to date.",
      "[okf] .github/copilot-instructions.md's okf block is up to date.",
    ]);
  });

  test.each([
    {
      description: "a missing AGENTS.md",
      error: "[okf] AGENTS.md doesn't exist; run okf init to write it.",
      text: undefined,
    },
    {
      description: "an AGENTS.md with no block",
      error: "[okf] AGENTS.md has no okf block; run okf init to add it.",
      text: "# Agents\n",
    },
    {
      description: "a stale block",
      error:
        "[okf] AGENTS.md has an out-of-date okf block; run okf init to refresh it.",
      text: `${STALE_BLOCK}\n`,
    },
    {
      description: "malformed markers",
      error:
        "[okf] AGENTS.md has an okf:end marker but no okf:start; fix the markers by hand.",
      text: `${BLOCK_END}\n`,
    },
  ])("fails on $description, writing nothing", async ({ error, text }) => {
    // Given - the AGENTS.md
    if (text !== undefined) {
      repo.write("AGENTS.md", text);
    }

    // When - checking
    const code = await runInit(["--check"]);

    // Then - it fails, saying why, and the file is as it was
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([error]);
    expect(
      text === undefined
        ? existsSync(path.join(repo.root, "AGENTS.md"))
        : repo.read("AGENTS.md")
    ).toBe(text ?? false);
  });

  test("fails on a missing Copilot file under --copilot", async () => {
    // Given - a current AGENTS.md alone
    repo.write("AGENTS.md", `${BLOCK}\n`);

    // When - checking with --copilot
    const code = await runInit(["--check", "--copilot"]);

    // Then - AGENTS.md passes, and the missing Copilot file fails
    expect(code).toBe(EXIT_CODES.failure);
    expect(infos).toStrictEqual(["[okf] AGENTS.md's okf block is up to date."]);
    expect(errors).toStrictEqual([
      "[okf] .github/copilot-instructions.md doesn't exist; run okf init to write it.",
    ]);
  });

  test("refuses a target it can't read", async () => {
    // Given - a folder named AGENTS.md
    mkdirSync(path.join(repo.root, "AGENTS.md"));

    // When - checking
    const code = await runInit(["--check"]);

    // Then - a refusal
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual(["[okf] AGENTS.md isn't a file."]);
  });
});
