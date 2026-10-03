import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";

/*
 * Signs off OKF records interactively: marks the ones you pick `status: stable`
 * with a `verified` entry, then commits just those files.
 *
 * - Refuses to run without a terminal on both stdin and stdout, and has no flag
 *   to skip the prompts: AGENTS.md says only a person adds `verified`.
 *
 * - Never passes `--no-verify` and never pushes.
 *
 * - Run through `pnpm okf:verify [bundle-dir]`; the bundle defaults to
 *   `docs/decisions`.
 */
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
} from "@clack/prompts";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { RecordState, RecordSummary } from "./lib/okf-frontmatter.ts";

import {
  getRecordState,
  readRecordSummary,
  verifyRecord,
} from "./lib/okf-frontmatter.ts";

/** A record in the bundle that could be verified. */
type Candidate = {
  /**
   * Path from the repo root, as git prints it.
   *
   * @example "docs/decisions/package-promise.md"
   */
  filePath: string;

  /**
   * Whether the record still needs a sign-off.
   *
   * @example "unverified"
   */
  state: RecordState;

  /**
   * The frontmatter fields shown in the checklist.
   *
   * @example `{ status: "draft", title: "What every export promises" }`
   */
  summary: RecordSummary;

  /**
   * The record as it is on disk.
   *
   * @example
   * ```ts
   * "---\ntype: Decision\n---\n"
   * ```
   */
  text: string;
};

/** The changed files under a bundle, and whether the branch diff worked. */
type ChangedPaths = {
  /**
   * Whether the diff against the base branch could be read.
   *
   * @example true
   */
  hasBranchDiff: boolean;

  /**
   * Paths from the repo root, as git prints them.
   *
   * @example `new Set(["docs/decisions/package-promise.md"])`
   */
  paths: Set<string>;
};

/**
 * The fields a failed `execFileSync` call attaches to its error.
 *
 * - Each is `undefined` when the error doesn't carry it as a string.
 */
type GitFailure = {
  /**
   * The system error code, set when git couldn't be started at all.
   *
   * @example "ENOENT"
   */
  code: string | undefined;

  /**
   * What git printed to stderr before it failed.
   *
   * @example "fatal: not a git repository (or any of the parent directories): .git"
   */
  stderr: string | undefined;

  /**
   * What git printed to stdout before it failed, such as a hook's output.
   *
   * @example "eslint found 1 problem"
   */
  stdout: string | undefined;
};

/** The branch a record counts as changed against. */
const BASE_BRANCH = "main";

/** The bundle verified when no directory is given, from the repo root. */
const DEFAULT_BUNDLE_DIR = "docs/decisions";

/**
 * The options every git call shares.
 *
 * - stdin is ignored: no git call here needs input, and the prompts own the
 *   terminal.
 *
 * - stdout is piped, so the call returns it.
 *
 * - stderr is piped too, so git's messages never print over the prompts, and a
 *   failure carries them on its error; `execFileSync` would otherwise inherit
 *   it.
 */
const GIT_EXEC_OPTIONS = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
} satisfies ExecFileSyncOptionsWithStringEncoding;

/** The root every git command and record path is relative to. */
const REPO_ROOT = findRepoRoot();

/** How to call the script, printed for `--help` and for bad arguments. */
const USAGE = "usage: pnpm okf:verify [bundle-dir]";

/** Who a `verified` entry is recorded as. */
const VERIFIED_BY = "human:jjloneman";

/**
 * Build the commit message: a subject counting the records, then one bullet
 * per record.
 */
function buildCommitMessage(params: {
  bundleName: string;
  selected: readonly Candidate[];
}): string {
  const { bundleName, selected } = params;
  const types = new Set(selected.map(({ summary }) => summary.type));
  const [onlyType] = types.size === 1 ? types : [];
  const noun = onlyType?.toLowerCase() ?? "okf";
  const count = selected.length;

  const bullets = selected.map(
    ({ filePath, summary }) =>
      `- ${summary.title ?? path.basename(filePath)} (${path.basename(filePath)})`
  );

  return [
    `docs(${bundleName}): 📝 verify ${count} ${noun} ${count === 1 ? "record" : "records"}`,
    "",
    ...bullets,
  ].join("\n");
}

/** Report that nothing changed, then end the run. */
function cancelAndExit(): never {
  cancel("Nothing changed.");

  return process.exit(0);
}

/**
 * Ask which records to verify.
 *
 * - Offers the changed records first, with a choice to widen to all of them.
 * - Ends the run when the user cancels or nothing is left to verify.
 */
