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

/** What `okf`'s first argument asked for: help, a command, or nothing valid. */
export type ParsedCommand =
  | {
      /**
       * `--help` was passed before any command.
       *
       * @example "help"
       */
      kind: "help";
    }
  | {
      /**
       * The arguments after the command's name.
       *
       * @example `["--yes", "--changed"]`
       */
      args: readonly string[];

      /**
       * A command was named.
       *
       * @example "verify"
       */
      kind: "verify";
    }
  | {
      /**
       * The arguments name no command.
       *
       * @example "invalid"
       */
      kind: "invalid";

      /**
       * Why, without the usage text.
       *
       * @example "Unknown command: sign."
       */
      message: string;
    };

/** The name the verify command is called by: under `okf`, or as its alias. */
export type VerifyCommand = "okf-verify" | "okf verify";

/** How to call `okf`, printed for `okf --help` and after a usage error. */
export const OKF_USAGE = `usage: okf <command> [options]

commands:
  verify  mark records \`status: stable\` with a \`verified\` entry, then
          commit just those files

Run \`okf <command> --help\` for a command's options. \`okf-verify\` is the
same as \`okf verify\`.`;

/**
 * How to call the verify command, printed for `--help` and after a usage
 * error, under the name it was called by.
 */
export function formatVerifyUsage(command: VerifyCommand): string {
  return `usage: ${command} [options]
       ${command} --yes (--changed | <record>...) [options]

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
}

/** Read the command line into options, or say why it can't run. */
export function parseCliArgs(args: readonly string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseCommandLine>;

  try {
    parsed = parseCommandLine(args);
  } catch (error) {
    // Asking for help is never a usage error, even beside a flag that is.
    return isHelpAsked(args)
      ? { kind: "help" }
      : { kind: "invalid", message: describeError(error) };
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
 * Read `okf`'s first argument as the command to run.
 *
 * - Options come after the command, so a flag in its place names none.
 */
export function parseCommand(args: readonly string[]): ParsedCommand {
  const [name, ...rest] = args;

  if (name === "--help" || name === "-h") {
    return { kind: "help" };
  }

  if (name === "verify") {
    return { args: rest, kind: "verify" };
  }

  if (name === undefined) {
    return { kind: "invalid", message: "Name a command." };
  }

  return {
    kind: "invalid",
    message: name.startsWith("-")
      ? `${name} isn't a command; options follow the command, as in okf <command> ${name}.`
      : `Unknown command: ${name}.`,
  };
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
  const { bundles, isChanged, isYes, recordPaths } = options;
  const hasPaths = recordPaths.length > 0;

  if (bundles.includes("")) {
    return "--bundle needs a directory, not an empty string.";
  }

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
 * Whether the command line asks for help, read loosely so an unknown flag or
 * a missing value beside it can't throw.
 */
function isHelpAsked(args: readonly string[]): boolean {
  const { values } = parseArgs({
    allowPositionals: true,
    args: [...args],
    options: { help: { short: "h", type: "boolean" } },
    strict: false,
  });

  return values.help === true;
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
