import { DateTime, Duration } from "luxon";
import { parseArgs } from "node:util";

import type { MigrateMode } from "./migrate.ts";

import { describeError } from "./output.ts";

/** How `okf check` prints its report: the formats `okf status` takes. */
export type CheckFormat = StatusFormat;

/** The flags an `okf check` run was given. */
export type CheckOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * How to print the report, from `--format`.
   *
   * @example "json"
   */
  format: CheckFormat;

  /**
   * Whether `--changed` asked to report only on the files changed since the
   * base branch.
   *
   * @example true
   */
  isChanged: boolean;

  /**
   * Whether a warning fails the run too, from `--strict`.
   *
   * @example true
   */
  isStrict: boolean;
};

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

  /**
   * How long a sign-off holds, from `--stale-in`, as an ISO 8601 duration;
   * each record signed off gets a `stale_after` that far past its sign-off.
   * `undefined` leaves any `stale_after` as it is.
   *
   * @example "P90D"
   */
  staleIn: string | undefined;
};

/** The flags and record paths an `okf deprecate` run was given. */
export type DeprecateOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * The producer passed with `--by`, written as `generated.by`.
   *
   * @example "claude-code/claude-opus-5-5"
   */
  by: string;

  /**
   * Record files named on the command line, relative to where it was run.
   *
   * @example `["docs/decisions/old-pin.md"]`
   */
  recordPaths: readonly string[];

  /**
   * The record passed with `--superseded-by`, relative to where the command
   * was run, that replaces them; `undefined` when none was.
   *
   * @example "docs/decisions/spec-pin.md"
   */
  supersededBy: string | undefined;
};

/** The flags and record paths `okf diff` was given. */
export type DiffOptions = Pick<CliOptions, "bundles" | "by" | "recordPaths">;

/** The flags an `okf index` run was given. */
export type IndexOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * Whether `--check` asked only to report the indexes out of date, writing
   * nothing.
   *
   * @example true
   */
  isCheck: boolean;
};

/** The flags an `okf migrate` run was given. */
export type MigrateOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * What to do with the plans: print them as diffs (the default), apply them
   * with `--write`, or with `--check` only fail when one is needed.
   *
   * @example "dry-run"
   */
  mode: MigrateMode;
};

/**
 * What a command's line asked for: help, a run, or nothing valid.
 *
 * - `Options` is the command's own options, the verify command's by default.
 */
export type ParsedArgs<Options = CliOptions> =
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
      options: Options;
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
       * `--version` was passed before any command.
       *
       * @example "version"
       */
      kind: "version";
    }
  | {
      /**
       * The arguments after the command's name.
       *
       * @example `["--yes", "--changed"]`
       */
      args: readonly string[];

      /**
       * A command was named: the one to run.
       *
       * @example "verify"
       */
      kind:
        | "check"
        | "deprecate"
        | "diff"
        | "guide"
        | "index"
        | "init"
        | "migrate"
        | "new"
        | "status"
        | "tags"
        | "touch"
        | "verify";
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

/** What `okf diff`'s arguments asked for: help, a run, or nothing valid. */
export type ParsedDiffArgs =
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
       * @example "Name at least one record."
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
       * @example `{ bundles: [], by: undefined, recordPaths: ["docs/decisions/a.md"] }`
       */
      options: DiffOptions;
    };

/** Which records `okf status` lists; with none, it lists them all. */
export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** How `okf status` prints its report. */
export type StatusFormat = (typeof STATUS_FORMATS)[number];

/** The flags and record paths an `okf status` run was given. */
export type StatusOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * The actor passed with `--by`, whose sign-off counts, which overrides
   * `okf.verifiedBy`.
   *
   * @example "human:jjloneman"
   */
  by: string | undefined;

  /**
   * The filters passed, in the order `STATUS_FILTERS` lists them; a record
   * matching any of them is listed.
   *
   * @example `["draft", "stale"]`
   */
  filters: readonly StatusFilter[];

  /**
   * How to print the report, from `--format`.
   *
   * @example "json"
   */
  format: StatusFormat;

  /**
   * Record files named on the command line, relative to where it was run;
   * empty means every record in the bundles.
   *
   * @example `["docs/decisions/package-promise.md"]`
   */
  recordPaths: readonly string[];
};

