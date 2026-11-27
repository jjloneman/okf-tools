import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AGENT_BLOCK } from "./agent-block.ts";
import { run } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { GUIDE, RECORD_RULES, RECORDS_INTRO } from "./guide.ts";
import { formatVerifyUsage, GUIDE_USAGE, OKF_USAGE } from "./options.ts";
import { TAG_RULES } from "./tag-rules.ts";

/** A directory that doesn't exist, since the guide reads nothing. */
const NOWHERE = "/nonexistent/okf-guide";

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Run `okf guide` with the given arguments. */
function runGuide(args: readonly string[]): Promise<number> {
  return run({
    args: ["guide", ...args],
    cwd: NOWHERE,
    isInteractive: false,
    program: "okf",
  });
}

describe("okf guide", () => {
  test("prints the guide as it is, with no prefix, outside any repo", async () => {
    // Given - a directory that isn't a repo, or anything

    // When - asking for the guide
    const code = await runGuide([]);

    // Then - the whole guide, unprefixed, and nothing else
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos).toStrictEqual([GUIDE]);
    expect(errors).toStrictEqual([]);
  });

  test("prints its usage for --help", async () => {
    // When - asking for help
    const code = await runGuide(["--help"]);

    // Then - the usage, prefixed like any other line
    expect(code).toBe(EXIT_CODES.ok);
    expect(infos.join("\n")).toBe(
      GUIDE_USAGE.replaceAll(/^/gmu, "[okf] ").replaceAll(/ $/gmu, "")
    );
  });

  test("fails with its usage when given an argument", async () => {
    // When - passing a path it doesn't take
    const code = await runGuide(["docs"]);

    // Then - why, then the usage, on stderr
    expect(code).toBe(EXIT_CODES.failure);
    expect(infos).toStrictEqual([]);
    expect(errors.join("\n")).toContain(
      "[okf] okf guide takes no arguments, but was given docs."
    );
    expect(errors.join("\n")).toContain("[okf] usage: okf guide");
  });
});

describe("GUIDE", () => {
  test("holds the same intro and rules as the agent block", () => {
    // Given/When/Then - one source, so the two can't drift
    expect(GUIDE).toContain(`${RECORDS_INTRO}\n`);
    expect(GUIDE).toContain(`${RECORD_RULES}\n`);
    expect(AGENT_BLOCK).toContain(`${RECORDS_INTRO}\n`);
    expect(AGENT_BLOCK).toContain(`${RECORD_RULES}\n`);
    expect(AGENT_BLOCK).toContain("Run `okf guide`");
  });

  test("holds the tag rules the record skill quotes", () => {
    // Given - the guide's record rules
    const rules = RECORD_RULES;

    // When/Then - they end with the shared tag rules
    expect(rules.endsWith(TAG_RULES)).toBe(true);
    expect(GUIDE).toContain(TAG_RULES);
  });

  test("skips the re-stamp for a sources reorder alone, as for tags", () => {
    // Given - the guide's re-stamp rule and its okf touch line
    const exception = "only its `tags`, the order of its `sources`, or both";

    // When/Then - both name the two edits that keep generated
    expect(RECORD_RULES).toContain(`changes ${exception}, re-stamp it`);
    expect(RECORD_RULES).toContain("A reorder of `sources` keeps");
    expect(TAG_RULES).toContain("apart from a reorder of `sources`");
    expect(GUIDE).toContain(`one that changes ${exception}, in the same`);
  });

  test("prints the rules the README's Agents section shows", () => {
    // Given - the README's Agents section
    const readme = readFileSync(
      new URL("../README.md", import.meta.url),
      "utf8"
    );

    const agents = readme.slice(
      readme.indexOf("## 🧭 Agents"),
      readme.indexOf("## 🏷️ Writing tags")
    );

    // When/Then - the guide's rules are the ones it quotes
    expect(agents).toContain(RECORD_RULES);
  });

  test("names every command okf --help lists", () => {
    // Given - the commands in okf's usage
    const commands = [
      ...OKF_USAGE.matchAll(/^ {2}(?<name>[a-z][a-z0-9-]*) /gmu),
    ].map((match) => match.groups?.name);

    // When/Then - each has a line saying when an agent may run it
    expect(commands.length).toBeGreaterThan(0);

    for (const command of commands) {
      expect(GUIDE).toContain(`- **\`okf ${command ?? ""}`);
    }
  });

  test("is where the verify usage sends an agent", () => {
    // Given/When/Then - the help points at the guide, not a copy of it
    expect(formatVerifyUsage("okf verify")).toContain("`okf guide`");
  });
});
