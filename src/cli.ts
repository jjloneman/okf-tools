import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { OkfConfig } from "./config.ts";
import type { ExitCode } from "./exit-codes.ts";
import type { CliOptions } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { Output, Program } from "./output.ts";
import type { BundleContext, RunContext } from "./run-context.ts";

import {
  describeNoBundles,
  readOkfConfig,
  resolveSettings,
  selectBundleDirs,
} from "./config.ts";
import { runDeprecate } from "./deprecate.ts";
import { runDiff } from "./diff.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { findRepoRoot } from "./git.ts";
import { runGuide } from "./guide.ts";
import { runIndex } from "./index-command.ts";
import { runInit } from "./init.ts";
import { runInteractive } from "./interactive.ts";
import { runMigrate } from "./migrate.ts";
import { runNew } from "./new-record.ts";
import { runNonInteractive } from "./non-interactive.ts";
import {
  DEPRECATE_USAGE,
  DIFF_USAGE,
  formatVerifyUsage,
  INDEX_USAGE,
  MIGRATE_USAGE,
  NEW_USAGE,
  OKF_USAGE,
  parseCliArgs,
  parseCommand,
  parseDeprecateArgs,
  parseDiffArgs,
  parseIndexArgs,
  parseMigrateArgs,
  parseNewArgs,
  parseStatusArgs,
  parseTagsArgs,
  parseTouchArgs,
  STATUS_USAGE,
  TAGS_USAGE,
  TOUCH_USAGE,
} from "./options.ts";
import { createOutput, describeError } from "./output.ts";
import { resolveBundleDirs } from "./repo.ts";
import { runStatus } from "./status.ts";
import { runTags } from "./tags.ts";
import { runTouch } from "./touch.ts";
import { formatVersion } from "./version.ts";
import { spellLikeRepoRoot } from "./working-directory.ts";

/** What a run of the CLI is given by the process that starts it. */
export type RunParams = {
  /**
   * The command-line arguments, without `node` and the script.
   *
   * @example `["--yes", "--changed"]`
   */
  args: readonly string[];

  /**
   * The directory the command was run from, in any spelling the file system
   * resolves to it: through a symlink, or in another case or Unicode form
   * where the disk accepts one.
   *
   * @example "/repo"
   */
  cwd: string;

  /**
   * Whether stdin and stdout are both a terminal, so prompts can run.
   *
   * @example true
   */
  isInteractive: boolean;

  /**
   * The command the package was run as: `okf`, which takes a command as its
   * first argument, or the `okf-verify` alias for `okf verify`; leaving it out
   * runs as `okf-verify`.
   *
   * @example "okf"
   */
  program?: Program;
};

/**
 * Run `okf` or `okf-verify`: read the arguments, then dispatch to a command:
 * `okf deprecate`, `okf diff`, `okf guide`, `okf index`, `okf init`,
 * `okf migrate`, `okf new`, `okf status`, `okf tags`, `okf touch`, or
 * `okf verify`; `okf --version` prints the installed version.
 *
 * - `okf-verify <args>` runs as `okf verify <args>` does, printing under its
 *   own name.
 *
 * - Never throws; an unexpected error prints and ends with exit code `1`.
 *
 * @returns the exit code.
 */