/** How `okf tags` prints its report: the formats `okf status` takes. */
export type TagsFormat = StatusFormat;

/** The flags an `okf tags` run was given. */
export type TagsOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * How to print the report, from `--format`.
   *
   * @example "json"
   */
  format: TagsFormat;
};

/** The name the verify command is called by: under `okf`, or as its alias. */
export type VerifyCommand = "okf-verify" | "okf verify";

/** How to call `okf`, printed for `okf --help` and after a usage error. */
export const OKF_USAGE = `usage: okf <command> [options]

commands:
  check   report problems in the bundles against OKF's spec rules,
          and whether each sign-off still holds, writing nothing
  deprecate
          mark records \`status: deprecated\`, naming what replaces them
  diff    print what changed in records since their last sign-off
  guide   print when an agent may run each command, and the rules for
          writing records
  index   sync each index.md's record lines and tag index from the
          records' frontmatter, or check they're current
  init    write the \`okf\` config, the agent-instructions block, and the
          okf skills, or check the block and the skills are current
  migrate move bundles from OKF v0.1 or v0.2 to v0.3, rewriting the paths
          whose meaning changes; a dry run unless --write
  new     write a new draft record's frontmatter, stamped from the clock,
          and its index line
  status  list every record's trust state, writing nothing
  tags    list every tag in the bundles with its record count
  touch   re-stamp records' \`generated\` from the clock after an edit
  verify  mark records \`status: stable\` with a \`verified\` entry, then
          commit just those files

Run \`okf <command> --help\` for a command's options, and \`okf --version\`
for the installed version and the OKF version it supports. \`okf-verify\` is
the same as \`okf verify\`.`;

/**
 * How to call `okf deprecate`, printed for its `--help` and after a usage
 * error.
 */
export const DEPRECATE_USAGE = `usage: okf deprecate <record>... --by <producer> [options]

Marks each record \`status: deprecated\`: kept for links and history, but no
longer current. It re-stamps \`generated\`, \`by\` from --by and \`at\` from
the clock, so a signed-off record shows as changed until it's signed off
again. With --superseded-by, it sets \`superseded_by\` to the record that
replaces it, as a path from the bundle root. It never adds or changes
\`verified\`, and writes nothing when any record refuses.

options:
  --by <producer>           who deprecated it, as \`<producer>/<version>\`
  --superseded-by <record>  the record that replaces it, in the same bundle
  --bundle <dir>            a bundle directory the records are in; repeat
                            for more (default: \`okf.bundles\` in
                            package.json)
  --help, -h                print this help`;

/** How to call `okf diff`, printed for its `--help` and after a usage error. */
export const DIFF_USAGE = `usage: okf diff [options] <record>...

Prints what changed in each record since the signer last signed it off: the
diff from the commit that set their \`verified.at\` to the file on disk, or
the whole record when no commit did. It changes nothing.

options:
  --bundle <dir>  a bundle directory the records are in; repeat for more
                  (default: \`okf.bundles\` in package.json)
  --by <actor>    whose sign-off to diff from
                  (default: \`okf.verifiedBy\` in package.json)
  --help, -h      print this help`;

/** What `okf guide`'s arguments asked for: help, the guide, or nothing valid. */
export type ParsedGuideArgs =
  | {
      /**
       * The arguments ask for the guide.
       *
       * @example "guide"
       */
      kind: "guide";
    }
  | Extract<ParsedArgs, { kind: "help" | "invalid" }>;

/** How to call `okf guide`, printed for its `--help` and after a usage error. */
export const GUIDE_USAGE = `usage: okf guide

Prints, as Markdown, the rules for writing and verifying records, each command
and when an agent may run it, and the skills \`okf init\` installs, from the
installed version. It reads and writes nothing.

options:
  --help, -h  print this help`;

