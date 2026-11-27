/*
 * The Agent Skills `okf init` installs in a repo, and the pure logic that
 * decides whether each installed copy is current.
 *
 * - The CLI owns the clock and the sign-off; a skill is instructions an agent
 *   can skip or misremember, so each one stamps through `okf new` and
 *   `okf touch` and leaves `verified` to `okf verify`.
 *
 * - What goes in a record is upstream's `okf-generate` skill's job, so the
 *   record skill points there rather than restating it.
 */

import { TAG_RULES } from "./tag-rules.ts";

/** A skill `okf init` installs, as the `SKILL.md` it writes. */
export type Skill = {
  /**
   * When an agent should load it, as its frontmatter's `description` holds.
   *
   * @example "Draft or edit an Open Knowledge Format (OKF) record…"
   */
  description: string;

  /**
   * The skill's name, which is also its folder's.
   *
   * @example "okf-record"
   */
  name: string;

  /**
   * The whole `SKILL.md`, frontmatter first, with `\n` line breaks.
   *
   * @example `"---\nname: okf-record\n…"`
   */
  text: string;
};

/** Where an installed `SKILL.md` stands against the one `okf init` writes. */
export type SkillState =
  /** It matches the installed version's text. */
  | "current"
  /** Something is there that `okf init` didn't write, so it's left alone. */
  | "foreign"
  /** Nothing is there yet. */
  | "missing"
  /** An earlier `okf init` wrote it, and the text has changed since. */
  | "stale";

/**
 * The opening of the line every installed skill carries after its
 * frontmatter, which marks it as `okf init`'s to rewrite.
 */
export const SKILL_MARKER_PREFIX =
  "<!-- Written by `okf init` from @jjloneman/okf-tools.";

/** The line after each skill's frontmatter, from `SKILL_MARKER_PREFIX`. */
const SKILL_MARKER = `${SKILL_MARKER_PREFIX} Run it again to refresh this skill; to change it, copy it to a folder with another name, set \`name\` to that name, and delete this line. -->`;

/** Upstream's content skill, at the commit okf-tools follows. */
const OKF_GENERATE_URL =
  "https://github.com/open-knowledge-format/open-knowledge-format/tree/527e81aff55992be21507e97004286789126f88c/skills/okf-generate";

/** How to run a command, shared by every skill. */
const RUN_LINE =
  "Run every `okf` command through the repo's package manager, such as `pnpm exec okf status`. `okf guide` prints every command and when you may run each, from the installed version.";