async function chooseCandidates(params: {
  all: readonly Candidate[];
  changed: readonly Candidate[];
}): Promise<readonly Candidate[]> {
  const { all, changed } = params;

  if (all.length === 0) {
    return fail("No records found.");
  }

  const shouldOfferToggle = changed.length > 0 && all.length > changed.length;
  let shown = changed.length > 0 ? changed : all;

  if (shouldOfferToggle) {
    const scope = await select({
      message: "Which records?",
      options: [
        {
          label: `Changed on this branch (${changed.length})`,
          value: "changed",
        },
        { label: `Every record in the bundle (${all.length})`, value: "all" },
      ],
    });

    if (isCancel(scope)) {
      return cancelAndExit();
    }

    shown = scope === "all" ? all : changed;
  } else if (changed.length === 0) {
    log.info("No records changed on this branch; showing every record.");
  }

  const selectable = shown.filter(({ state }) => state !== "verified");

  if (selectable.length === 0) {
    outro("Every listed record is already verified.");

    return process.exit(0);
  }

  const chosen = await multiselect({
    message: "Which records do you verify? (space toggles, a toggles all)",
    options: shown.map((candidate) => ({
      disabled: candidate.state === "verified",
      hint: describeState(candidate),
      label: `${candidate.summary.title ?? "(untitled)"} — ${path.basename(candidate.filePath)}`,
      value: candidate,
    })),
    required: true,
  });

  return isCancel(chosen) ? cancelAndExit() : chosen;
}

/** Word a candidate's state as the hint shown beside it in the checklist. */
function describeState(candidate: Candidate): string {
  const hints: Record<RecordState, string> = {
    changed: "changed since you verified it",
    unverified: candidate.summary.status ?? "no status",
    verified: "already verified, unchanged",
  };

  return hints[candidate.state];
}

/** Print an error, then end the run with a failing exit code. */
function fail(message: string): never {
  console.error(
    message
      .trimEnd()
      .split("\n")
      .map((line) => `[okf-verify] ${line}`)
      .join("\n")
  );

  return process.exit(1);
}

/**
 * Find the root of the repo the script was run from.
 *
 * - Says why git failed rather than guessing: a missing `git` binary and a
 *   directory outside any repo are different problems.
 */
function findRepoRoot(): string {
  try {
    return execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      GIT_EXEC_OPTIONS
    ).trim();
  } catch (error) {
    const { code, stderr } = readGitFailure(error);

    return fail(
      code === "ENOENT"
        ? "git isn't installed, or isn't on PATH."
        : `couldn't find the repo root: ${stderr?.trim() ?? "git failed"}`
    );
  }
}

/**
 * Run a git command from the repo root.
 *
 * @returns its standard output.
 */
function git(args: string[]): string {
  return execFileSync("git", args, { ...GIT_EXEC_OPTIONS, cwd: REPO_ROOT });
}

/** Whether git sees any uncommitted change to a file. */
function hasUncommittedChanges(filePath: string): boolean {
  return git(["status", "--porcelain", "--", filePath]).trim() !== "";
}

/** Whether a path exists and is a directory. */
function isDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List the changed files under `bundleDir`, from the branch diff and the
 * working tree.
 */
function listChangedPaths(bundleDir: string): ChangedPaths {
  const paths = new Set<string>();
  let hasBranchDiff = true;

  try {
    git(["diff", "--name-only", "-z", `${BASE_BRANCH}...HEAD`, "--", bundleDir])
      .split("\0")
      .filter(Boolean)
      .forEach((changedPath) => paths.add(changedPath));
  } catch {
    hasBranchDiff = false;
  }

  const entries = git(["status", "--porcelain", "-z", "-uall", "--", bundleDir])
    .split("\0")
    .filter(Boolean);

  // A rename or copy is followed by an extra entry holding its origin path.
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    paths.add(entry.slice(3));

    if (entry.startsWith("R") || entry.startsWith("C")) {
      index += 1;
    }
  }

  return { hasBranchDiff, paths };
}

/**
 * Read a record from disk.
 *
 * @returns the candidate, or `undefined` when it has no frontmatter block.
 */
function loadCandidate(filePath: string): Candidate | undefined {
  const text = readFileSync(path.join(REPO_ROOT, filePath), "utf8");
  const summary = readRecordSummary({ text, verifiedBy: VERIFIED_BY });

  return summary === undefined
    ? undefined
    : { filePath, state: getRecordState(summary), summary, text };
}

/**
 * Read the optional bundle-dir argument.
 *
 * - Prints usage and exits for `--help`, and fails with usage on any other flag
 *   or an extra argument, rather than letting `parseArgs` throw.
 */
function readBundleArg(): string | undefined {
  let positionals: string[];
  let isHelp: boolean | undefined;

  try {
    const parsed = parseArgs({
      allowPositionals: true,
      options: { help: { short: "h", type: "boolean" } },
    });

    positionals = parsed.positionals;
    isHelp = parsed.values.help;
  } catch (error) {
    return fail(
      `${error instanceof Error ? error.message : String(error)}\n${USAGE}`
    );
  }

  if (isHelp === true) {
    console.log(`[okf-verify] ${USAGE}`);

    return process.exit(0);
  }

  if (positionals.length > 1) {
    return fail(`Expected at most one bundle directory.\n${USAGE}`);
  }

  return positionals[0];
}

