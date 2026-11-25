/*
 * `okf init`: write the `okf` config and the agent-instructions block, or,
 * with `--check`, only say whether the block is current.
 *
 * - Every file is planned before any is written, so a refusal in one leaves
 *   all of them untouched.
 *
 * - It never commits; the person reviews and commits what it wrote.
 */
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { InitOptions } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { Output } from "./output.ts";

import { findBlock, writeBlock } from "./agent-block.ts";
import {
  describeBadActor,
  describeNoBundles,
  isActor,
  isPlainObject,
  readOkfConfig,
  selectBundleDirs,
} from "./config.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { findRepoRoot } from "./git.ts";
import { INIT_USAGE, parseInitArgs } from "./options.ts";
import { describeError } from "./output.ts";
import { writeOkfMember } from "./package-json.ts";
import { resolveBundleDirs } from "./repo.ts";
import { spellLikeRepoRoot } from "./working-directory.ts";

/** A file `okf init` will write, and the text it will hold. */
type PlannedWrite = {
  /**
   * The file, from the repo root, with `/` separators.
   *
   * @example "AGENTS.md"
   */
  filePath: string;

  /**
   * Whether the file exists yet.
   *
   * @example true
   */
  isNew: boolean;

  /**
   * The text to write.
   *
   * @example `"# Agents\n\n<!-- okf:start -->\n…"`
   */
  text: string;
};

/** An instruction file the block goes in, read from the repo. */
type Target = {
  /**
   * The file, from the repo root, with `/` separators.
   *
   * @example "AGENTS.md"
   */
  filePath: string;

  /**
   * The file's text, or `undefined` when it doesn't exist.
   *
   * @example `"# Agents\n"`
   */
  text: string | undefined;
};

/** The instruction file every run writes the block to. */
const AGENTS_PATH = "AGENTS.md";

/** The instruction file `--copilot` adds, refreshed whenever it holds a block. */
const COPILOT_PATH = ".github/copilot-instructions.md";

/**
 * Run `okf init` with its arguments, after the command's name.
 *
 * - Never throws; an unexpected error prints and ends with exit code `1`.
 *
 * @returns the exit code.
 */
export function runInit(params: {
  /**
   * The arguments after `init`.
   *
   * @example `["--bundle", "docs/decisions"]`
   */
  args: readonly string[];

  /**
   * The directory the command was run from.
   *
   * @example "/repo"
   */
  cwd: string;

  /**
   * Where the run prints its lines.
   *
   * @example `createOutput("okf")`
   */
  output: Output;
}): ExitCode {
  const { args, output } = params;
  const parsed = parseInitArgs(args);

  if (parsed.kind === "help") {
    output.info(INIT_USAGE);

    return EXIT_CODES.ok;
  }

  if (parsed.kind === "invalid") {
    output.error(`${parsed.message}\n\n${INIT_USAGE}`);

    return EXIT_CODES.failure;
  }

  try {
    const root = findRepoRoot(params.cwd);

    if (!root.isOk) {
      output.error(root.reason);

      return EXIT_CODES.failure;
    }

    const repoRoot = root.value;
    const cwd = spellLikeRepoRoot({ cwd: params.cwd, repoRoot });
    const { options } = parsed;
    const targets = readTargets({ options, repoRoot });

    if (!targets.isOk) {
      output.error(targets.reason);

      return EXIT_CODES.failure;
    }

    return options.isCheck
      ? checkBlocks({ output, targets: targets.value })
      : writeAll({ cwd, options, output, repoRoot, targets: targets.value });
  } catch (error) {
    output.error(describeError(error));

    return EXIT_CODES.failure;
  }
}

/**
 * Say whether each target holds the current block, writing nothing.
 *
 * @returns `0` when every block is current, else `1`.
 */
function checkBlocks(params: {
  output: Output;
  targets: readonly Target[];
}): ExitCode {
  const { output, targets } = params;
  let isCurrent = true;

  for (const { filePath, text } of targets) {
    const problem = findCheckProblem(text);

    if (problem === undefined) {
      output.info(`${filePath}'s okf block is up to date.`);
    } else {
      isCurrent = false;
      output.error(`${filePath} ${problem}`);
    }
  }

  return isCurrent ? EXIT_CODES.ok : EXIT_CODES.failure;
}