/** The record skill: the trust workflow around writing a record. */
const RECORD_BODY = [
  "# Draft an OKF record",
  "",
  `This skill is the trust workflow okf-tools owns in this repo: who stamps a record, when it's a draft, and who signs it off. For what goes in a record, such as its sources, footnotes, type, links, and index lines, follow upstream's [okf-generate](${OKF_GENERATE_URL}) skill for OKF v0.3, or the [spec](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) when it isn't installed. Where the two differ, this skill wins in this repo.`,
  "",
  RUN_LINE,
  "",
  "## Rules",
  "",
  "1. **okf-tools never writes `verified`, and neither do you.** Never add, change, or remove a `verified` entry, even when the person says the content is right. Signing a record off is the person's call, made with `okf verify`.",
  "   - okf-generate differs here: it records a `human:<id>` verification once the person confirms the content. In this repo, tell them to run `okf verify` instead.",
  "   - Run `okf verify --yes <record>...` only when the person asks you to verify, naming the records they approved; pass `--changed` instead only when they asked for every changed record. Never verify a record as a side effect of writing it.",
  "2. **The CLI owns the clock.** Never type `generated.at`, or any other timestamp: a wrong time makes a record look changed, or signed off, when it isn't. `okf new` and `okf touch` take the time from the clock.",
  "3. **A record you write or edit stays `status: draft`** until the person signs it off, unless you changed only its `tags` or the order of its `sources`, which keeps its status.",
  "4. **Record yourself in `generated.by`** with `--by <producer>/<version>`, such as `--by claude-code/2.1.316`; never the person, whose actor `okf.verifiedBy` in `package.json` holds for signing off.",
  "",
  "## Start a record",
  "",
  "1. Read the bundle's `index.md` for the types and folders it already uses, and list its tags with `okf tags`.",
  '2. Run `okf new <record> --type <type> --by <producer>/<version> --title "<title>" --description "<one sentence>" --tag <tag>...`. It writes the frontmatter as `status: draft`, with `generated` stamped from the clock, and syncs the `index.md` that lists it. It refuses a path anything is already at.',
  "3. Write the body under an `# <title>` heading that repeats the frontmatter's `title`, and add any other frontmatter, such as `sources`, as okf-generate says. Write each `--tag` once per tag.",
  "   - List in `sources` each repo file or folder the record was written from, with `resource` relative to the record's folder, such as `../../src/git.ts`, and footnote each claim it rests on with a footnote whose label is the source's `id`, such as `[^git]`. `okf check` then warns when a cited file changes after the record was written or signed off. Cite files, or a folder only when the record covers all of it, and leave out a file nearly every change touches, such as `package.json`, which would warn on every release.",
  "",
  "## Edit a record",
  "",
  "1. Run `okf status <record>` first, for a record that existed before this change. One with a `verified` entry describes something the person signed off, so tell them what you're changing and why.",
  "2. Make the edit, keeping its `verified` history and the text you don't mean to change.",
  "   - Add a `sources` entry for each repo file or folder the edit rests on, footnoted by its `id` on the claim it supports, and remove one the record no longer rests on, with its footnotes.",
  "3. Run `okf touch <record>... --by <producer>/<version> --draft` after every edit, a link-only one included, unless it changed only `tags` or the order of `sources`, such as `okf format` makes. It re-stamps `generated` from the clock and sets a `stable` record back to `status: draft`, keeping its `verified` entry, so it shows as changed until it's signed off again.",
  "4. After a change to a record's title, description, or tags, or a new or removed record, run `okf index` in the same change.",
  "",
  "## Tags",
  "",
  TAG_RULES,
  "",
  "## Audit a bundle's tags",
  "",
  "When the person asks you to audit a bundle's tags, or to fill out sparse ones:",
  "",
  "1. Find the records to retag. When `okf.rules` in `package.json` turns `tags-count` on, run `okf check --format json` and take the `path` of each finding whose `rule` is `tags-count`. `okf check` exits 1 when any finding is an error, but still prints the report, so read it either way. Otherwise read each record's `tags`, in whichever layout it's written, and take each with fewer than 5 or more than 10.",
  "2. Run `okf tags` for the bundle's vocabulary, then read each record you took.",
  "3. Propose a list for each, by the rules above, in one table for the person: the record, its tags now, and the tags you propose, with each new tag marked. Write nothing yet.",
  "   - Name each near-duplicate pair the bundle already has, such as `brew` and `homebrew`, so the person picks one name.",
  "4. Write only the lists the person approves, in the layout the rules above give, changing nothing else in each record. Don't run `okf touch`: a change to `tags` alone keeps `generated` and `status`, so a signed-off record stays signed off.",
  "5. Run `okf index`, which syncs each tag index, then `okf check`, and tell the person which records you retagged; `okf diff <record>` shows each one's change.",
  "",
  "## Hand it over",
  "",
  "Run `okf index --check`, then tell the person:",
  "",
  "- each record you created or changed, all of them drafts awaiting their sign-off, apart from the ones you only retagged, which keep their status;",
  "- that `okf diff <record>` shows what changed since they last signed one off;",
  "- that they sign records off with `okf verify`, or by asking you to.",
].join("\n");

/** The review skill: what changed since the last sign-off, for the person. */
const REVIEW_BODY = [
  "# Review OKF records before sign-off",
  "",
  "This skill reads a repo's OKF records and tells the person what changed in each since they last signed it off, so they can decide what to verify. It writes nothing, and it never verifies: signing off is the person's call, made with `okf verify`.",
  "",
  RUN_LINE,
  "",
  "## Find the records",
  "",
  "1. Run `okf status --format json`, or name the records the person asked about. Each record's `group` says where it stands with the person's sign-off:",
  "   - `changed`: signed off, then edited since, so the sign-off no longer holds;",
  "   - `draft`: `status: draft`, and not edited since any sign-off it has;",
  "   - `unverified`: never signed off;",
  "   - `stale`: signed off and unchanged, but past its `stale_after`;",
  "   - `settled`: nothing to review.",
  "2. Review the `changed`, `draft`, and `unverified` records, and the `stale` ones when the person asks. Read the `skipped` list too: a file `okf status` can't read can't be signed off until it's fixed.",
  "",
  "## Read each one",
  "",
  "1. Run `okf diff <record>`. It prints the diff since the person's last sign-off, or the whole record when there's none to diff from.",
  "2. Read the record as it is now, and its sources where a claim depends on them.",
  "3. Note, for the person:",
  "   - **what it says**, in one line;",
  "   - **what changed in meaning:** a decision added, reversed, or dropped, a fact or a number changed, a rejected option added; and, named apart, changes only of wording, links, or layout;",
  "   - **what to check:** a claim with no source or footnote, a claim about code to check against that code (name the file), a date or version that can drift, and anything another record contradicts;",
  "   - **for a stale record:** whether its sources still say what it does.",
  "",
  "## Report",
  "",
  '1. Open with a table: each record, its group, the size of its change (the lines `okf diff` shows changed, or "whole record" when it was never signed off), and your read of it: ready to sign off, needs a look, or needs fixing. Say that your read is a suggestion, and that the decision is theirs.',
  "2. Then one short section per record, in the table's order, with the notes above.",
  "3. End with how to sign off: `okf verify`, which asks in a terminal and shows the same diffs, or `okf verify --yes <record>...` for the ones they're ready to sign, which they can also ask you to run.",
  "",
  "## Rules",
  "",
  "- **Never edit a record while reviewing it.** When the person asks for a fix, make it as the okf-record skill says, and it's a draft again.",
  "- **Never verify on your own judgment.** Run `okf verify --yes <record>...` only when the person asks you to, naming exactly the records they approved, and `--changed` only when they asked for every changed record.",
  "- **Never add or change a `verified` entry by hand**, and never type a timestamp.",
].join("\n");

