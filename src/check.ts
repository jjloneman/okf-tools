/*
 * `okf check`: report problems in the bundles against OKF's spec rules and
 * okf-tools' trust rules, as text for a person, JSON for a program, or
 * annotations in GitHub Actions.
 *
 * - It reads every Markdown file in the bundles that git would track,
 *   records, `index.md` and `log.md` files, and other Markdown alike, but
 *   none `okf.exclude` matches and none in a folder starting with `.`.
 *
 * - Each file changed since the base branch is also read as the branch's
 *   merge base holds it, for the rule that fails a record changed without
 *   a new `generated.at`. `--changed` reports on those files alone, and on
 *   the records whose `sources` cite a file the branch changed.
 *
 * - Each path a record's `sources` cite in the repo has its history read
 *   once, with the record's own, for the source rules.
 *
 * - It never writes. It exits `1` on an error-level finding, a file it
 *   couldn't read, or under `--strict` a warning; otherwise `0`.
 */
import { DateTime } from "luxon";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import type {
  CheckedBundle,
  CheckedFile,
  CheckFinding,
  CheckReport,
  CheckSeverity,
  CheckSkipped,
  FileChange,
} from "./check-engine.ts";
import type { DraftPolicy } from "./config.ts";
import type { ExitCode } from "./exit-codes.ts";
import type { HouseRules } from "./house-rules.ts";
import type { CheckFormat } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { BundleContext } from "./run-context.ts";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import {
  listBranchCommits,
  listPathChanges,
  readMergeBase,
  readTextAt,
  readWorkingPaths,
  toPathKey,
} from "./git.ts";
import { buildHouseRules } from "./house-rules.ts";
import { describeError, toTerminalLine } from "./output.ts";
import {
  findOwningBundle,
  listBundleChanges,
  matchExcluded,
  readRecordText,
} from "./repo.ts";
import { readSourcePaths, SOURCE_RULES } from "./source-rules.ts";
import { SPEC_RULES } from "./spec-rules.ts";
import { buildTrustRules } from "./trust-rules.ts";

/** The workflow command GitHub Actions annotates a file with, by severity. */
const ANNOTATION_COMMANDS: Record<CheckSeverity, string> = {
  error: "error",
  info: "notice",
  warning: "warning",
};

/** Word a finding as a GitHub Actions workflow command, which annotates it. */
export function formatAnnotation(finding: CheckFinding): string {
  const { code, line, message, path: filePath, rule, severity } = finding;
  const properties = [
    `file=${escapeProperty(filePath)}`,
    ...(line === null ? [] : [`line=${line}`]),
    `title=${escapeProperty(`${code} ${rule}`)}`,
  ];

  return `::${ANNOTATION_COMMANDS[severity]} ${properties.join(",")}::${escapeData(message)}`;
}

/** Word a finding for a person, as one line: where, how bad, and what. */
export function formatFinding(finding: CheckFinding): string {
  const { code, line, message, path: filePath, rule, severity } = finding;

  return toTerminalLine(
    `${filePath}${line === null ? "" : `:${line}`}: ${severity} ${code} ${rule}: ${message}`
  );
}

/** Word the report's totals for a person. */
export function formatSummary(report: CheckReport): string {
  const { counts, filesChecked } = report;

  return `${count({ noun: "file", total: filesChecked })} checked: ${count({ noun: "error", total: counts.error })}, ${count({ noun: "warning", total: counts.warning })}, ${counts.info} info.`;
}

/**
 * Run `okf check`: read the bundles' Markdown, run the spec and trust rules,
 * and print what they found.
 */