/**
 * Say what keeps a file's block from being current.
 *
 * @returns the problem, after the file's name, or `undefined` when current.
 */
function findCheckProblem(text: string | undefined): string | undefined {
  if (text === undefined) {
    return "doesn't exist; run okf init to write it.";
  }

  const update = writeBlock(text);

  if (!update.isOk) {
    return `${update.problem}; fix the markers by hand.`;
  }

  if (findBlock(text).kind === "absent") {
    return "has no okf block; run okf init to add it.";
  }

  return update.text === text
    ? undefined
    : "has an out-of-date okf block; run okf init to refresh it.";
}

/**
 * Whether anything is at a path, a broken symlink included, which
 * `existsSync` reports as missing.
 */
function isPresent(filePath: string): boolean {
  try {
    lstatSync(filePath);

    return true;
  } catch {
    return false;
  }
}

/**
 * Plan the `okf` block of `package.json`: the flags over what's there.
 *
 * - `--bundle` replaces `okf.bundles`, stored from the repo root; `--by`
 *   replaces `okf.verifiedBy`. Every other key is kept, in its place, and
 *   only the `okf` member's text changes (see `writeOkfMember`).
 *
 * - `package.json` is read as the instruction files are, so one linked from
 *   outside the repo is refused rather than written through.
 *
 * - The bundles must exist inside the repo, as `okf verify` needs them; an
 *   actor is optional, since `okf verify --by` can name one instead.
 *
 * @returns the new text, or `undefined` when the block wouldn't change.
 */
function planConfig(params: {
  cwd: string;
  options: InitOptions;
  output: Output;
  repoRoot: string;
}): Outcome<string | undefined> {
  const { cwd, options, output, repoRoot } = params;
  const packageJsonPath = path.join(repoRoot, "package.json");
  const read = readRepoFile({ filePath: "package.json", repoRoot });

  if (!read.isOk) {
    return read;
  }

  const text = read.value;

  if (text === undefined) {
    return {
      isOk: false,
      reason: `No package.json at ${repoRoot}; okf-tools reads its config from there, so add one first.`,
    };
  }

  const config = readOkfConfig(text);

  if (!config.isOk) {
    return config;
  }

  const manifest: unknown = JSON.parse(text);

  if (!isPlainObject(manifest)) {
    return { isOk: false, reason: "package.json must hold a JSON object." };
  }

  const bundleDirs = selectBundleDirs({
    config: config.config,
    cwd,
    options,
    repoRoot,
  });

  if (bundleDirs.length === 0) {
    return { isOk: false, reason: describeNoBundles(packageJsonPath) };
  }

  const bundles = resolveBundleDirs({ bundleDirs, repoRoot });

  if (!bundles.isOk) {
    return bundles;
  }

  const verifiedBy = options.by ?? config.config.verifiedBy;

  // A configured actor is checked too, so init never passes a config verify rejects.
  if (verifiedBy !== undefined && !isActor(verifiedBy)) {
    return { isOk: false, reason: describeBadActor(verifiedBy) };
  }

  if (verifiedBy === undefined) {
    output.info(
      "No `okf.verifiedBy` set, so okf verify will need --by <actor>; pass --by to okf init to set one."
    );
  }

  const current = isPlainObject(manifest.okf) ? manifest.okf : {};

  const next = {
    ...current,
    ...(options.bundles.length > 0 ? { bundles: bundles.value } : {}),
    ...(verifiedBy === undefined ? {} : { verifiedBy }),
  };

  if (JSON.stringify(next) === JSON.stringify(current)) {
    return { isOk: true, value: undefined };
  }

  return { isOk: true, value: writeOkfMember({ text, value: next }) };
}

/**
 * Read a file the run may write, or `undefined` when it doesn't exist.
 *
 * - It, or its nearest existing folder, must resolve inside the repo; an
 *   existing one must be a file, and the nearest existing ancestor of a
 *   missing one a folder, so a write can't fail after others have landed.
 */
