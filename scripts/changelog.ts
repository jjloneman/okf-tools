/*
 * The changesets changelog formatter, named by `changelog` in
 * `.changeset/config.json`.
 *
 * - Each line takes the gitmoji and scope from the subject of the commit that
 *   added the changeset, which after a squash merge is the PR title:
 *   `- ✨ **okf-verify:** <summary> (<short hash>)`.
 *
 * - changesets `import()`s this file itself, so it runs under Node's type
 *   stripping: erasable syntax only, and `.ts` import specifiers.
 *
 * - It lives outside `src/`, so it is never bundled or published.
 */
import path from "node:path";

import { describeError } from "../src/output.ts";
import { runGit } from "../src/repo.ts";

/** A changeset as changesets passes it to the formatter. */
export type ChangesetWithCommit = {
  /**
   * The hash of the commit that added the changeset, when git found one.
   *
   * @example "b4fc42d0d5a0e1f2c3b4a5968778695a4b3c2d1e"
   */
  commit?: string;

  /**
   * The changeset's markdown body, which may span several lines.
   *
   * @example "Add `okf-verify`, which marks OKF records `status: stable`."
   */
  summary: string;
};

/** The parts of a `<type>(<scope>)!: <gitmoji> <subject>` commit subject. */
export type ConventionalSubject = {
  /**
   * The gitmoji after the colon, when there is one.
   *
   * @example "✨"
   */
  gitmoji?: string;

  /**
   * Whether the type carries the breaking-change `!`.
   *
   * @example true
   */
  isBreaking: boolean;

  /**
   * The scope in parentheses, when there is one.
   *
   * @example "okf-verify"
   */
  scope?: string;
};

/*
 * One gitmoji: a pictograph with an optional skin tone and variation
 * selector, optionally joined to more of the same.
 *
 * - `🏗️` and `⬆️` match whole, and a plain first word never does.
 *
 * - Escapes rather than the literal characters, since the variation selector
 *   and the joiner are invisible in an editor.
 */
const PICTOGRAPH_SOURCE =
  String.raw`\p{Extended_Pictographic}` +
  String.raw`\p{Emoji_Modifier}?\u{FE0F}?`;
const GITMOJI_SOURCE =
  PICTOGRAPH_SOURCE + String.raw`(?:\u{200D}${PICTOGRAPH_SOURCE})*`;

/** What git prints when the commit to read doesn't exist. */
const COMMIT_NOT_FOUND_PATTERN = /bad object|bad revision|unknown revision/u;

/** The repo root, which this file sits one directory below. */
export const REPO_ROOT: string = path.resolve(import.meta.dirname, "..");

/*
 * Subjects already read, keyed by repo root and hash.
 *
 * - changesets asks for one line at a time, so the calls can't be batched;
 *   a commit that added several changesets is still read only once.
 */
const SUBJECT_CACHE = new Map<string, string | undefined>();

/** The length git abbreviates a hash to in this repo's history. */
const SHORT_HASH_LENGTH = 7;

/*
 * A conventional-commit subject: the type, an optional scope and `!`, then
 * an optional gitmoji before the description.
 */
const SUBJECT_PATTERN = new RegExp(
  String.raw`^\w+(?:\((?<scope>[^()]+)\))?(?<breaking>!)?: ` +
    String.raw`(?:(?<gitmoji>${GITMOJI_SOURCE})\s+)?\S`,
  "u"
);

/**
 * Build a changeset's line, reading its commit's subject from `cwd`.
 *
 * @returns the markdown list item.
 */
export function buildReleaseLine({
  changeset,
  cwd,
}: {
  /** The changeset the line describes. */
  changeset: ChangesetWithCommit;

  /**
   * The repo whose history holds the changeset's commit.
   *
   * @example "/Users/me/okf-tools"
   */
  cwd: string;
}): string {
  return formatReleaseLine({
    changeset,
    subject:
      changeset.commit === undefined
        ? undefined
        : readCommitSubject({ cwd, hash: changeset.commit }),
  });
}

