import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { CliOptions } from "./options.ts";
import type { Output, Program } from "./output.ts";
import type { RunContext } from "./run-context.ts";

import { readOkfConfig, resolveSettings } from "./config.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { findRepoRoot } from "./git.ts";
import { runInteractive } from "./interactive.ts";
import { runNonInteractive } from "./non-interactive.ts";
import {
  formatVerifyUsage,
  OKF_USAGE,
  parseCliArgs,
  parseCommand,
} from "./options.ts";
import { createOutput, describeError } from "./output.ts";
import { resolveBundleDirs } from "./repo.ts";
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
 * Run `okf` or `okf-verify`: read the arguments, then dispatch to a command.
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

  return runVerify({ args: parsed.args, cwd, isInteractive, output, program });
}

/** Resolve the repo, config, bundles, and actor a run works with. */
function buildContext(params: {
  cwd: string;
  options: CliOptions;
  output: Output;
}): { isOk: false; reason: string } | { isOk: true; value: RunContext } {
  const { options, output } = params;
  const root = findRepoRoot(params.cwd);

  if (!root.isOk) {
    return root;
  }

  const repoRoot = root.value;
  const cwd = spellLikeRepoRoot({ cwd: params.cwd, repoRoot });
  const packageJsonPath = path.join(repoRoot, "package.json");

  const config = readOkfConfig(
    existsSync(packageJsonPath)
      ? readFileSync(packageJsonPath, "utf8")
      : undefined
  );

  if (!config.isOk) {
    return config;
  }

  const settings = resolveSettings({
    config: config.config,
    cwd,
    options,
    repoRoot,
  });

  if (!settings.isOk) {
    return settings;
  }

  const { bundleDirs, verifiedBy } = settings.settings;
  const bundles = resolveBundleDirs({ bundleDirs, repoRoot });

  if (!bundles.isOk) {
    return bundles;
  }

  return {
    isOk: true,
    value: {
      bundleDirs: bundles.value,
      cwd,
      output,
      repoRoot,
      shouldCommit: options.shouldCommit,
      verifiedBy,
    },
  };
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