/** The architecture skill: create, update, or audit an architecture record. */
const ARCHITECTURE_BODY = [
  "# Write an architecture record",
  "",
  "An architecture record is an OKF record of `type: Architecture` that says how a codebase, or one part of it, is put together, written only from the code it lists in `sources`. This skill creates one, updates one after the code moves, or audits one against the code. Follow the okf-record skill's rules throughout: the record stays a draft, the CLI stamps it, and only the person signs it off, so never add or change a `verified` entry.",
  "",
  RUN_LINE,
  "",
  "Pick the mode from the person's request, and ask when it isn't clear:",
  "",
  "- **create** a record that doesn't exist yet;",
  "- **update** one whose code has changed, rewriting only what that change touched;",
  "- **audit** one against the code, reporting and editing nothing.",
  "",
  "## The record",
  "",
  "- **`sources`** lists each file or folder the record was written from, as a block list of `id`, `resource`, and `title`. Write `resource` relative to the record's folder, such as `../../src/cli.ts`, and `id` in kebab-case, such as `cli`.",
  "- **Every claim cites its source** with a footnote whose label is a source's `id`, such as `Every git call goes through one module.[^git]`, defined once at the end of the body as `[^git]: <the source's title>`. That's how an update finds the sections a change touched.",
  "- **The body follows this outline**, leaving a section out only when it would be empty:",
  "",
  "  ```md",
  "  # <title>",
  "",
  "  One to three paragraphs: what the code is, what it's for, and what this record covers.",
  "",
  "  ## Components",
  "",
  "  One bullet per module or folder: what it owns, and what it leaves to others.",
  "",
  "  ## Data flow",
  "",
  "  Numbered steps: how a request, a command, or a run moves through the components.",
  "",
  "  ## Boundaries",
  "",
  "  What calls in and what it calls out to: the public API, the file system, the network, other services.",
  "",
  "  ## Invariants",
  "",
  "  Rules the code keeps everywhere, such as which module alone does a kind of work.",
  "",
  "  ## Decisions",
  "",
  "  Links to the decision records that say why it's built this way.",
  "",
  "  ## Caveats",
  "",
  "  Known gaps, and what this record leaves out.",
  "  ```",
  "",
  "- **The opening paragraphs end with `Written from commit <sha>.`**, the short hash `git rev-parse --short HEAD` printed when you read the code. An update diffs the code from that commit, so set it again whenever you rewrite the record from newer code.",
  "- **Write only what the code shows.** Leave intent the code doesn't show out, or name it as the person's, and never guess at code you didn't read.",
  "",
  "## Create",
  "",
  "1. Agree the scope with the person, the whole repo or one part of it, and where the record goes.",
  "2. Read the code: the entry points first, then each module they reach. Keep a list of what you read; it becomes `sources`.",
  '3. Run `okf new <record> --type Architecture --by <producer>/<version> --title "<title>" --description "<one sentence>" --tag <tag>...`, with one `--tag` per tag.',
  "4. Add `sources` to the frontmatter, then write the body in the outline above, citing a source for every claim.",
  "5. Run `okf index --check`, and tell the person the record is a draft for them to review and sign off.",
  "",
  "## Update",
  "",
  "1. Read the commit in the record's `Written from commit` line. Never use the last commit to touch the record, or its `generated.at`, which a sign-off, a re-stamp, or a link fix moves on without reading the code. When the line is missing, say so, and ask the person which commit to diff from.",
  "2. Resolve each source's `resource` from the record's folder to a path from the repo root, then, from the repo root, list what changed in them since, committed or not: `git diff --stat <commit> -- <each path>`, and read the diffs. For a source that's a folder, look for files added to it since, too.",
  "3. When nothing changed, say so and stop: an update with nothing to change writes nothing.",
  "4. Find the sections whose footnotes cite a changed source, and rewrite only those, leaving every other section word for word. Add a source for new code the record should cover, and remove a deleted file's source with the claims that cite it.",
  "5. Set the `Written from commit` line to the commit you read the code at, run `okf touch <record> --by <producer>/<version> --draft`, and `okf index` if the title or description changed. Then tell the person which sections changed, and why.",
  "",
  "## Audit",
  "",
  "1. Read the record, then each claim's cited source as it is now.",
  "2. Give each claim one verdict:",
  "   - **holds:** the code still does what it says;",
  "   - **stale:** the code changed, and the claim no longer matches;",
  "   - **wrong:** the code never did what it says;",
  "   - **unsourced:** it cites no source;",
  "   - **gone:** its source no longer exists.",
  "3. List what the sourced code has that the record leaves out, such as a module in a sourced folder that no section names.",
  "4. Report one table: the section, the claim in a few words, each source it cites, the verdict, and the evidence as `file:line`. Edit nothing and run no `okf touch`; offer an update for the stale, wrong, and gone rows.",
].join("\n");

