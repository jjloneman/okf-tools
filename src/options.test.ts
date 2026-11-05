import { describe, expect, test } from "vitest";

import { parseCliArgs } from "./options.ts";

const DEFAULTS = {
  bundles: [],
  by: undefined,
  isChanged: false,
  isYes: false,
  recordPaths: [],
  shouldCommit: true,
};

describe("parseCliArgs", () => {
  test.each([
    { args: [], description: "no arguments", options: {} },
    {
      args: [
        "--bundle",
        "a",
        "--bundle",
        "b",
        "--by",
        "human:x",
        "--no-commit",
      ],
      description: "every interactive flag",
      options: { bundles: ["a", "b"], by: "human:x", shouldCommit: false },
    },
    {
      args: ["-y", "--changed"],
      description: "--yes with --changed",
      options: { isChanged: true, isYes: true },
    },
    {
      args: ["--yes", "docs/a.md", "docs/b.md"],
      description: "--yes with record paths",
      options: { isYes: true, recordPaths: ["docs/a.md", "docs/b.md"] },
    },
  ])("reads $description", ({ args, options }) => {
    // When - parsing the arguments
    const parsed = parseCliArgs(args);

    // Then - the options, with every other flag at its default
    expect(parsed).toStrictEqual({
      kind: "options",
      options: { ...DEFAULTS, ...options },
    });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "--yes"], description: "-h alongside other flags" },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseCliArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["--nope"],
      description: "an unknown flag",
      message: expect.stringContaining("--nope") as unknown,
    },
    {
      args: ["--yes"],
      description: "--yes with no selection",
      message: "--yes needs --changed or at least one record path.",
    },
    {
      args: ["--yes", "--changed", "docs/a.md"],
      description: "--changed with record paths",
      message: "Pass --changed or record paths, not both.",
    },
    {
      args: ["--changed"],
      description: "--changed without --yes",
      message:
        "--changed and record paths need --yes; without it, records are picked in the prompts.",
    },
    {
      args: ["docs/a.md"],
      description: "a record path without --yes",
      message:
        "--changed and record paths need --yes; without it, records are picked in the prompts.",
    },
  ])("rejects $description", ({ args, message }) => {
    // When/Then - a usage error saying why
    expect(parseCliArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});