/**
 * Read what a failed `execFileSync` call attached to its error.
 *
 * - A `catch` binding is `unknown`, and Node documents these fields rather
 *   than typing them on the error, so each is checked rather than cast.
 */
function readGitFailure(error: unknown): GitFailure {
  const readField = (key: keyof GitFailure): string | undefined => {
    const value: unknown =
      error instanceof Error ? Reflect.get(error, key) : undefined;

    return typeof value === "string" ? value : undefined;
  };

  return {
    code: readField("code"),
    stderr: readField("stderr"),
    stdout: readField("stdout"),
  };
}

/**
 * Resolve the bundle directory to a path from the repo root, as git prints it.
 *
 * - A given directory is relative to where the command was run (`INIT_CWD`
 *   under pnpm, which runs scripts from the package root); the default is
 *   relative to the repo root.
 *
 * - Fails when the directory is missing or outside the repo.
 */
function resolveBundleDir(bundleArg: string | undefined): string {
  const absoluteDir =
    bundleArg === undefined
      ? path.join(REPO_ROOT, DEFAULT_BUNDLE_DIR)
      : path.resolve(process.env.INIT_CWD ?? process.cwd(), bundleArg);

  const relativeDir = path.relative(REPO_ROOT, absoluteDir);

  if (relativeDir.startsWith("..") || path.isAbsolute(relativeDir)) {
    return fail(`${absoluteDir} is outside the repo at ${REPO_ROOT}.`);
  }

  if (!isDirectory(absoluteDir)) {
    return fail(`No bundle directory at ${absoluteDir}.`);
  }

  return relativeDir.split(path.sep).join(path.posix.sep);
}

/** Run the interactive flow: choose, confirm, edit, commit. */
async function main(): Promise<void> {
  // Arguments first, so `--help` and a bad path answer even without a terminal.
  const bundleDir = resolveBundleDir(readBundleArg());

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail(
      "okf:verify needs an interactive terminal: only a person may add `verified`."
    );
  }

  const bundleName = path.basename(bundleDir);

  intro(`Verify records in ${bundleDir}`);

  const { hasBranchDiff, paths: changedPaths } = listChangedPaths(bundleDir);

  if (!hasBranchDiff) {
    log.warn(
      `Can't diff against ${BASE_BRANCH}; showing uncommitted changes only.`
    );
  }

  const all = readdirSync(path.join(REPO_ROOT, bundleDir))
    .filter((name) => name.endsWith(".md") && name !== "index.md")
    .sort()
    .map((name) => loadCandidate(path.posix.join(bundleDir, name)))
    .filter((candidate) => candidate !== undefined);

  const changed = all.filter(({ filePath }) => changedPaths.has(filePath));
  const selected = await chooseCandidates({ all, changed });

  const at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const edits = selected.map((candidate) => ({
    candidate,
    result: verifyRecord({ at, text: candidate.text, verifiedBy: VERIFIED_BY }),
  }));

  const failures = edits.flatMap(({ candidate, result }) =>
    result.isOk ? [] : [`${candidate.filePath}: ${result.reason}`]
  );

  if (failures.length > 0) {
    return fail(`No files changed.\n${failures.join("\n")}`);
  }

  const message = buildCommitMessage({ bundleName, selected });
  const filePaths = selected.map(({ filePath }) => filePath);

  const dirtyPaths = filePaths.filter((filePath) =>
    hasUncommittedChanges(filePath)
  );

  note(`${filePaths.join("\n")}\n\n${message}`, "Files and commit message");

  if (dirtyPaths.length > 0) {
    log.warn(
      `These also have other uncommitted changes, which the commit will include:\n${dirtyPaths.join("\n")}`
    );
  }

  const isConfirmed = await confirm({ message: "Verify and commit?" });

  if (isCancel(isConfirmed) || !isConfirmed) {
    return cancelAndExit();
  }

  edits.forEach(({ candidate, result }) => {
    if (result.isOk) {
      writeFileSync(path.join(REPO_ROOT, candidate.filePath), result.text);
    }
  });

  try {
    git(["add", "--", ...filePaths]);
    git(["commit", "-m", message, "--", ...filePaths]);
  } catch (error) {
    const { stderr, stdout } = readGitFailure(error);

    return fail(
      `The files are edited on disk but the commit failed:\n${stdout ?? ""}${stderr ?? ""}`
    );
  }

  outro(`Verified ${filePaths.length}, committed.`);
}

await main();
