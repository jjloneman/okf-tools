import { describe, expect, test } from "vitest";

import { readOkfConfig, resolveSettings } from "./config.ts";

const EMPTY = {
  bundles: undefined,
  drafts: undefined,
  exclude: undefined,
  style: undefined,
  verifiedBy: undefined,
};
const REPO_ROOT = "/repo";

describe("readOkfConfig", () => {
  test.each([
    { description: "no package.json", text: undefined },
    {
      description: "a package.json without an okf block",
      text: '{"name":"x"}',
    },
    { description: "a package.json that isn't an object", text: "[]" },
  ])("reads $description as an empty config", ({ text }) => {
    // When/Then - nothing configured
    expect(readOkfConfig(text)).toStrictEqual({ config: EMPTY, isOk: true });
  });

  test("reads the bundles, the drafts policy, the exclusions, the style, and the actor", () => {
    // Given - a full okf block
    const okf = {
      bundles: ["docs/decisions"],
      drafts: "block",
      exclude: ["docs/decisions/README.md"],
      style: "block",
      verifiedBy: "human:jjloneman",
    };

    // When/Then - every key
    expect(readOkfConfig(JSON.stringify({ okf }))).toStrictEqual({
      config: okf,
      isOk: true,
    });
  });

  test("accepts an extglob that starts with `!(`", () => {
    // Given - a negated extglob, which picomatch reads as a pattern
    const text = JSON.stringify({ okf: { exclude: ["!(docs)/**"] } });

    // When/Then - read as written
    expect(readOkfConfig(text)).toStrictEqual({
      config: {
        bundles: undefined,
        drafts: undefined,
        exclude: ["!(docs)/**"],
        style: undefined,
        verifiedBy: undefined,
      },
      isOk: true,
    });
  });

  test.each([
    {
      description: "invalid JSON",
      reason: expect.stringMatching(
        /^package\.json isn't valid JSON: /u
      ) as unknown,
      text: "{",
    },
    {
      description: "an okf block that isn't an object",
      reason: "`okf` in package.json must be an object.",
      text: '{"okf":["docs"]}',
    },
    {
      description: "bundles that aren't a list",
      reason: "`okf.bundles` in package.json must be a list of directories.",
      text: '{"okf":{"bundles":"docs"}}',
    },
    {
      description: "a bundle that's an empty string",
      reason: "`okf.bundles` in package.json must be a list of directories.",
      text: '{"okf":{"bundles":[""]}}',
    },
    {
      description: "exclusions that aren't a list",
      reason: "`okf.exclude` in package.json must be a list of globs.",
      text: '{"okf":{"exclude":"docs/drafts"}}',
    },
    {
      description: "an exclusion that's an empty string",
      reason: "`okf.exclude` in package.json must be a list of globs.",
      text: '{"okf":{"exclude":[""]}}',
    },
    ...["!docs/decisions/README.md", "/docs/drafts", "docs/drafts/"].map(
      (glob) => ({
        description: `the gitignore-style exclusion ${glob}`,
        reason: `\`okf.exclude\` glob "${glob}" can't start with \`!\` or \`/\`, or end with \`/\`; globs are relative to the repo root, and a folder's name excludes all of it.`,
        text: JSON.stringify({ okf: { exclude: [glob] } }),
      })
    ),
    ...["Block", "", 1].map((style) => ({
      description: `the style ${JSON.stringify(style)}`,
      reason:
        "`okf.style` in package.json must be one of block, inline, match.",
      text: JSON.stringify({ okf: { style } }),
    })),
    ...["Block", "notice", true].map((drafts) => ({
      description: `the drafts policy ${JSON.stringify(drafts)}`,
      reason: "`okf.drafts` in package.json must be one of allow, block, warn.",
      text: JSON.stringify({ okf: { drafts } }),
    })),
    {
      description: "an actor that isn't a string",
      reason: "`okf.verifiedBy` in package.json must be a string.",
      text: '{"okf":{"verifiedBy":1}}',
    },
  ])("rejects $description", ({ reason, text }) => {
    // When/Then - why it can't be read
    expect(readOkfConfig(text)).toStrictEqual({ isOk: false, reason });
  });
});