/** The flags `okf init` was given. */
export type InitOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "keep `okf.bundles`".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * The actor passed with `--by`; `undefined` keeps `okf.verifiedBy`.
   *
   * @example "human:jjloneman"
   */
  by: string | undefined;

  /**
   * Whether `--check` asked only to check the block, writing nothing.
   *
   * @example true
   */
  isCheck: boolean;

  /**
   * Whether `--copilot` asked for the block in
   * `.github/copilot-instructions.md` too.
   *
   * @example true
   */
  shouldWriteCopilot: boolean;
};

/** What `okf init`'s command line asked for: help, a run, or nothing valid. */
export type ParsedInitArgs =
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
       * @example "--check writes nothing, so it takes no --bundle or --by."
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
       * @example `{ bundles: [], by: undefined, isCheck: true, shouldWriteCopilot: false }`
       */
      options: InitOptions;
    };

/** The filters `okf status` takes, each a flag of the same name. */
export const STATUS_FILTERS = ["changed", "draft", "stale"] as const;

/** The formats `okf status --format` takes; `text` is the default. */
export const STATUS_FORMATS = ["json", "text"] as const;

/** How to call `okf status`, printed for `--help` and after a usage error. */
export const STATUS_USAGE = `usage: okf status [options] [<record>...]

Lists every record's trust state: changed since its sign-off, draft, never
signed off, stale, or settled. It writes nothing, and exits 0 whatever it
finds. Name records to list only those.

options:
  --bundle <dir>     a bundle directory to scan; repeat for more
                     (default: \`okf.bundles\` in package.json)
  --by <actor>       whose sign-off counts
                     (default: \`okf.verifiedBy\` in package.json)
  --changed          only records changed since their sign-off
  --draft            only records with \`status: draft\`
  --stale            only records past their \`stale_after\`
  --format <format>  text (the default) or json
  --help, -h         print this help

Filters add up: a record that matches any of them is listed.`;

/** How to call `okf index`, printed for `--help` and after a usage error. */
export const INDEX_USAGE = `usage: okf index [options]

Rewrites each list line in a bundle's index.md files that links to a record
from that record's title and description, sorted by title, adds a line for
each record no line lists, and drops one whose record is gone. Between
\`<!-- tag-index:start -->\` and \`<!-- tag-index:end -->\` it lists every tag
with its records. Everything else in the file is kept as written.

options:
  --bundle <dir>  a bundle directory to sync; repeat for more
                  (default: \`okf.bundles\` in package.json)
  --check         write nothing; fail when an index is out of date
  --help, -h      print this help`;

/** How to call `okf migrate`, printed for `--help` and after a usage error. */
export const MIGRATE_USAGE = `usage: okf migrate [options]

Moves each bundle declared OKF v0.1 or v0.2, or undeclared, to v0.3: it sets
\`okf_version: "0.3"\` in the bundle's root index.md, fills in a missing
\`title\` and \`description\` from its first heading and paragraph, and
rewrites each bare path, in a path field or a Markdown link, that names a
file only from the bundle root to the relative path that names it from its
own file, since v0.3 reads it from there. It never touches \`generated\` or
\`verified\`, so a signed-off record stays signed off.

Without --write it prints each change as a diff and writes nothing. A bundle
with a path that names different files under the two readings, or a newer
\`okf_version\`, is reported and left as it is.

options:
  --bundle <dir>  a bundle directory to migrate; repeat for more
                  (default: \`okf.bundles\` in package.json)
  --write         apply the changes
  --check         write nothing; fail when a bundle still needs migrating
  --help, -h      print this help`;

/** How to call `okf check`, printed for `--help` and after a usage error. */
export const CHECK_USAGE = `usage: okf check [options]

Reports problems in the bundles against the rules OKF's spec states, and
whether each record's sign-off still holds: every Markdown file git would
track, records, index.md and log.md alike. Each finding names its file,
line, severity, and rule. It writes nothing. In GitHub Actions, text
findings also print as annotations on the files.

A record whose body changed since the base branch is an error while a
sign-off from before the change still counts, as when generated.at wasn't
re-stamped. A draft is a notice, or as \`okf.drafts\` in package.json says:
allow, warn, or block.

It exits 1 on an error-level finding or a file it can't read, and under
--strict on a warning too; otherwise 0.

options:
  --bundle <dir>     a bundle directory to check; repeat for more
                     (default: \`okf.bundles\` in package.json)
  --changed          report only on files changed since the base branch
  --format <format>  text (the default) or json
  --strict           fail on warnings too
  --help, -h         print this help`;

