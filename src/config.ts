import path from "node:path";

import type { EntryStyle } from "./frontmatter/types.ts";
import type { CliOptions } from "./options.ts";

import { ENTRY_STYLE_NAMES, isEntryStyle } from "./frontmatter/shared.ts";
import { ENTRY_STYLES } from "./frontmatter/types.ts";
import { describeError } from "./output.ts";

/**
 * How `okf check` reports a draft record: not at all, as a warning, or as an
 * error; unset, it's a notice.
 */
export type DraftPolicy = (typeof DRAFT_POLICIES)[number];

/** The `okf` block of a consumer's `package.json`. */
export type OkfConfig = {
  /**
   * Bundle directories, relative to the repo root.
   *
   * @example `["docs/decisions", "docs/references"]`
   */
  bundles: readonly string[] | undefined;

  /**
   * How `okf check` reports a draft record; a notice when unset.
   *
   * @example "block"
   */
  drafts: DraftPolicy | undefined;

  /**
   * Globs, relative to the repo root, of files and folders in the bundles
   * that hold no records.
   *
   * @example `["docs/decisions/README.md", "docs/drafts"]`
   */
  exclude: readonly string[] | undefined;

  /**
   * How a new `verified` entry is laid out.
   *
   * @example "block"
   */
  style: EntryStyle | undefined;

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
   * Globs, relative to the repo root, of files and folders in the bundles
   * that hold no records.
   *
   * @example `["docs/decisions/README.md", "docs/drafts"]`
   */
  excludeGlobs: readonly string[];

  /**
   * How a new `verified` entry is laid out; `match` unless configured.
   *
   * @example "match"
   */
  style: EntryStyle;

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
       * @example "No bundles: pass --bundle <dir>, or set `okf.bundles` in /repo/package.json."
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

/** The values `okf.drafts` takes. */
export const DRAFT_POLICIES = ["allow", "block", "warn"] as const;

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

/** Say why a value can't be a `verified` entry's actor. */
export function describeBadActor(value: string): string {
  return `"${value}" isn't an actor a record can hold, such as human:jjloneman.`;
}

/** Say that no bundles are configured, and how to name one. */
export function describeNoBundles(packageJsonPath: string): string {
  return `No bundles: pass --bundle <dir>, or set \`okf.bundles\` in ${packageJsonPath}.`;
}

/** Whether a value is an actor a `verified` entry can name (see `ACTOR`). */
export function isActor(value: string): boolean {
  return ACTOR.test(value);
}

/** Whether a parsed JSON value is an object, not an array or `null`. */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the `okf` block from the text of a `package.json`.
 *
 * - No text (no `package.json`) or no block reads as an empty config, so flags
 *   alone can configure a run.
 */
export function readOkfConfig(
  packageJsonText: string | undefined
): OkfConfigResult {
  const empty = {
    bundles: undefined,
    drafts: undefined,
    exclude: undefined,
    style: undefined,
    verifiedBy: undefined,
  };

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

  const { bundles, drafts, exclude, style, verifiedBy } = block;

  if (bundles !== undefined && !isStringList(bundles)) {
    return {
      isOk: false,
      reason: "`okf.bundles` in package.json must be a list of directories.",
    };
  }

  if (exclude !== undefined && !isStringList(exclude)) {
    return {
      isOk: false,
      reason: "`okf.exclude` in package.json must be a list of globs.",
    };
  }

  // A gitignore habit would otherwise match nothing, or, for `!`, everything.
  const unmatchable = exclude?.find((glob) => /^(?:![^(]|\/)|\/$/u.test(glob));

  if (unmatchable !== undefined) {
    return {
      isOk: false,
      reason: `\`okf.exclude\` glob "${unmatchable}" can't start with \`!\` or \`/\`, or end with \`/\`; globs are relative to the repo root, and a folder's name excludes all of it.`,
    };
  }

  if (verifiedBy !== undefined && typeof verifiedBy !== "string") {
    return {
      isOk: false,
      reason: "`okf.verifiedBy` in package.json must be a string.",
    };
  }

  if (style !== undefined && !isEntryStyle(style)) {
    return {
      isOk: false,
      reason: `\`okf.style\` in package.json must be one of ${ENTRY_STYLE_NAMES}.`,
    };
  }

  if (drafts !== undefined && !isDraftPolicy(drafts)) {
    return {
      isOk: false,
      reason: `\`okf.drafts\` in package.json must be one of ${DRAFT_POLICIES.join(", ")}.`,
    };
  }

  return {
    config: { bundles, drafts, exclude, style, verifiedBy },
    isOk: true,
  };
}

/**
 * Merge the flags over the config.
 *
 * - `--bundle` replaces `okf.bundles` rather than adding to it, and is
 *   relative to where the command was run; config bundles are relative to the
 *   repo root.
 *
 * - `okf.exclude` has no flag, so it always applies.
 *
 * - `okf.style` has no flag either, and is `match` unless configured.
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
  const packageJsonPath = path.join(repoRoot, "package.json");

  const bundleDirs = selectBundleDirs({ config, cwd, options, repoRoot });

  if (bundleDirs.length === 0) {
    return { isOk: false, reason: describeNoBundles(packageJsonPath) };
  }

  const verifiedBy = options.by ?? config.verifiedBy;

  if (verifiedBy === undefined) {
    return {
      isOk: false,
      reason: `No one to sign as: pass --by <actor>, or set \`okf.verifiedBy\` in ${packageJsonPath}.`,
    };
  }

  if (!isActor(verifiedBy)) {
    return { isOk: false, reason: describeBadActor(verifiedBy) };
  }

  return {
    isOk: true,
    settings: {
      bundleDirs,
      excludeGlobs: config.exclude ?? [],
      style: config.style ?? ENTRY_STYLES.match,
      verifiedBy,
    },
  };
}

/**
 * Pick the bundle directories a run names, as absolute paths.
 *
 * - `--bundle` replaces `okf.bundles` rather than adding to it, and is
 *   relative to where the command was run; config bundles are relative to the
 *   repo root.
 *
 * @returns the directories, empty when neither names any.
 */
export function selectBundleDirs(params: {
  config: Pick<OkfConfig, "bundles">;
  cwd: string;
  options: Pick<CliOptions, "bundles">;
  repoRoot: string;
}): string[] {
  const { config, cwd, options, repoRoot } = params;

  return options.bundles.length > 0
    ? options.bundles.map((dir) => path.resolve(cwd, dir))
    : (config.bundles ?? []).map((dir) => path.resolve(repoRoot, dir));
}

/** Whether a parsed JSON value is one of `okf.drafts`' values. */
function isDraftPolicy(value: unknown): value is DraftPolicy {
  return DRAFT_POLICIES.some((policy) => policy === value);
}

/** Whether a parsed JSON value is a list of non-empty strings. */
function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item !== "")
  );
}
