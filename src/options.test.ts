import { describe, expect, test } from "vitest";

import { parseCliArgs, parseCommand, parseDiffArgs } from "./options.ts";

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
    {
      args: ["--help", "--bogus"],
      description: "--help beside an unknown flag",
    },
    { args: ["--by", "-h"], description: "-h where a flag's value should be" },
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
      args: ["--yes", "--changed", "--bundle", ""],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
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

describe("parseCommand", () => {
  test.each([
    {
      args: ["verify", "--yes", "--changed"],
      description: "verify, with the arguments after it",
      expected: { args: ["--yes", "--changed"], kind: "verify" },
    },
    {
      args: ["diff", "docs/decisions/a.md"],
      description: "diff, with the arguments after it",
      expected: { args: ["docs/decisions/a.md"], kind: "diff" },
    },
    {
      args: ["--help"],
      description: "--help",
      expected: { kind: "help" },
    },
    {
      args: ["-h", "verify"],
      description: "-h before a command",
      expected: { kind: "help" },
    },
    {
      args: [],
      description: "no command",
      expected: { kind: "invalid", message: "Name a command." },
    },
    {
      args: ["sign"],
      description: "an unknown command",
      expected: { kind: "invalid", message: "Unknown command: sign." },
    },
    {
      args: ["--yes", "verify"],
      description: "a flag before the command",
      expected: {
        kind: "invalid",
        message:
          "--yes isn't a command; options follow the command, as in okf <command> --yes.",
      },
    },
  ])("reads $description", ({ args, expected }) => {
    // Given/When/Then - the command and its arguments, or why there's none
    expect(parseCommand(args)).toStrictEqual(expected);
  });
});

describe("parseDiffArgs", () => {
  test.each([
    {
      args: ["docs/decisions/a.md", "docs/decisions/b.md"],
      description: "record paths",
      expected: {
        bundles: [],
        by: undefined,
        recordPaths: ["docs/decisions/a.md", "docs/decisions/b.md"],
      },
    },
    {
      args: ["--bundle", "docs", "--by", "human:someone", "docs/a.md"],
      description: "a bundle and a signer",
      expected: {
        bundles: ["docs"],
        by: "human:someone",
        recordPaths: ["docs/a.md"],
      },
    },
  ])("reads $description", ({ args, expected }) => {
    // Given/When/Then - the options
    expect(parseDiffArgs(args)).toStrictEqual({
      kind: "options",
      options: expected,
    });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "--unknown"], description: "-h beside an unknown flag" },
  ])("asks for help on $description", ({ args }) => {
    // Given/When/Then - help
    expect(parseDiffArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: [],
      description: "no record",
      message: "Name at least one record.",
    },
    {
      args: ["--bundle", "", "docs/a.md"],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
    },
    {
      args: ["--yes", "docs/a.md"],
      description: "a verify flag",
      message: expect.stringContaining("--yes") as unknown,
    },
  ])("rejects $description", ({ args, message }) => {
    // Given/When/Then - a usage error saying why
    expect(parseDiffArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});
