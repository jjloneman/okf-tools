import { describe, expect, test } from "vitest";

import {
  parseCliArgs,
  parseCommand,
  parseDiffArgs,
  parseGuideArgs,
  parseIndexArgs,
  parseInitArgs,
  parseNewArgs,
  parseStatusArgs,
  parseTagsArgs,
  parseTouchArgs,
} from "./options.ts";

const STATUS_DEFAULTS = {
  bundles: [],
  by: undefined,
  filters: [],
  format: "text",
  recordPaths: [],
};

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
      args: ["init", "--check"],
      description: "init, with the arguments after it",
      expected: { args: ["--check"], kind: "init" },
    },
    {
      args: ["new", "docs/decisions/a.md"],
      description: "new, with the arguments after it",
      expected: { args: ["docs/decisions/a.md"], kind: "new" },
    },
    {
      args: ["touch", "docs/decisions/a.md"],
      description: "touch, with the arguments after it",
      expected: { args: ["docs/decisions/a.md"], kind: "touch" },
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
    {
      args: ["status", "--draft"],
      description: "status, with the arguments after it",
      expected: { args: ["--draft"], kind: "status" },
    },
    {
      args: ["guide"],
      description: "guide, with no arguments",
      expected: { args: [], kind: "guide" },
    },
    {
      args: ["index", "--check"],
      description: "index, with the arguments after it",
      expected: { args: ["--check"], kind: "index" },
    },
    {
      args: ["tags", "--format", "json"],
      description: "tags, with the arguments after it",
      expected: { args: ["--format", "json"], kind: "tags" },
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

describe("parseGuideArgs", () => {
  test.each([
    { args: [], description: "no arguments", expected: { kind: "guide" } },
    { args: ["--help"], description: "--help", expected: { kind: "help" } },
    {
      args: ["-h", "--bogus"],
      description: "-h beside an unknown flag",
      expected: { kind: "help" },
    },
    {
      args: ["--bogus"],
      description: "an unknown flag",
      expected: {
        kind: "invalid",
        message: expect.stringContaining("--bogus") as unknown as string,
      },
    },
    {
      args: ["verify"],
      description: "a positional argument",
      expected: {
        kind: "invalid",
        message: "okf guide takes no arguments, but was given verify.",
      },
    },
  ])("reads $description", ({ args, expected }) => {
    // Given/When/Then - the guide, help, or why the arguments can't run
    expect(parseGuideArgs(args)).toStrictEqual(expected);
  });
});

describe("parseInitArgs", () => {
  const INIT_DEFAULTS = {
    bundles: [],
    by: undefined,
    isCheck: false,
    shouldWriteCopilot: false,
  };

  test.each([
    { args: [], description: "no arguments", options: {} },
    {
      args: ["--bundle", "a", "--bundle", "b", "--by", "human:x", "--copilot"],
      description: "every writing flag",
      options: { bundles: ["a", "b"], by: "human:x", shouldWriteCopilot: true },
    },
    {
      args: ["--check", "--copilot"],
      description: "--check with --copilot",
      options: { isCheck: true, shouldWriteCopilot: true },
    },
  ])("reads $description", ({ args, options }) => {
    // When - parsing the arguments
    const parsed = parseInitArgs(args);

    // Then - the options, with every other flag at its default
    expect(parsed).toStrictEqual({
      kind: "options",
      options: { ...INIT_DEFAULTS, ...options },
    });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "--check"], description: "-h beside another flag" },
    { args: ["--bogus", "-h"], description: "-h beside an unknown flag" },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseInitArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["--bogus"],
      description: "an unknown flag",
      message: /Unknown option '--bogus'/u,
    },
    {
      args: ["AGENTS.md"],
      description: "a path",
      message: /^okf init takes no paths, but was given AGENTS\.md\.$/u,
    },
    {
      args: ["--bundle", ""],
      description: "an empty --bundle",
      message: /^--bundle needs a directory, not an empty string\.$/u,
    },
    {
      args: ["--check", "--bundle", "docs"],
      description: "--check with --bundle",
      message: /^--check writes nothing, so it takes no --bundle or --by\.$/u,
    },
    {
      args: ["--check", "--by", "human:x"],
      description: "--check with --by",
      message: /^--check writes nothing, so it takes no --bundle or --by\.$/u,
    },
  ])("refuses $description", ({ args, message }) => {
    // When - parsing the arguments
    const parsed = parseInitArgs(args);

    // Then - a usage error that says why
    expect(parsed).toStrictEqual({
      kind: "invalid",
      message: expect.stringMatching(message) as unknown,
    });
  });
});