function readRepoFile(params: {
  filePath: string;
  repoRoot: string;
}): Outcome<string | undefined> {
  const { filePath, repoRoot } = params;
  const absolutePath = path.join(repoRoot, filePath);
  let existing = absolutePath;

  while (!isPresent(existing)) {
    existing = path.dirname(existing);
  }

  let realPath: string;

  try {
    realPath = realpathSync.native(existing);
  } catch (error) {
    return {
      isOk: false,
      reason: `Couldn't follow ${path.relative(repoRoot, existing)}, a broken symlink or one that can't be read: ${describeError(error)}`,
    };
  }

  const relative = path.relative(realpathSync.native(repoRoot), realPath);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return {
      isOk: false,
      reason: `${filePath} leads through a symlink to ${realPath}, outside the repo; okf init writes only inside it.`,
    };
  }

  const stats = lstatSync(realPath);

  if (existing !== absolutePath) {
    return stats.isDirectory()
      ? { isOk: true, value: undefined }
      : {
          isOk: false,
          reason: `${path.relative(repoRoot, existing)} isn't a folder, so ${filePath} can't be written.`,
        };
  }

  if (!stats.isFile()) {
    return { isOk: false, reason: `${filePath} isn't a file.` };
  }

  return { isOk: true, value: readFileSync(absolutePath, "utf8") };
}

/**
 * Read the instruction files the block goes in: `AGENTS.md` always, and the
 * Copilot file under `--copilot` or when it already holds a marker.
 *
 * - A file reached through a symlink to outside the repo is refused, so
 *   `okf init` never writes beyond it; a Copilot file that isn't asked for
 *   and can't be read is skipped instead.
 */
function readTargets(params: {
  options: InitOptions;
  repoRoot: string;
}): Outcome<Target[]> {
  const { options, repoRoot } = params;
  const targets: Target[] = [];

  for (const filePath of [AGENTS_PATH, COPILOT_PATH]) {
    const isAsked = filePath === AGENTS_PATH || options.shouldWriteCopilot;
    const text = readRepoFile({ filePath, repoRoot });

    // A Copilot file nobody asked for is only looked at, never refused.
    if (!text.isOk && isAsked) {
      return text;
    }

    const isWanted =
      isAsked ||
      (text.isOk &&
        text.value !== undefined &&
        findBlock(text.value).kind !== "absent");

    if (isWanted && text.isOk) {
      targets.push({ filePath, text: text.value });
    }
  }

  return { isOk: true, value: targets };
}

/**
 * Plan the config and every block, then write the files that change.
 *
 * - A refusal anywhere writes nothing.
 *
 * @returns `0` when every file is written or already current, else `1`.
 */
function writeAll(params: {
  cwd: string;
  options: InitOptions;
  output: Output;
  repoRoot: string;
  targets: readonly Target[];
}): ExitCode {
  const { cwd, options, output, repoRoot, targets } = params;
  const config = planConfig({ cwd, options, output, repoRoot });

  if (!config.isOk) {
    output.error(config.reason);

    return EXIT_CODES.failure;
  }

  const writes: PlannedWrite[] = [];

  if (config.value === undefined) {
    output.info("package.json's okf config is up to date.");
  } else {
    writes.push({ filePath: "package.json", isNew: false, text: config.value });
  }

  for (const { filePath, text } of targets) {
    const update = writeBlock(text ?? "");

    if (!update.isOk) {
      output.error(
        `${filePath} ${update.problem}; fix the markers by hand, then run okf init again. Nothing was written.`
      );

      return EXIT_CODES.failure;
    }

    if (update.text === text) {
      output.info(`${filePath}'s okf block is up to date.`);
    } else {
      writes.push({ filePath, isNew: text === undefined, text: update.text });
    }
  }

  const written: string[] = [];

  for (const { filePath, isNew, text } of writes) {
    const absolutePath = path.join(repoRoot, filePath);

    try {
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, text);
    } catch (error) {
      const done = written.length > 0 ? written.join(", ") : "nothing";

      output.error(
        `Couldn't write ${filePath}: ${describeError(error)} Written before it: ${done}.`
      );

      return EXIT_CODES.failure;
    }

    written.push(filePath);
    output.info(`${isNew ? "Created" : "Updated"} ${filePath}.`);
  }

  return EXIT_CODES.ok;
}
