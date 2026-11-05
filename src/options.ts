import { parseArgs } from "node:util";

import { describeError } from "./output.ts";

/** The flags and record paths a run was given. */
export type CliOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions", "docs/references"]`
   */
  bundles: readonly string[];

  /**
   * The actor passed with `--by`, which overrides `okf.verifiedBy`.
   *
   * @example "human:jjloneman"
   */
  by: string | undefined;

  /**
   * Whether `--changed` asked for every changed record needing a sign-off.
   *
   * @example true
   */
  isChanged: boolean;

  /**
   * Whether `--yes` asked for a run with no prompts.
   *
   * @example true
   */
  isYes: boolean;

  /**
   * Record files named on the command line, relative to where it was run.
   *
   * @example `["docs/decisions/package-promise.md"]`
   */
  recordPaths: readonly string[];

  /**
   * Whether to commit the verified files; `--no-commit` turns it off.
   *
   * @example true
   */
  shouldCommit: boolean;
};

/** What the command line asked for: help, a run, or nothing valid. */
export type ParsedArgs =
  | {
      /**
       * `--help` was passed.
       *
       * @example "help"
       */
      kind: "help";
    }
  | {
      /**
       * The arguments can't be run.
       *
       * @example "invalid"
       */
      kind: "invalid";

      /**
       * Why, without the usage text.
       *
       * @example "--yes needs --changed or at least one record path."
       */
      message: string;
    }
  | {
      /**
       * The arguments describe a run.
       *
       * @example "options"
       */
      kind: "options";

      /**
       * The run's options.
       *
       * @example `{ bundles: [], by: undefined, isChanged: true, isYes: true, recordPaths: [], shouldCommit: true }`
       */
      options: CliOptions;
    };

/** How to call the CLI, printed for `--help` and after a usage error. */
export const USAGE = `usage: okf-verify [options]
       okf-verify --yes (--changed | <record>...) [options]

Marks OKF records \`status: stable\` with a \`verified\` entry, then commits
just those files. Without --yes it asks which records, in a terminal.

options:
  --bundle <dir>  a bundle directory to scan; repeat for more
                  (default: \`okf.bundles\` in package.json)
  --by <actor>    who signs off (default: \`okf.verifiedBy\` in package.json)
  --yes, -y       run with no prompts; needs --changed or record paths
  --changed       with --yes: every changed record still needing a sign-off
  --no-commit     edit the files but leave committing to you
  --help, -h      print this help

An agent should run --yes only when the person has asked it to verify those
records, and should name the files rather than pass --changed unless they
asked for all of them.`;

/** Read the command line into options, or say why it can't run. */
export function parseCliArgs(args: readonly string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseCommandLine>;

  try {
    parsed = parseCommandLine(args);
  } catch (error) {
    return { kind: "invalid", message: describeError(error) };
  }

  const { positionals, values } = parsed;

  if (values.help === true) {
    return { kind: "help" };
  }

  const options: CliOptions = {
    bundles: values.bundle ?? [],
    by: values.by,
    isChanged: values.changed === true,
    isYes: values.yes === true,
    recordPaths: positionals,
    shouldCommit: values["no-commit"] !== true,
  };

  const problem = findSelectionProblem(options);

  return problem === undefined
    ? { kind: "options", options }
    : { kind: "invalid", message: problem };
}

/**
 * Check that `--yes`, `--changed`, and record paths come in a combination that
 * selects records exactly one way.
 *
 * - `--yes` alone selects nothing, so it can't verify everything by accident.
 *
 * @returns the problem, or `undefined` when the combination is valid.
 */
function findSelectionProblem(options: CliOptions): string | undefined {
  const { isChanged, isYes, recordPaths } = options;
  const hasPaths = recordPaths.length > 0;

  if (isChanged && hasPaths) {
    return "Pass --changed or record paths, not both.";
  }

  if (!isYes && (isChanged || hasPaths)) {
    return "--changed and record paths need --yes; without it, records are picked in the prompts.";
  }

  if (isYes && !isChanged && !hasPaths) {
    return "--yes needs --changed or at least one record path.";
  }

  return undefined;
}

/**
 * Run `parseArgs` over the CLI's flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseCommandLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      changed: { type: "boolean" },
      help: { short: "h", type: "boolean" },
      "no-commit": { type: "boolean" },
      yes: { short: "y", type: "boolean" },
    },
    strict: true,
  });
}