/**
 * Build one changelog line from a changeset and its commit's subject.
 *
 * - With no subject (the commit couldn't be read, such as a hash from before
 *   a squash), the line is the bare summary, without a hash to a commit that
 *   isn't on `main`.
 *
 * - A summary's later lines are indented under the bullet, as changesets'
 *   default formatter does.
 *
 * @returns the markdown list item.
 */
export function formatReleaseLine({
  changeset,
  subject,
}: {
  /** The changeset the line describes. */
  changeset: ChangesetWithCommit;

  /**
   * The subject of the commit that added it, or `undefined` when unreadable.
   *
   * @example "feat(okf-verify): ✨ extract okf:verify into a package (#2)"
   */
  subject: string | undefined;
}): string {
  const [firstLine, ...laterLines] = changeset.summary
    .trim()
    .split("\n")
    .map((line) => line.trimEnd());

  const { gitmoji, isBreaking, scope }: Partial<ConventionalSubject> =
    subject === undefined ? {} : parseConventionalSubject(subject);

  const parts = [
    gitmoji,
    scope === undefined ? undefined : `**${scope}:**`,
    isBreaking === true ? "**Breaking:**" : undefined,
    firstLine,
    subject === undefined || changeset.commit === undefined
      ? undefined
      : `(${changeset.commit.slice(0, SHORT_HASH_LENGTH)})`,
  ].filter((part) => part !== undefined && part !== "");

  return [
    `- ${parts.join(" ")}`,
    ...laterLines.map((line) => (line === "" ? line : `  ${line}`)),
  ].join("\n");
}

/**
 * The changelog line for dependency bumps, which this single-package repo
 * never has.
 *
 * @returns an empty string, which changesets leaves out of the changelog.
 */
export function getDependencyReleaseLine(): string {
  return "";
}

/**
 * The changesets entry point for one changeset's line.
 *
 * - Reads git from this repo's root rather than the process's directory,
 *   since changesets passes the formatter no directory.
 *
 * @returns the markdown list item.
 */
export function getReleaseLine(changeset: ChangesetWithCommit): string {
  return buildReleaseLine({ changeset, cwd: REPO_ROOT });
}

/**
 * Read the gitmoji, scope, and breaking-change marker from a
 * conventional-commit subject.
 *
 * @returns the parts found; none are set when the subject doesn't parse.
 */
export function parseConventionalSubject(subject: string): ConventionalSubject {
  const groups = SUBJECT_PATTERN.exec(subject)?.groups;

  return {
    ...(groups?.gitmoji === undefined ? {} : { gitmoji: groups.gitmoji }),
    isBreaking: groups?.breaking !== undefined,
    ...(groups?.scope === undefined ? {} : { scope: groups.scope }),
  };
}

/**
 * Read a commit's subject line, once per repo and hash.
 *
 * @returns the subject, or `undefined` when git can't find the commit.
 */
export function readCommitSubject({
  cwd,
  hash,
}: {
  /**
   * The repo to read from.
   *
   * @example "/Users/me/okf-tools"
   */
  cwd: string;

  /**
   * The commit to read.
   *
   * @example "b4fc42d"
   */
  hash: string;
}): string | undefined {
  const key = `${cwd}\0${hash}`;

  if (!SUBJECT_CACHE.has(key)) {
    SUBJECT_CACHE.set(key, readUncachedSubject({ cwd, hash }));
  }

  return SUBJECT_CACHE.get(key);
}

/**
 * Ask git for a commit's subject line.
 *
 * @returns the subject, or `undefined` when git can't find the commit.
 */
function readUncachedSubject({
  cwd,
  hash,
}: {
  /** The repo to read from. */
  cwd: string;

  /** The commit to read. */
  hash: string;
}): string | undefined {
  try {
    return runGit({
      args: ["log", "-1", "--format=%s", `${hash}^{commit}`, "--"],
      repoRoot: cwd,
    }).trim();
  } catch (error: unknown) {
    // execFileSync's message carries git's stderr. A hash from before a
    // squash is expected; anything else is worth a look.
    const message = describeError(error);

    if (!COMMIT_NOT_FOUND_PATTERN.test(message)) {
      console.warn(
        `[changelog] couldn't read commit ${hash}, so its line has no ` +
          `gitmoji or scope: ${message.trim()}`
      );
    }

    return undefined;
  }
}