describe("resolveSettings", () => {
  const configured = {
    bundles: ["docs/decisions"],
    drafts: undefined,
    exclude: undefined,
    style: undefined,
    verifiedBy: "human:jjloneman",
  };

  test("takes the config's bundles from the repo root", () => {
    // When - resolving with no flags
    const result = resolveSettings({
      config: configured,
      cwd: "/repo/docs",
      options: { bundles: [], by: undefined },
      repoRoot: REPO_ROOT,
    });

    // Then - the config's values, the bundle resolved from the root
    expect(result).toStrictEqual({
      isOk: true,
      settings: {
        bundleDirs: ["/repo/docs/decisions"],
        excludeGlobs: [],
        style: "match",
        verifiedBy: "human:jjloneman",
      },
    });
  });

  test("keeps the config's exclusions", () => {
    // When - resolving a config that excludes a folder
    const result = resolveSettings({
      config: { ...configured, exclude: ["docs/decisions/drafts"] },
      cwd: "/repo/docs",
      options: { bundles: ["references"], by: undefined },
      repoRoot: REPO_ROOT,
    });

    // Then - the exclusions as written, even beside --bundle
    expect(result).toStrictEqual({
      isOk: true,
      settings: {
        bundleDirs: ["/repo/docs/references"],
        excludeGlobs: ["docs/decisions/drafts"],
        style: "match",
        verifiedBy: "human:jjloneman",
      },
    });
  });

  test("takes the config's style", () => {
    // When - resolving a config that names a style
    const result = resolveSettings({
      config: { ...configured, style: "inline" },
      cwd: REPO_ROOT,
      options: { bundles: [], by: undefined },
      repoRoot: REPO_ROOT,
    });

    // Then - that style
    expect(result).toMatchObject({ settings: { style: "inline" } });
  });

  test("lets the flags replace the config, bundles from the cwd", () => {
    // When - resolving with both flags
    const result = resolveSettings({
      config: configured,
      cwd: "/repo/docs",
      options: { bundles: ["references"], by: "claude-code/2.1.316" },
      repoRoot: REPO_ROOT,
    });

    // Then - the flags' values, the bundle resolved from the cwd
    expect(result).toStrictEqual({
      isOk: true,
      settings: {
        bundleDirs: ["/repo/docs/references"],
        excludeGlobs: [],
        style: "match",
        verifiedBy: "claude-code/2.1.316",
      },
    });
  });

  test.each([
    {
      by: "human:jjloneman",
      config: EMPTY,
      description: "no bundles anywhere",
      reason:
        "No bundles: pass --bundle <dir>, or set `okf.bundles` in /repo/package.json.",
    },
    {
      by: undefined,
      config: {
        bundles: ["docs"],
        drafts: undefined,
        exclude: undefined,
        style: undefined,
        verifiedBy: undefined,
      },
      description: "no actor anywhere",
      reason:
        "No one to sign as: pass --by <actor>, or set `okf.verifiedBy` in /repo/package.json.",
    },
    {
      by: "human:jj loneman",
      config: {
        bundles: ["docs"],
        drafts: undefined,
        exclude: undefined,
        style: undefined,
        verifiedBy: undefined,
      },
      description: "an actor YAML can't hold unquoted",
      reason:
        '"human:jj loneman" isn\'t an actor a record can hold, such as human:jjloneman.',
    },
    ...[
      "*bot",
      "&anchor",
      "!tag",
      "@at",
      "human:",
      "-dash",
      "true",
      "null",
      "123",
      "2026-01-01",
      "12:30",
    ].map((by) => ({
      by,
      config: {
        bundles: ["docs"],
        drafts: undefined,
        exclude: undefined,
        style: undefined,
        verifiedBy: undefined,
      },
      description: `the YAML-special actor ${by}`,
      reason: `"${by}" isn't an actor a record can hold, such as human:jjloneman.`,
    })),
  ])("rejects $description", ({ by, config, reason }) => {
    // When/Then - why there are no settings
    expect(
      resolveSettings({
        config,
        cwd: REPO_ROOT,
        options: { bundles: [], by },
        repoRoot: REPO_ROOT,
      })
    ).toStrictEqual({ isOk: false, reason });
  });
});
