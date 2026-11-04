import path from "node:path";

import type { CliOptions } from "./options.ts";

import { describeError } from "./output.ts";

/** The `okf` block of a consumer's `package.json`. */
export type OkfConfig = {
  /**
   * Bundle directories, relative to the repo root.
   *
   * @example `["docs/decisions", "docs/references"]`
   */
  bundles: readonly string[] | undefined;

  /**
   * The OKF actor a `verified` entry is recorded as.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string | undefined;
};

/** The `okf` block, or why it can't be read. */
export type OkfConfigResult =
  | {
      /**
       * The block was read; any missing key is `undefined`.
       *
       * @example `{ bundles: ["docs/decisions"], verifiedBy: "human:jjloneman" }`
       */
      config: OkfConfig;

      /**
       * Whether the block could be read; `true` here.
       *
       * @example true
       */
      isOk: true;
    }
  | {
      /**
       * Whether the block could be read; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not.
       *
       * @example "`okf.bundles` in package.json must be a list of directories."
       */
      reason: string;
    };

/** Where the bundles are and who signs, merged from the flags and config. */
export type Settings = {
  /**
   * Absolute bundle directories, not yet checked to exist.
   *
   * @example `["/repo/docs/decisions"]`
   */
  bundleDirs: readonly string[];

  /**
   * The OKF actor a `verified` entry is recorded as.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
};

/** Merged settings, or why the run can't have any. */
export type SettingsResult =
  | {
      /**
       * Whether settings could be resolved; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not.
       *
       * @example "No bundles: pass --bundle <dir>, or set `okf.bundles` in package.json."
       */
      reason: string;
    }
  | {
      /**
       * Whether settings could be resolved; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The settings.
       *
       * @example `{ bundleDirs: ["/repo/docs/decisions"], verifiedBy: "human:jjloneman" }`
       */
      settings: Settings;
    };

/**
 * An OKF actor the frontmatter can hold unquoted in the inline
 * `{ by: …, at: … }` entry, and that YAML reads back as a string.
 *
 * - It has a kind or a producer: a `:` (`human:jjloneman`) or a `/`
 *   (`claude-code/2.1.316`) somewhere after the first character.
 *
 * - It starts with a letter, so YAML can't read it as a number, a date, a
 *   sexagesimal like `12:30`, or an indicator (`*`, `&`, `!`, `@`, …).
 *
 * - No whitespace, quotes, comment marker, or flow indicators anywhere, and no
 *   trailing `:`, which would read as a key.
 */
const ACTOR = /^\p{Letter}(?=[^:/]*[:/])[^\s"#'(),[\]{}]*(?<!:)$/u;

/**
 * Read the `okf` block from the text of a `package.json`.
 *
 * - No text (no `package.json`) or no block reads as an empty config, so flags
 *   alone can configure a run.
 */
export function readOkfConfig(
  packageJsonText: string | undefined
): OkfConfigResult {
  const empty = { bundles: undefined, verifiedBy: undefined };

  if (packageJsonText === undefined) {
    return { config: empty, isOk: true };
  }

  let manifest: unknown;

  try {
    manifest = JSON.parse(packageJsonText);
  } catch (error) {
    return {
      isOk: false,
      reason: `package.json isn't valid JSON: ${describeError(error)}`,
    };
  }

  const block = isPlainObject(manifest) ? manifest.okf : undefined;

  if (block === undefined) {
    return { config: empty, isOk: true };
  }

  if (!isPlainObject(block)) {
    return { isOk: false, reason: "`okf` in package.json must be an object." };
  }

  const { bundles, verifiedBy } = block;

  if (bundles !== undefined && !isStringList(bundles)) {
    return {
      isOk: false,
      reason: "`okf.bundles` in package.json must be a list of directories.",
    };
  }

  if (verifiedBy !== undefined && typeof verifiedBy !== "string") {
    return {
      isOk: false,
      reason: "`okf.verifiedBy` in package.json must be a string.",
    };
  }

  return { config: { bundles, verifiedBy }, isOk: true };
}

/**
 * Merge the flags over the config.
 *
 * - `--bundle` replaces `okf.bundles` rather than adding to it, and is
 *   relative to where the command was run; config bundles are relative to the
 *   repo root.
 *
 * - There's no default bundle and no default actor: a run names both.
 */
export function resolveSettings(params: {
  config: OkfConfig;
  cwd: string;
  options: Pick<CliOptions, "bundles" | "by">;
  repoRoot: string;
}): SettingsResult {
  const { config, cwd, options, repoRoot } = params;

  const bundleDirs =
    options.bundles.length > 0
      ? options.bundles.map((dir) => path.resolve(cwd, dir))
      : (config.bundles ?? []).map((dir) => path.resolve(repoRoot, dir));

  if (bundleDirs.length === 0) {
    return {
      isOk: false,
      reason:
        "No bundles: pass --bundle <dir>, or set `okf.bundles` in package.json.",
    };
  }

  const verifiedBy = options.by ?? config.verifiedBy;

  if (verifiedBy === undefined) {
    return {
      isOk: false,
      reason:
        "No one to sign as: pass --by <actor>, or set `okf.verifiedBy` in package.json.",
    };
  }

  if (!ACTOR.test(verifiedBy)) {
    return {
      isOk: false,
      reason: `"${verifiedBy}" isn't an actor a record can hold, such as human:jjloneman.`,
    };
  }

  return { isOk: true, settings: { bundleDirs, verifiedBy } };
}

/** Whether a parsed JSON value is an object, not an array or `null`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a parsed JSON value is a list of non-empty strings. */
function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item !== "")
  );
}