/** How to call `okf tags`, printed for `--help` and after a usage error. */
export const TAGS_USAGE = `usage: okf tags [options]

Lists every tag in the bundles with how many records carry it, read from
each record's frontmatter. It writes nothing, and exits 0 whatever it finds.

options:
  --bundle <dir>     a bundle directory to scan; repeat for more
                     (default: \`okf.bundles\` in package.json)
  --format <format>  text (the default) or json
  --help, -h         print this help`;

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
  --stale-in <duration>
                  set each record's \`stale_after\` that long after its
                  sign-off, as an ISO 8601 duration such as P90D or P6M
  --help, -h      print this help

An agent runs --yes only when the person asks it to, naming the files they
approved, and passes --changed only when they asked for every changed
record; \`okf guide\` prints the rules.`;
}

/** Read `okf check`'s command line into options, or say why it can't run. */
export function parseCheckArgs(
  args: readonly string[]
): ParsedArgs<CheckOptions> {
  let parsed: ReturnType<typeof parseCheckLine>;

  try {
    parsed = parseCheckLine(args);
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

  const bundles = values.bundle ?? [];
  const problem = findBundlesProblem({
    bundles,
    command: "okf check",
    positionals,
  });

  if (problem !== undefined) {
    return { kind: "invalid", message: problem };
  }

  const format = values.format ?? "text";

  return isStatusFormat(format)
    ? {
        kind: "options",
        options: {
          bundles,
          format,
          isChanged: values.changed === true,
          isStrict: values.strict === true,
        },
      }
    : {
        kind: "invalid",
        message: `--format takes ${STATUS_FORMATS.join(" or ")}, not "${format}".`,
      };
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
    staleIn: values["stale-in"],
  };

  const problem =
    findSelectionProblem(options) ?? findStaleInProblem(options.staleIn);

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

  if (name === "--version") {
    return { kind: "version" };
  }

  if (
    name === "check" ||
    name === "deprecate" ||
    name === "diff" ||
    name === "guide" ||
    name === "index" ||
    name === "init" ||
    name === "migrate" ||
    name === "new" ||
    name === "status" ||
    name === "tags" ||
    name === "touch" ||
    name === "verify"
  ) {
    return { args: rest, kind: name };
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

/** Read `okf deprecate`'s command line into options, or say why it can't run. */
export function parseDeprecateArgs(
  args: readonly string[]
): ParsedArgs<DeprecateOptions> {
  let parsed: ReturnType<typeof parseDeprecateLine>;

  try {
    parsed = parseDeprecateLine(args);
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

  const bundles = values.bundle ?? [];
  const { by } = values;
  const supersededBy = values["superseded-by"];

  if (positionals.length === 0) {
    return { kind: "invalid", message: "Name at least one record." };
  }

  if (by === undefined) {
    return { kind: "invalid", message: "okf deprecate needs --by." };
  }

  const problem =
    findBundleFlagProblem(bundles) ??
    (supersededBy === ""
      ? "--superseded-by needs a record, not an empty string."
      : undefined);

  return problem === undefined
    ? {
        kind: "options",
        options: { bundles, by, recordPaths: positionals, supersededBy },
      }
    : { kind: "invalid", message: problem };
}

/** Read `okf diff`'s arguments into options, or say why they can't run. */
export function parseDiffArgs(args: readonly string[]): ParsedDiffArgs {
  let parsed: ReturnType<typeof parseDiffCommandLine>;

  try {
    parsed = parseDiffCommandLine(args);
  } catch (error) {
    return isHelpAsked(args)
      ? { kind: "help" }
      : { kind: "invalid", message: describeError(error) };
  }

  const { positionals, values } = parsed;

  if (values.help === true) {
    return { kind: "help" };
  }

  const options: DiffOptions = {
    bundles: values.bundle ?? [],
    by: values.by,
    recordPaths: positionals,
  };

  if (options.bundles.includes("")) {
    return {
      kind: "invalid",
      message: "--bundle needs a directory, not an empty string.",
    };
  }

  return positionals.length === 0
    ? { kind: "invalid", message: "Name at least one record." }
    : { kind: "options", options };
}

/** Read `okf guide`'s arguments, or say why they can't run. */
export function parseGuideArgs(args: readonly string[]): ParsedGuideArgs {
  let parsed: ReturnType<typeof parseGuideCommandLine>;

  try {
    parsed = parseGuideCommandLine(args);
  } catch (error) {
    return isHelpAsked(args)
      ? { kind: "help" }
      : { kind: "invalid", message: describeError(error) };
  }

  const { positionals, values } = parsed;

  if (values.help === true) {
    return { kind: "help" };
  }

  const [extra] = positionals;

  return extra === undefined
    ? { kind: "guide" }
    : {
        kind: "invalid",
        message: `okf guide takes no arguments, but was given ${extra}.`,
      };
}

/** Read `okf index`'s command line into options, or say why it can't run. */
export function parseIndexArgs(
  args: readonly string[]
): ParsedArgs<IndexOptions> {
  let parsed: ReturnType<typeof parseIndexLine>;

  try {
    parsed = parseIndexLine(args);
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

  const problem = findBundlesProblem({
    bundles: values.bundle ?? [],
    command: "okf index",
    positionals,
  });

  return problem === undefined
    ? {
        kind: "options",
        options: {
          bundles: values.bundle ?? [],
          isCheck: values.check === true,
        },
      }
    : { kind: "invalid", message: problem };
}

/** Read `okf migrate`'s command line into options, or say why it can't run. */
export function parseMigrateArgs(
  args: readonly string[]
): ParsedArgs<MigrateOptions> {
  let parsed: ReturnType<typeof parseMigrateLine>;

  try {
    parsed = parseMigrateLine(args);
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

  const problem =
    findBundlesProblem({
      bundles: values.bundle ?? [],
      command: "okf migrate",
      positionals,
    }) ??
    (values.check === true && values.write === true
      ? "--check writes nothing, so it can't be passed with --write."
      : undefined);

  if (problem !== undefined) {
    return { kind: "invalid", message: problem };
  }

  let mode: MigrateMode = "dry-run";

  if (values.check === true) {
    mode = "check";
  } else if (values.write === true) {
    mode = "write";
  }

  return { kind: "options", options: { bundles: values.bundle ?? [], mode } };
}

/** Read `okf status`'s command line into options, or say why it can't run. */
export function parseStatusArgs(
  args: readonly string[]
): ParsedArgs<StatusOptions> {
  let parsed: ReturnType<typeof parseStatusLine>;

  try {
    parsed = parseStatusLine(args);
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

  const bundles = values.bundle ?? [];

  if (bundles.includes("")) {
    return {
      kind: "invalid",
      message: "--bundle needs a directory, not an empty string.",
    };
  }

  const format = values.format ?? "text";

  if (!isStatusFormat(format)) {
    return {
      kind: "invalid",
      message: `--format takes ${STATUS_FORMATS.join(" or ")}, not "${format}".`,
    };
  }

  return {
    kind: "options",
    options: {
      bundles,
      by: values.by,
      filters: STATUS_FILTERS.filter((filter) => values[filter] === true),
      format,
      recordPaths: positionals,
    },
  };
}

/** Read `okf tags`'s command line into options, or say why it can't run. */
export function parseTagsArgs(
  args: readonly string[]
): ParsedArgs<TagsOptions> {
  let parsed: ReturnType<typeof parseTagsLine>;

  try {
    parsed = parseTagsLine(args);
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

  const bundles = values.bundle ?? [];
  const problem = findBundlesProblem({
    bundles,
    command: "okf tags",
    positionals,
  });

  if (problem !== undefined) {
    return { kind: "invalid", message: problem };
  }

  const format = values.format ?? "text";

  return isStatusFormat(format)
    ? { kind: "options", options: { bundles, format } }
    : {
        kind: "invalid",
        message: `--format takes ${STATUS_FORMATS.join(" or ")}, not "${format}".`,
      };
}

/**
 * Check the arguments of a command that takes bundles but no paths.
 *
 * @returns the problem, or `undefined` when there is none.
 */
function findBundlesProblem(params: {
  bundles: readonly string[];
  command: string;
  positionals: readonly string[];
}): string | undefined {
  const { bundles, command, positionals } = params;
  const [extra] = positionals;

  if (extra !== undefined) {
    return `${command} takes no paths, but was given ${extra}.`;
  }

  return bundles.includes("")
    ? "--bundle needs a directory, not an empty string."
    : undefined;
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

/** Whether a `--format` value is one `okf status` prints. */
function isStatusFormat(format: string): format is StatusFormat {
  return STATUS_FORMATS.some((known) => known === format);
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
      "stale-in": { type: "string" },
      yes: { short: "y", type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf deprecate`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseDeprecateLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      help: { short: "h", type: "boolean" },
      "superseded-by": { type: "string" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf diff`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseDiffCommandLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      help: { short: "h", type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf guide`'s one flag.
 *
 * - It throws on an unknown flag, which the caller turns into a usage error.
 */
function parseGuideCommandLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: { help: { short: "h", type: "boolean" } },
    strict: true,
  });
}

/** How to call `okf init`, printed for `--help` and after a usage error. */
export const INIT_USAGE = `usage: okf init [options]
       okf init --check [--copilot]

Writes the \`okf\` block of package.json, a block of agent instructions
between \`<!-- okf:start -->\` and \`<!-- okf:end -->\` in AGENTS.md, and the
okf-architecture, okf-record, and okf-review skills in .claude/skills. Run it
again to refresh the block and the skills; nothing outside the markers is
changed, and a skill folder it didn't write is refused.

options:
  --bundle <dir>  a bundle directory to configure; repeat for more
                  (default: keep \`okf.bundles\`)
  --by <actor>    who signs off (default: keep \`okf.verifiedBy\`)
  --copilot       write the block to .github/copilot-instructions.md too;
                  a file that already holds it is always refreshed
  --check         write nothing; fail when a block or a skill is missing or
                  out of date
  --help, -h      print this help`;

/** The flags and path an `okf new` run was given. */
export type NewOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * The producer passed with `--by`, written as `generated.by`.
   *
   * @example "claude-code/claude-opus-5-5"
   */
  by: string;

  /**
   * The `description` passed with `--description`, if any.
   *
   * @example "Every export returns a fallback instead of throwing."
   */
  description: string | undefined;

  /**
   * The record's path, relative to where the command was run.
   *
   * @example "docs/decisions/package-promise.md"
   */
  recordPath: string;

  /**
   * The tags passed with `--tag`, sorted, each once.
   *
   * @example `["api", "cli"]`
   */
  tags: readonly string[];

  /**
   * The `title` passed with `--title`, if any.
   *
   * @example "What every export promises"
   */
  title: string | undefined;

  /**
   * The record's `type`, passed with `--type`.
   *
   * @example "Decision"
   */
  type: string;
};

/** The flags and record paths an `okf touch` run was given. */
export type TouchOptions = {
  /**
   * Bundle directories passed with `--bundle`, relative to where the command
   * was run; empty means "use the config".
   *
   * @example `["docs/decisions"]`
   */
  bundles: readonly string[];

  /**
   * The producer passed with `--by`, written as `generated.by`.
   *
   * @example "claude-code/claude-opus-5-5"
   */
  by: string;

  /**
   * Record files named on the command line, relative to where it was run.
   *
   * @example `["docs/decisions/package-promise.md"]`
   */
  recordPaths: readonly string[];

  /**
   * Whether `--draft` asked to set a `stable` record back to `draft`.
   *
   * @example true
   */
  shouldDraft: boolean;
};

/** Read `okf init`'s command line into options, or say why it can't run. */
export function parseInitArgs(args: readonly string[]): ParsedInitArgs {
  let parsed: ReturnType<typeof parseInitCommandLine>;

  try {
    parsed = parseInitCommandLine(args);
  } catch (error) {
    return isHelpAsked(args)
      ? { kind: "help" }
      : { kind: "invalid", message: describeError(error) };
  }

  const { positionals, values } = parsed;

  if (values.help === true) {
    return { kind: "help" };
  }

  const options: InitOptions = {
    bundles: values.bundle ?? [],
    by: values.by,
    isCheck: values.check === true,
    shouldWriteCopilot: values.copilot === true,
  };

  const [extra] = positionals;

  if (extra !== undefined) {
    return {
      kind: "invalid",
      message: `okf init takes no paths, but was given ${extra}.`,
    };
  }

  if (options.bundles.includes("")) {
    return {
      kind: "invalid",
      message: "--bundle needs a directory, not an empty string.",
    };
  }

  if (
    options.isCheck &&
    (options.bundles.length > 0 || options.by !== undefined)
  ) {
    return {
      kind: "invalid",
      message: "--check writes nothing, so it takes no --bundle or --by.",
    };
  }

  return { kind: "options", options };
}

/**
 * Run `parseArgs` over `okf check`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseCheckLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      changed: { type: "boolean" },
      format: { type: "string" },
      help: { short: "h", type: "boolean" },
      strict: { type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf index`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseIndexLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      check: { type: "boolean" },
      help: { short: "h", type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf init`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseInitCommandLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      check: { type: "boolean" },
      copilot: { type: "boolean" },
      help: { short: "h", type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf migrate`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseMigrateLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      check: { type: "boolean" },
      help: { short: "h", type: "boolean" },
      write: { type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf status`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseStatusLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      changed: { type: "boolean" },
      draft: { type: "boolean" },
      format: { type: "string" },
      help: { short: "h", type: "boolean" },
      stale: { type: "boolean" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf tags`' flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseTagsLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      format: { type: "string" },
      help: { short: "h", type: "boolean" },
    },
    strict: true,
  });
}

/** How to call `okf new`, printed for `--help` and after a usage error. */
export const NEW_USAGE = `usage: okf new <record> --type <type> --by <producer> [options]

Writes a new record with only its frontmatter: its \`type\`, any title,
description, and tags given, \`status: draft\`, and \`generated\` stamped
with --by and the time from the clock. Then it syncs the index.md that
lists it, as \`okf index\` does. It never overwrites a file, never adds
\`verified\`, and writes nothing when either step can't be done.

options:
  --type <type>         the record's \`type\`, such as Decision
  --by <producer>       who wrote it, as \`<producer>/<version>\`
  --title <title>       its \`title\`
  --description <text>  its \`description\`, one sentence
  --tag <tag>           a tag; repeat for more
  --bundle <dir>        a bundle directory it goes in; repeat for more
                        (default: \`okf.bundles\` in package.json)
  --help, -h            print this help`;

/** How to call `okf touch`, printed for `--help` and after a usage error. */
export const TOUCH_USAGE = `usage: okf touch <record>... --by <producer> [--draft] [options]

Re-stamps each record's \`generated\` after an edit: \`by\` from --by, and
\`at\` from the clock, never a typed time. It changes nothing else, so a
signed-off record shows as changed until it's signed off again. It never
adds or changes \`verified\`, and writes nothing when any record refuses.

options:
  --by <producer>  who edited it, as \`<producer>/<version>\`
  --draft          set a \`stable\` record back to \`status: draft\`
  --bundle <dir>   a bundle directory the records are in; repeat for more
                   (default: \`okf.bundles\` in package.json)
  --help, -h       print this help`;

/** Read `okf new`'s command line into options, or say why it can't run. */
export function parseNewArgs(args: readonly string[]): ParsedArgs<NewOptions> {
  let parsed: ReturnType<typeof parseNewLine>;

  try {
    parsed = parseNewLine(args);
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

  const [recordPath, extra] = positionals;
  const bundles = values.bundle ?? [];
  const tags = [...new Set(values.tag ?? [])].sort();
  const { by, description, title, type } = values;

  if (recordPath === undefined || extra !== undefined) {
    return { kind: "invalid", message: "Name exactly one record to write." };
  }

  if (type === undefined || by === undefined) {
    return { kind: "invalid", message: "okf new needs --type and --by." };
  }

  const problem =
    findBundleFlagProblem(bundles) ??
    findTagProblem(tags) ??
    findTextProblem({
      "--by": [by],
      "--description": description === undefined ? [] : [description],
      "--tag": tags,
      "--title": title === undefined ? [] : [title],
      "--type": [type],
    });

  return problem === undefined
    ? {
        kind: "options",
        options: { bundles, by, description, recordPath, tags, title, type },
      }
    : { kind: "invalid", message: problem };
}

/** Read `okf touch`'s command line into options, or say why it can't run. */
export function parseTouchArgs(
  args: readonly string[]
): ParsedArgs<TouchOptions> {
  let parsed: ReturnType<typeof parseTouchLine>;

  try {
    parsed = parseTouchLine(args);
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

  const bundles = values.bundle ?? [];
  const { by } = values;

  if (positionals.length === 0) {
    return { kind: "invalid", message: "Name at least one record." };
  }

  if (by === undefined) {
    return { kind: "invalid", message: "okf touch needs --by." };
  }

  const problem = findBundleFlagProblem(bundles);

  return problem === undefined
    ? {
        kind: "options",
        options: {
          bundles,
          by,
          recordPaths: positionals,
          shouldDraft: values.draft === true,
        },
      }
    : { kind: "invalid", message: problem };
}

/**
 * Check the `--bundle` values.
 *
 * @returns the problem, or `undefined` when there is none.
 */
function findBundleFlagProblem(bundles: readonly string[]): string | undefined {
  return bundles.includes("")
    ? "--bundle needs a directory, not an empty string."
    : undefined;
}

/**
 * Check `--stale-in`: an ISO 8601 duration, such as `P90D`, of a second or
 * more that goes forward, and lands within the four-digit years a record's
 * times are written in.
 *
 * @returns the problem, or `undefined` when there is none or no flag.
 */
function findStaleInProblem(staleIn: string | undefined): string | undefined {
  if (staleIn === undefined) {
    return undefined;
  }

  const duration = Duration.fromISO(staleIn);

  // A sum past what a date can hold reads its year as NaN, which fails the
  // comparison too.
  const isWritable =
    duration.isValid &&
    Object.values(duration.toObject()).every((amount) => amount >= 0) &&
    duration.toMillis() >= 1000 &&
    DateTime.utc().plus(duration).year <= 9999;

  return isWritable
    ? undefined
    : `--stale-in ${JSON.stringify(staleIn)} isn't an ISO 8601 duration from a second to the year 9999, such as P90D or P6M.`;
}

/**
 * Check the `--tag` values: a tag holds no whitespace or backtick, since the
 * tag index writes each one in backticks and reads it back by them.
 *
 * @returns the problem with the first tag that has one, or `undefined`.
 */
function findTagProblem(tags: readonly string[]): string | undefined {
  const bad = tags.find((tag) => /[\s`]/u.test(tag));

  return bad === undefined
    ? undefined
    : `--tag ${JSON.stringify(bad)} can't hold whitespace or a backtick.`;
}

/**
 * Check the text flags `okf new` writes into the frontmatter: each must hold
 * something, on one line.
 *
 * @returns the problem with the first flag that has one, or `undefined`.
 */
function findTextProblem(
  values: Readonly<Record<string, readonly string[]>>
): string | undefined {
  for (const [flag, texts] of Object.entries(values)) {
    for (const text of texts) {
      if (text.trim() === "") {
        return `${flag} needs a value, not an empty string.`;
      }

      if (/[\n\r]/u.test(text)) {
        return `${flag} must be one line.`;
      }
    }
  }

  return undefined;
}

/**
 * Run `parseArgs` over `okf new`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseNewLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      description: { type: "string" },
      help: { short: "h", type: "boolean" },
      tag: { multiple: true, type: "string" },
      title: { type: "string" },
      type: { type: "string" },
    },
    strict: true,
  });
}

/**
 * Run `parseArgs` over `okf touch`'s flags.
 *
 * - It throws on an unknown flag or a missing value, which the caller turns
 *   into a usage error.
 */
function parseTouchLine(args: readonly string[]) {
  return parseArgs({
    allowPositionals: true,
    args: [...args],
    options: {
      bundle: { multiple: true, type: "string" },
      by: { type: "string" },
      draft: { type: "boolean" },
      help: { short: "h", type: "boolean" },
    },
    strict: true,
  });
}