describe("parseStatusArgs", () => {
  test.each([
    { args: [], description: "no arguments", options: {} },
    {
      args: ["--bundle", "a", "--bundle", "b", "--by", "human:x"],
      description: "bundles and a signer",
      options: { bundles: ["a", "b"], by: "human:x" },
    },
    {
      args: ["--stale", "--draft", "--changed"],
      description: "every filter, in any order",
      options: { filters: ["changed", "draft", "stale"] },
    },
    {
      args: ["--format", "json", "docs/a.md", "docs/b.md"],
      description: "--format json with record paths",
      options: { format: "json", recordPaths: ["docs/a.md", "docs/b.md"] },
    },
    {
      args: ["--format", "text"],
      description: "--format text",
      options: { format: "text" },
    },
  ])("reads $description", ({ args, options }) => {
    // When - parsing the arguments
    const parsed = parseStatusArgs(args);

    // Then - the options, with every other flag at its default
    expect(parsed).toStrictEqual({
      kind: "options",
      options: { ...STATUS_DEFAULTS, ...options },
    });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "--draft"], description: "-h alongside other flags" },
    {
      args: ["--help", "--yes"],
      description: "--help beside a flag status doesn't take",
    },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseStatusArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["--yes"],
      description: "a verify flag",
      message: expect.stringContaining("--yes") as unknown,
    },
    {
      args: ["--format"],
      description: "--format with no value",
      message: expect.stringContaining("--format") as unknown,
    },
    {
      args: ["--format", "yaml"],
      description: "a format it doesn't print",
      message: '--format takes json or text, not "yaml".',
    },
    {
      args: ["--bundle", ""],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
    },
  ])("rejects $description", ({ args, message }) => {
    // When/Then - a usage error saying why
    expect(parseStatusArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});

describe("parseIndexArgs", () => {
  test.each([
    {
      args: [],
      description: "no arguments",
      options: { bundles: [], isCheck: false },
    },
    {
      args: ["--bundle", "a", "--bundle", "b", "--check"],
      description: "bundles and --check",
      options: { bundles: ["a", "b"], isCheck: true },
    },
  ])("reads $description", ({ args, options }) => {
    // When/Then - the options
    expect(parseIndexArgs(args)).toStrictEqual({ kind: "options", options });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "--check"], description: "-h alongside other flags" },
    {
      args: ["--help", "--yes"],
      description: "--help beside a flag index doesn't take",
    },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseIndexArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["--yes"],
      description: "a flag it doesn't take",
      message: expect.stringContaining("--yes") as unknown,
    },
    {
      args: ["--bundle"],
      description: "--bundle with no value",
      message: expect.stringContaining("--bundle") as unknown,
    },
    {
      args: ["docs/decisions/index.md"],
      description: "a path",
      message:
        "okf index takes no paths, but was given docs/decisions/index.md.",
    },
    {
      args: ["--bundle", ""],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
    },
  ])("rejects $description", ({ args, message }) => {
    // When/Then - a usage error saying why
    expect(parseIndexArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});

describe("parseTagsArgs", () => {
  test.each([
    {
      args: [],
      description: "no arguments",
      options: { bundles: [], format: "text" },
    },
    {
      args: ["--bundle", "a", "--format", "json"],
      description: "a bundle and --format json",
      options: { bundles: ["a"], format: "json" },
    },
  ])("reads $description", ({ args, options }) => {
    // When/Then - the options
    expect(parseTagsArgs(args)).toStrictEqual({ kind: "options", options });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    {
      args: ["-h", "--format", "json"],
      description: "-h alongside other flags",
    },
    {
      args: ["--help", "--check"],
      description: "--help beside a flag tags doesn't take",
    },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseTagsArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["--check"],
      description: "a flag it doesn't take",
      message: expect.stringContaining("--check") as unknown,
    },
    {
      args: ["--format"],
      description: "--format with no value",
      message: expect.stringContaining("--format") as unknown,
    },
    {
      args: ["--format", "yaml"],
      description: "a format it doesn't print",
      message: '--format takes json or text, not "yaml".',
    },
    {
      args: ["cli"],
      description: "a path",
      message: "okf tags takes no paths, but was given cli.",
    },
    {
      args: ["--bundle", ""],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
    },
  ])("rejects $description", ({ args, message }) => {
    // When/Then - a usage error saying why
    expect(parseTagsArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});

describe("parseNewArgs", () => {
  /** The flags every `okf new` run needs. */
  const REQUIRED = ["--type", "Decision", "--by", "claude-code/2.2.0"];

  test.each([
    {
      args: ["docs/decisions/a.md", ...REQUIRED],
      description: "only the record and the required flags",
      options: {
        bundles: [],
        by: "claude-code/2.2.0",
        description: undefined,
        recordPath: "docs/decisions/a.md",
        tags: [],
        title: undefined,
        type: "Decision",
      },
    },
    {
      args: [
        ...REQUIRED,
        "docs/decisions/a.md",
        "--title",
        "A title",
        "--description",
        "One sentence.",
        "--tag",
        "cli",
        "--tag",
        "api",
        "--tag",
        "cli",
        "--bundle",
        "docs/decisions",
      ],
      description: "every flag, with tags sorted and each once",
      options: {
        bundles: ["docs/decisions"],
        by: "claude-code/2.2.0",
        description: "One sentence.",
        recordPath: "docs/decisions/a.md",
        tags: ["api", "cli"],
        title: "A title",
        type: "Decision",
      },
    },
  ])("reads $description", ({ args, options }) => {
    // When/Then - the options
    expect(parseNewArgs(args)).toStrictEqual({ kind: "options", options });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "a.md"], description: "-h beside a record" },
    {
      args: ["--help", "--yes"],
      description: "--help beside a flag new doesn't take",
    },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseNewArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["a.md", ...REQUIRED, "--yes"],
      description: "a flag it doesn't take",
      message: expect.stringContaining("--yes") as unknown,
    },
    {
      args: ["a.md", "--type"],
      description: "--type with no value",
      message: expect.stringContaining("--type") as unknown,
    },
    {
      args: REQUIRED,
      description: "no record",
      message: "Name exactly one record to write.",
    },
    {
      args: ["a.md", "b.md", ...REQUIRED],
      description: "two records",
      message: "Name exactly one record to write.",
    },
    {
      args: ["a.md", "--by", "claude-code/2.2.0"],
      description: "no --type",
      message: "okf new needs --type and --by.",
    },
    {
      args: ["a.md", "--type", "Decision"],
      description: "no --by",
      message: "okf new needs --type and --by.",
    },
    {
      args: ["a.md", ...REQUIRED, "--bundle", ""],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
    },
    {
      args: ["a.md", "--type", " ", "--by", "claude-code/2.2.0"],
      description: "a blank --type",
      message: "--type needs a value, not an empty string.",
    },
    {
      args: ["a.md", ...REQUIRED, "--title", ""],
      description: "an empty --title",
      message: "--title needs a value, not an empty string.",
    },
    {
      args: ["a.md", ...REQUIRED, "--description", "One.\nTwo."],
      description: "a --description of two lines",
      message: "--description must be one line.",
    },
    {
      args: ["a.md", ...REQUIRED, "--tag", "a\rb"],
      description: "a --tag holding a carriage return",
      message: '--tag "a\\rb" can\'t hold whitespace or a backtick.',
    },
    {
      args: ["a.md", ...REQUIRED, "--tag", "cli", "--tag", "two words"],
      description: "a --tag holding a space",
      message: '--tag "two words" can\'t hold whitespace or a backtick.',
    },
    {
      args: ["a.md", ...REQUIRED, "--tag", "a\tb"],
      description: "a --tag holding a tab",
      message: '--tag "a\\tb" can\'t hold whitespace or a backtick.',
    },
    {
      args: ["a.md", ...REQUIRED, "--tag", "a`b"],
      description: "a --tag holding a backtick",
      message: '--tag "a`b" can\'t hold whitespace or a backtick.',
    },
    {
      args: ["a.md", ...REQUIRED, "--tag", ""],
      description: "an empty --tag",
      message: "--tag needs a value, not an empty string.",
    },
    {
      args: ["a.md", "--type", "Decision", "--by", "a\nb"],
      description: "a --by of two lines",
      message: "--by must be one line.",
    },
  ])("rejects $description", ({ args, message }) => {
    // When/Then - a usage error saying why
    expect(parseNewArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});

describe("parseTouchArgs", () => {
  test.each([
    {
      args: ["a.md", "--by", "claude-code/2.2.0"],
      description: "one record",
      options: {
        bundles: [],
        by: "claude-code/2.2.0",
        recordPaths: ["a.md"],
        shouldDraft: false,
      },
    },
    {
      args: [
        "a.md",
        "b.md",
        "--by",
        "claude-code/2.2.0",
        "--draft",
        "--bundle",
        "docs",
      ],
      description: "two records, --draft, and a bundle",
      options: {
        bundles: ["docs"],
        by: "claude-code/2.2.0",
        recordPaths: ["a.md", "b.md"],
        shouldDraft: true,
      },
    },
  ])("reads $description", ({ args, options }) => {
    // When/Then - the options
    expect(parseTouchArgs(args)).toStrictEqual({ kind: "options", options });
  });

  test.each([
    { args: ["--help"], description: "--help" },
    { args: ["-h", "a.md"], description: "-h beside a record" },
    {
      args: ["--help", "--yes"],
      description: "--help beside a flag touch doesn't take",
    },
  ])("asks for help with $description", ({ args }) => {
    // When/Then - help, whatever else was passed
    expect(parseTouchArgs(args)).toStrictEqual({ kind: "help" });
  });

  test.each([
    {
      args: ["a.md", "--by", "claude-code/2.2.0", "--yes"],
      description: "a flag it doesn't take",
      message: expect.stringContaining("--yes") as unknown,
    },
    {
      args: ["a.md", "--by"],
      description: "--by with no value",
      message: expect.stringContaining("--by") as unknown,
    },
    {
      args: ["--by", "claude-code/2.2.0"],
      description: "no record",
      message: "Name at least one record.",
    },
    {
      args: ["a.md"],
      description: "no --by",
      message: "okf touch needs --by.",
    },
    {
      args: ["a.md", "--by", "claude-code/2.2.0", "--bundle", ""],
      description: "an empty --bundle",
      message: "--bundle needs a directory, not an empty string.",
    },
  ])("rejects $description", ({ args, message }) => {
    // When/Then - a usage error saying why
    expect(parseTouchArgs(args)).toStrictEqual({ kind: "invalid", message });
  });
});