export function runCheck(params: {
  /**
   * The repo and bundles to check.
   *
   * @example `buildBundleContext(…)`
   */
  context: BundleContext;

  /**
   * How a draft record is reported, from `okf.drafts`; a notice when unset.
   *
   * @example "block"
   */
  drafts: DraftPolicy | undefined;

  /**
   * How to print the report.
   *
   * @example "text"
   */
  format: CheckFormat;

  /**
   * The house rules the repo turned on, from `okf.rules`.
   *
   * @example `{ "tags-sorted": "error" }`
   */
  houseRules: HouseRules;

  /**
   * Whether `--changed` asked to report only on the files changed since the
   * base branch.
   *
   * @example true
   */
  isChanged: boolean;

  /**
   * Whether it runs in GitHub Actions, where text findings print as
   * annotations.
   *
   * @example false
   */
  isGitHubActions: boolean;

  /**
   * Whether a warning fails the run too.
   *
   * @example false
   */
  isStrict: boolean;
}): ExitCode {
  const {
    context,
    drafts,
    format,
    houseRules,
    isChanged,
    isGitHubActions,
    isStrict,
  } = params;
  const { output } = context;
  const read = readBundles({ context, isChanged });

  if (!read.isOk) {
    output.error(read.reason);

    return EXIT_CODES.failure;
  }

  const {
    bundles,
    changedKeys,
    citingKeys,
    hasBase,
    historyFailures,
    skipped,
  } = read.value;

  // A history git can't read, such as a path in a submodule, only leaves
  // the source rules without it, so it's said but doesn't fail the run.
  for (const reason of historyFailures) {
    output.error(toTerminalLine(`${reason}; the source rules skip it.`));
  }

  // On stderr in every format, so a JSON reader and a green CI job still
  // show that the gate saw only uncommitted changes.
  if (isChanged && !hasBase) {
    output.error(
      "Can't diff against the base branch; checking uncommitted changes only. In CI, fetch the base branch, such as with actions/checkout's fetch-depth: 0."
    );
  }

  const report = buildCheckReport({
    bundles,
    isInScope: isChanged
      ? (filePath) =>
          changedKeys.has(toPathKey(filePath)) ||
          citingKeys.has(toPathKey(filePath))
      : undefined,
    rules: [
      ...SPEC_RULES,
      ...buildTrustRules(drafts),
      ...SOURCE_RULES,
      ...buildHouseRules(houseRules),
    ],
    skipped,
  });

  if (format === "json") {
    output.data(JSON.stringify(report, undefined, 2));
  } else {
    for (const { reason } of report.skipped) {
      output.error(toTerminalLine(`Skipped: ${reason}`));
    }

    // GitHub shows only so many annotations, and hides an annotation's
    // path in the log, so each finding prints as a line too.
    for (const finding of report.findings) {
      if (isGitHubActions) {
        output.data(formatAnnotation(finding));
      }

      output.info(formatFinding(finding));
    }

    output.info(formatSummary(report));
  }

  const isFailed =
    report.counts.error > 0 ||
    report.skipped.length > 0 ||
    (isStrict && report.counts.warning > 0);

  return isFailed ? EXIT_CODES.failure : EXIT_CODES.ok;
}

