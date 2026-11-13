import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { CliOptions } from "./options.ts";
import type { RunContext } from "./run-context.ts";

import { readOkfConfig, resolveSettings } from "./config.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { findRepoRoot } from "./git.ts";
import { runInteractive } from "./interactive.ts";
import { runNonInteractive } from "./non-interactive.ts";
import { parseCliArgs, USAGE } from "./options.ts";
import { describeError, printError, printInfo } from "./output.ts";
import { resolveBundleDirs } from "./repo.ts";

/** What a run of the CLI is given by the process that starts it. */
export type RunParams = {
  /**
   * The command-line arguments, without `node` and the script.
   *
   * @example `["--yes", "--changed"]`
   */
  args: readonly string[];

  /**
   * The directory the command was run from.
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
};

/**
 * Run `okf-verify`: read the arguments and config, then verify records with
 * prompts, or with none under `--yes`.
 *
 * - Never throws; an unexpected error prints and ends with exit code `1`.
 *
 * @returns the exit code.
 */
export async function run(params: RunParams): Promise<ExitCode> {
  const { args, cwd, isInteractive } = params;
  const parsed = parseCliArgs(args);

  if (parsed.kind === "help") {
    printInfo(USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    printError(`${parsed.message}\n\n${USAGE}`);

    return EXIT_CODES.failure;
  }

  const { options } = parsed;

  try {
    const context = buildContext({ cwd, options });

    if (!context.isOk) {
      printError(context.reason);

      return EXIT_CODES.failure;
    }

    if (options.isYes) {
      return runNonInteractive({ context: context.value, options });
    }

    if (!isInteractive) {
      printError(
        "Prompts need an interactive terminal. To run without one, pass --yes with --changed or record paths."
      );

      return EXIT_CODES.failure;
    }

    return await runInteractive(context.value);
  } catch (error) {
    printError(describeError(error));

    return EXIT_CODES.failure;
  }
}

/** Resolve the repo, config, bundles, and actor a run works with. */
function buildContext(params: {
  cwd: string;
  options: CliOptions;
}): { isOk: false; reason: string } | { isOk: true; value: RunContext } {
  const { cwd, options } = params;
  const root = findRepoRoot(cwd);

  if (!root.isOk) {
    return root;
  }

  const repoRoot = root.value;
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
      repoRoot,
      shouldCommit: options.shouldCommit,
      verifiedBy,
    },
  };
}
