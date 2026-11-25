/*
 * The guidance for agents that `okf guide` prints, from the installed
 * version, so it never goes stale in a repo.
 *
 * - The intro and the record rules are shared with the agent block in
 *   `agent-block.ts`, and so with the README's Agents section, which quotes
 *   the block; the rules are written once.
 *
 * - The commands, and when an agent may run each, are only here: the block
 *   and `okf verify --help` point at `okf guide` for them.
 */

import type { ExitCode } from "./exit-codes.ts";
import type { Output } from "./output.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { GUIDE_USAGE, parseGuideArgs } from "./options.ts";
import { SKILLS } from "./skills.ts";

/** What the records are, the paragraph that opens the block and the guide. */
export const RECORDS_INTRO =
  "The Markdown files in the bundles that `okf.bundles` lists in `package.json` are [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) records. okf-tools follows OKF v0.3; `okf migrate` moves a v0.1 or v0.2 bundle to it.";

/** How an agent writes, edits, and verifies records, as Markdown bullets. */
export const RECORD_RULES = `- **Start a new record with \`okf new <record> --type <type> --by <producer>/<version>\`**, such as \`--by claude-code/2.1.316\`, which writes it as \`status: draft\` with \`generated\` stamped from the clock, and lists it in its index; then write its body.
- **When you edit a record, re-stamp it with \`okf touch <record>... --by <producer>/<version> --draft\`**, which sets \`generated\` from the clock and a \`stable\` one back to \`status: draft\`, keeping its \`verified\` entry, so it shows as changed until it's signed off again.
  - Never type \`generated.at\` by hand; a wrong time makes a record look changed, or not.
- **Never add or change a \`verified\` entry yourself.** Signing a record off is the person's call.
- **Verify only when the person asks you to**, with \`okf verify --yes <record>...\`, naming the files they approved.
  - Pass \`--changed\` instead only when they asked for every changed record.
  - Never verify a record as a side effect of drafting or editing it.
- **Write \`tags\` as a block list**, one \`- tag\` per line, sorted, in kebab-case.
  - Give each record 5 to 10 specific tags, reusing the bundle's existing tags where one fits.
  - List the tags the bundles already use with \`okf tags\`, which reads every layout, rather than \`grep\`.`;

/** Each command, and when an agent may run it, as Markdown bullets. */
const COMMAND_RULES = `- **\`okf status\`** lists every record's trust state, and writes nothing. Run it whenever you need to know which records are draft, changed, or stale; \`--format json\` prints it for a program.
- **\`okf diff <record>...\`** prints what changed in each record since its last sign-off, and writes nothing. Run it to show the person what they would be signing off.
- **\`okf verify --yes <record>...\`** signs records off and commits just those files, or with \`--no-commit\` leaves committing to the person. Run it only when the person asks you to, as the rules above say.
  - It signs as the configured \`okf.verifiedBy\`, the person, since the approval is theirs; never pass \`--by\` with your own name.
  - Pass \`--stale-in <duration>\`, such as \`P90D\`, only when the person says how long the sign-off holds; it sets each record's \`stale_after\` that long after the sign-off.
- **\`okf verify\`** without \`--yes\` asks in a terminal which records to sign off. It's for the person, not for you.
- **\`okf check\`** reports problems in the bundles against OKF's spec rules, and writes nothing. Run it whenever you like, and after editing records, before you hand back; fix each error it reports in the files you touched. \`--format json\` prints it for a program.
- **\`okf tags\`** lists every tag in the bundles with its record count, and writes nothing. Run it whenever you choose a record's tags; \`--format json\` prints it for a program.
- **\`okf index\`** rewrites each \`index.md\` line that links to a record from the record's title and description, and lists records no line does. Run it after you add, remove, or retitle a record, in the same change.
  - \`okf index --check\` writes nothing, so run it whenever you like.
- **\`okf new <record>\`** writes a draft record's frontmatter, stamped from the clock, and its index line. Run it whenever you start a record, before writing its body.
- **\`okf touch <record>...\`** re-stamps \`generated\` from the clock, and with \`--draft\` sets a \`stable\` record back to draft. Run it after every edit to a record, in the same change.
- **\`okf deprecate <record>... --by <producer>/<version>\`** marks records \`status: deprecated\`, kept for links and history, and re-stamps \`generated\` as \`okf touch\` does; \`--superseded-by <record>\` names the record that replaces them. Run it when a change retires or replaces a record, in place of deleting it.
- **\`okf migrate\`** prints the changes that move each bundle from OKF v0.1 or v0.2 to v0.3, and writes nothing; \`--write\` applies them. Run it bare whenever you like, but pass \`--write\` only when the person asks you to migrate.
  - \`okf migrate --check\` writes nothing, and fails while a bundle still needs migrating.
- **\`okf init\`** writes the \`okf\` config, the agent block, and the okf skills in \`.claude/skills\`. Run it only when the person asks you to set up okf-tools, or to refresh the block or the skills.
  - \`okf init --check\` writes nothing, so run it whenever you like.
- **\`okf guide\`** prints this guide.`;

/**
 * The whole guide `okf guide` prints, as Markdown with `\n` line breaks.
 *
 * - It's the shared rules, then the commands, then the skills `okf init`
 *   installs, so an agent reading the repo's block learns nothing here that
 *   contradicts it.
 */
export const GUIDE: string = [
  "# OKF records",
  RECORDS_INTRO,
  "This guide comes from the version of okf-tools installed in the repo, so it matches the commands you have. Run each through the repo's package manager, such as `pnpm exec okf status`.",
  "## Rules",
  RECORD_RULES,
  "## Commands",
  COMMAND_RULES,
  "Run `okf <command> --help` for a command's flags.",
  "## Skills",
  "`okf init` installs these skills in `.claude/skills`, from the same version as this guide. Load the one that fits the task:",
  SKILLS.map(
    ({ description, name }) => `- **\`${name}\`**: ${description}`
  ).join("\n"),
].join("\n\n");

/**
 * Run `okf guide`: print the guide, or its usage.
 *
 * - The guide prints as it is, with no `[okf]` prefix, so it reads as the
 *   Markdown it is; its usage, for `--help` or an error, is prefixed.
 *
 * @returns the exit code.
 */
export function runGuide(params: {
  /**
   * The arguments after `guide`.
   *
   * @example `["--help"]`
   */
  args: readonly string[];

  /**
   * Where the guide and any error print.
   *
   * @example `createOutput("okf")`
   */
  output: Output;
}): ExitCode {
  const { args, output } = params;
  const parsed = parseGuideArgs(args);

  if (parsed.kind === "help") {
    output.info(GUIDE_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${GUIDE_USAGE}`);

    return EXIT_CODES.failure;
  }

  output.data(GUIDE);

  return EXIT_CODES.ok;
}