/**
 * Where `okf init` writes a skill, from the repo root, in the folder Claude
 * Code reads a repo's skills from.
 *
 * @returns the path, with `/` separators.
 */
export function skillFilePath(name: string): string {
  return `.claude/skills/${name}/SKILL.md`;
}

/**
 * Build a skill's `SKILL.md`: its frontmatter, the marker line, and its body.
 *
 * @returns the skill.
 */
function buildSkill(params: {
  /**
   * The skill's Markdown body, from its title heading.
   *
   * @example "# Draft an OKF record"
   */
  body: string;

  /**
   * When an agent should load it, one paragraph, which every agent reads.
   *
   * @example "Draft or edit an OKF record…"
   */
  description: string;

  /**
   * Its name, which is its folder's too.
   *
   * @example "okf-record"
   */
  name: string;
}): Skill {
  const { body, description, name } = params;

  // Double-quoted, so a colon in the description can't end the YAML value.
  const text = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    SKILL_MARKER,
    "",
    body,
    "",
  ].join("\n");

  return { description, name, text };
}

/** The skills `okf init` installs, sorted by name. */
export const SKILLS: readonly Skill[] = [
  buildSkill({
    body: ARCHITECTURE_BODY,
    description:
      "Create, update, or audit an architecture record: an Open Knowledge Format (OKF) record of type Architecture that says how a codebase, or one part of it, is put together, written from the code it lists in sources. Use this skill when the person asks to document a repo's or a module's architecture, to bring an architecture record up to date after the code changed, or to check one against the code.",
    name: "okf-architecture",
  }),
  buildSkill({
    body: RECORD_BODY,
    description:
      "Draft or edit an Open Knowledge Format (OKF) record in a repo that uses okf-tools, keeping its trust state honest: start it with okf new, re-stamp it with okf touch, leave it a draft, and never write verified. Use this skill whenever you create, rewrite, retitle, or retag a record, or audit sparse tags, in a bundle that okf.bundles in package.json lists, alongside upstream's okf-generate skill for what to write.",
    name: "okf-record",
  }),
  buildSkill({
    body: REVIEW_BODY,
    description:
      "Summarize what changed in a repo's Open Knowledge Format (OKF) records since the person last signed each off, so they can decide what to verify. Use this skill when the person asks which records need review or sign-off, what changed in the records or decisions, or to walk them through the drafts before they run okf verify. It reads only, and never verifies.",
    name: "okf-review",
  }),
];

/**
 * Judge an installed `SKILL.md` against the text `okf init` writes.
 *
 * - A file without the marker line is someone else's, such as a skill of
 *   their own that shares the name, so it's never overwritten.
 *
 * @returns where the file stands.
 */
export function judgeSkill(params: {
  /**
   * The installed file's text, or `undefined` when there's none.
   *
   * @example `"---\nname: okf-record\n…"`
   */
  installed: string | undefined;

  /**
   * The skill as this version writes it.
   *
   * @example `SKILLS[0]`
   */
  skill: Skill;
}): SkillState {
  const { installed, skill } = params;

  if (installed === undefined) {
    return "missing";
  }

  // A CRLF checkout of the same text is current, as git normalizes it back.
  if (installed.replaceAll("\r\n", "\n") === skill.text) {
    return "current";
  }

  const isOurs = installed
    .split(/\r?\n/u)
    .some((line) => line.startsWith(SKILL_MARKER_PREFIX));

  return isOurs ? "stale" : "foreign";
}