/** Word a count with its noun, plural unless it's one. */
function count(params: { noun: string; total: number }): string {
  const { noun, total } = params;

  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

/** Escape a workflow command's message, which ends at a line break. */
function escapeData(text: string): string {
  return toTerminalLine(text)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/** Escape a workflow command's property, which ends at `,` or `:` too. */
function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

/**
 * Whether a file a path names lies inside its bundle once symlinks are
 * followed, since OKF never follows one out of the bundle (§3.2).
 */
function isInsideOnDisk(params: {
  bundleDir: string;
  filePath: string;
  repoRoot: string;
}): boolean {
  const { bundleDir, filePath, repoRoot } = params;
  const root = realpathSync(path.join(repoRoot, bundleDir));
  const target = realpathSync(path.join(repoRoot, filePath));
  const relative = path.relative(root, target);

  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/**
 * List the records whose `sources` cite a path changed on the branch, by a
 * commit the base doesn't have or by uncommitted changes, each as its
 * `toPathKey`.
 */
function listCitingKeys(params: {
  branchCommits: ReadonlySet<string>;
  cited: readonly { file: CheckedFile; paths: readonly string[] }[];
}): Set<string> {
  const { branchCommits, cited } = params;

  return new Set(
    cited
      .filter(({ file, paths }) =>
        paths.some((sourcePath) =>
          file
            .readChanges(sourcePath)
            .some(
              ({ commit }) =>
                commit === undefined || branchCommits.has(commit.hash)
            )
        )
      )
      .map(({ file }) => toPathKey(file.filePath))
  );
}

/**
 * Read every Markdown file in the bundles git would track, grouped by the
 * deepest bundle that holds each, the files that couldn't be read, the files
 * changed since the base branch, and under `--changed` the records citing a
 * file the branch changed.
 *
 * - A changed file is also read as the branch's merge base holds it, or
 *   `HEAD` when there's no base to diff against.
 */
function readBundles(params: {
  context: BundleContext;
  isChanged: boolean;
}): Outcome<{
  bundles: CheckedBundle[];
  changedKeys: ReadonlySet<string>;
  citingKeys: ReadonlySet<string>;
  hasBase: boolean;
  historyFailures: string[];
  skipped: CheckSkipped[];
}> {
  const { context, isChanged } = params;
  const { bundleDirs, excludeGlobs, repoRoot } = context;
  const isExcluded = matchExcluded(excludeGlobs);
  const doesExist = (filePath: string): boolean =>
    existsSync(path.join(repoRoot, filePath));
  const files: CheckedFile[] = [];
  const history = new Map<string, readonly FileChange[]>();
  const readChanges = (filePath: string): readonly FileChange[] =>
    history.get(filePath) ?? [];
  const skipped: CheckSkipped[] = [];

  const listed = readWorkingPaths(repoRoot);

  if (!listed.isOk) {
    return listed;
  }

  const changes = listBundleChanges({ bundleDirs, repoRoot });

  if (!changes.isOk) {
    return changes;
  }

  const base = readMergeBase(repoRoot);
  const baseCommit = base?.commit;
  const changedKeys = new Set([...changes.value.paths].map(toPathKey));

  for (const filePath of [...listed.value].sort()) {
    const bundleDir = findOwningBundle({ bundleDirs, filePath });

    if (
      bundleDir === undefined ||
      !filePath.endsWith(".md") ||
      path.posix
        .relative(bundleDir, filePath)
        .split("/")
        .some((part) => part.startsWith(".")) ||
      isExcluded(filePath) ||
      !doesExist(filePath) ||
      !isInsideOnDisk({ bundleDir, filePath, repoRoot })
    ) {
      continue;
    }

    const baseText: Outcome<string | undefined> =
      baseCommit === undefined || !changedKeys.has(toPathKey(filePath))
        ? { isOk: true, value: undefined }
        : readTextAt({ filePath, ref: baseCommit, repoRoot });

    if (!baseText.isOk) {
      skipped.push({ path: filePath, reason: baseText.reason });

      continue;
    }

    try {
      files.push(
        readCheckedFile({
          baseText: baseText.value,
          bundleDir,
          doesExist,
          filePath,
          readChanges,
          text: readRecordText({ filePath, repoRoot }),
        })
      );
    } catch (error) {
      skipped.push({
        path: filePath,
        reason: `${filePath} can't be read: ${describeError(error)}`,
      });
    }
  }

  const cited = files.map((file) => ({
    file,
    paths: readSourcePaths(file),
  }));
  const failures = readHistory({
    filePaths: cited.flatMap(({ file, paths }) =>
      paths.length === 0 ? [] : [file.filePath, ...paths]
    ),
    hasHead: base !== undefined,
    history,
    repoRoot,
  });

  const branchCommits = new Set(
    isChanged && base?.isBranchBase === true
      ? listBranchCommits({ base: base.commit, repoRoot })
      : []
  );

  return {
    isOk: true,
    value: {
      bundles: bundleDirs.map((bundleDir) => ({
        bundleDir,
        files: files.filter((file) => file.bundleDir === bundleDir),
      })),
      changedKeys,
      citingKeys: listCitingKeys({ branchCommits, cited }),
      hasBase: base?.isBranchBase === true,
      historyFailures: [...failures.values()],
      skipped,
    },
  };
}

/**
 * Read the history of each path into `history`: its uncommitted changes as
 * one change at the current time, then its commits, newest first.
 *
 * - A repo with no commits yet has no history to read.
 *
 * - A path git can't read has no history, so the source rules skip it.
 *
 * @returns why git couldn't read a path's history, by path.
 */
function readHistory(params: {
  filePaths: readonly string[];
  hasHead: boolean;
  history: Map<string, readonly FileChange[]>;
  repoRoot: string;
}): Map<string, string> {
  const { filePaths, hasHead, history, repoRoot } = params;
  const failures = new Map<string, string>();
  const now = Math.floor(DateTime.utc().toSeconds());

  for (const filePath of new Set(filePaths)) {
    const changes = listPathChanges({ filePath, hasHead, repoRoot });

    if (!changes.isOk) {
      failures.set(filePath, changes.reason);

      continue;
    }

    const { commits, isDirty } = changes.value;

    history.set(filePath, [
      ...(isDirty ? [{ at: now, commit: undefined }] : []),
      ...commits.map(({ authoredAt, hash, shortHash }) => ({
        at: authoredAt,
        commit: { hash, shortHash },
      })),
    ]);
  }

  return failures;
}