export async function run(params: RunParams): Promise<ExitCode> {
  const { args, cwd, isInteractive, program = "okf-verify" } = params;
  const output = createOutput(program);

  if (program === "okf-verify") {
    return runVerify({ args, cwd, isInteractive, output, program });
  }

  const parsed = parseCommand(args);

  if (parsed.kind === "help") {
    output.info(OKF_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${OKF_USAGE}`);

    return EXIT_CODES.failure;
  }

  if (parsed.kind === "version") {
    output.data(formatVersion());

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "guide") {
    return runGuide({ args: parsed.args, output });
  }

  if (parsed.kind === "init") {
    return runInit({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "diff") {
    return runDiffCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "status") {
    return runStatusCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "index") {
    return runIndexCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "tags") {
    return runTagsCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "new") {
    return runNewCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "touch") {
    return runTouchCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "deprecate") {
    return runDeprecateCommand({ args: parsed.args, cwd, output });
  }

  if (parsed.kind === "migrate") {
    return runMigrateCommand({ args: parsed.args, cwd, output });
  }

  return runVerify({ args: parsed.args, cwd, isInteractive, output, program });
}

/**
 * Resolve the repo and bundles a command works with when it needs no one's
 * sign-off: `okf deprecate`, `okf index`, `okf migrate`, `okf new`,
 * `okf tags`, and `okf touch`.
 */
function buildBundleContext(params: {
  bundles: readonly string[];
  cwd: string;
  output: Output;
}): Outcome<BundleContext> {
  const { bundles, output } = params;
  const repo = readRepo(params.cwd);

  if (!repo.isOk) {
    return repo;
  }

  const { config, cwd, repoRoot } = repo.value;
  const bundleDirs = selectBundleDirs({
    config,
    cwd,
    options: { bundles },
    repoRoot,
  });

  if (bundleDirs.length === 0) {
    return {
      isOk: false,
      reason: describeNoBundles(path.join(repoRoot, "package.json")),
    };
  }

  const resolved = resolveBundleDirs({ bundleDirs, repoRoot });

  if (!resolved.isOk) {
    return resolved;
  }

  return {
    isOk: true,
    value: {
      bundleDirs: resolved.value,
      cwd,
      excludeGlobs: config.exclude ?? [],
      output,
      repoRoot,
    },
  };
}

/** Resolve the repo, config, bundles, and actor a run works with. */
function buildContext(params: {
  cwd: string;
  options: Pick<CliOptions, "bundles" | "by" | "shouldCommit" | "staleIn">;
  output: Output;
}): { isOk: false; reason: string } | { isOk: true; value: RunContext } {
  const { options, output } = params;
  const repo = readRepo(params.cwd);

  if (!repo.isOk) {
    return repo;
  }

  const { config, cwd, repoRoot } = repo.value;

  const settings = resolveSettings({
    config,
    cwd,
    options,
    repoRoot,
  });

  if (!settings.isOk) {
    return settings;
  }

  const { bundleDirs, excludeGlobs, style, verifiedBy } = settings.settings;
  const bundles = resolveBundleDirs({ bundleDirs, repoRoot });

  if (!bundles.isOk) {
    return bundles;
  }

  return {
    isOk: true,
    value: {
      bundleDirs: bundles.value,
      cwd,
      excludeGlobs,
      output,
      repoRoot,
      shouldCommit: options.shouldCommit,
      staleIn: options.staleIn,
      style,
      verifiedBy,
    },
  };
}

/**
 * Find the repo the command was run in, spell the directory as its root
 * does, and read the `okf` block of its `package.json`.
 */
function readRepo(
  runFrom: string
): Outcome<{ config: OkfConfig; cwd: string; repoRoot: string }> {
  const root = findRepoRoot(runFrom);

  if (!root.isOk) {
    return root;
  }

  const repoRoot = root.value;
  const cwd = spellLikeRepoRoot({ cwd: runFrom, repoRoot });
  const packageJsonPath = path.join(repoRoot, "package.json");

  const config = readOkfConfig(
    existsSync(packageJsonPath)
      ? readFileSync(packageJsonPath, "utf8")
      : undefined
  );

  if (!config.isOk) {
    return config;
  }

  return { isOk: true, value: { config: config.config, cwd, repoRoot } };
}

/**
 * Run `okf deprecate`: read its arguments and config, then deprecate each
 * record.
 */
function runDeprecateCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseDeprecateArgs(args);

  if (parsed.kind === "help") {
    output.info(DEPRECATE_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${DEPRECATE_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildBundleContext({
      bundles: options.bundles,
      cwd,
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runDeprecate({ context: context.value, options });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run the diff command: read its arguments and config, then print each
 * record's changes since its last sign-off.
 */
function runDiffCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseDiffArgs(args);

  if (parsed.kind === "help") {
    output.info(DIFF_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${DIFF_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildContext({
      cwd,
      options: { ...options, shouldCommit: false, staleIn: undefined },
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runDiff({
      context: context.value,
      recordPaths: options.recordPaths,
    });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run `okf index`: read its arguments and config, then sync each index, or
 * with `--check` report the ones out of date.
 */
function runIndexCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseIndexArgs(args);

  if (parsed.kind === "help") {
    output.info(INDEX_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${INDEX_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildBundleContext({
      bundles: options.bundles,
      cwd,
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runIndex({ context: context.value, isCheck: options.isCheck });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run `okf migrate`: read its arguments and config, then plan each bundle's
 * migration, and print, write, or check it.
 */
function runMigrateCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseMigrateArgs(args);

  if (parsed.kind === "help") {
    output.info(MIGRATE_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${MIGRATE_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildBundleContext({
      bundles: options.bundles,
      cwd,
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runMigrate({ context: context.value, mode: options.mode });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run `okf new`: read its arguments and config, then write the record and its
 * index line.
 */
function runNewCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseNewArgs(args);

  if (parsed.kind === "help") {
    output.info(NEW_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${NEW_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildBundleContext({
      bundles: options.bundles,
      cwd,
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runNew({ context: context.value, options });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run `okf status`: read its arguments and config, then print the report.
 *
 * - Exits `0` whatever the records hold; only a usage error, a config it
 *   can't use, a named path that isn't a record in the bundles, or a bundle
 *   it can't list exits `1`.
 */
function runStatusCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseStatusArgs(args);

  if (parsed.kind === "help") {
    output.info(STATUS_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${STATUS_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildContext({
      cwd,
      options: { ...options, shouldCommit: false, staleIn: undefined },
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runStatus({ context: context.value, options });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run `okf tags`: read its arguments and config, then print every tag with
 * its record count.
 */
function runTagsCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseTagsArgs(args);

  if (parsed.kind === "help") {
    output.info(TAGS_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${TAGS_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildBundleContext({
      bundles: options.bundles,
      cwd,
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runTags({ context: context.value, format: options.format });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run `okf touch`: read its arguments and config, then re-stamp each record's
 * `generated`.
 */
function runTouchCommand(params: {
  args: readonly string[];
  cwd: string;
  output: Output;
}): ExitCode {
  const { args, cwd, output } = params;
  const parsed = parseTouchArgs(args);

  if (parsed.kind === "help") {
    output.info(TOUCH_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${TOUCH_USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildBundleContext({
      bundles: options.bundles,
      cwd,
      output,
    });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    return runTouch({ context: context.value, options });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Run the verify command: read its arguments and config, then verify records
 * with prompts, or with none under `--yes`.
 */
async function runVerify(params: {
  args: readonly string[];
  cwd: string;
  isInteractive: boolean;
  output: Output;
  program: Program;
}): Promise<ExitCode> {
  const { args, cwd, isInteractive, output, program } = params;
  const command = program === "okf" ? "okf verify" : "okf-verify";
  const parsed = parseCliArgs(args);

  if (parsed.kind === "help") {
    output.info(formatVerifyUsage(command));

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${formatVerifyUsage(command)}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildContext({ cwd, options, output });

    if (!context.isOk) {
      output.error(context.reason);

      return EXIT_CODES.failure;
    }

    if (options.isYes) {
      return runNonInteractive({ context: context.value, options });
    }

    if (!isInteractive) {
      output.error(
        "Prompts need an interactive terminal. To run without one, pass --yes with --changed or record paths."
      );

      return EXIT_CODES.failure;
    }

    return await runInteractive(context.value);
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}
