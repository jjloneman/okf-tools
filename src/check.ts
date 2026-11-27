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
 * - It writes nothing, unless `--fix` (or `okf format`) asks it to fix what
 *   it found that has one obvious fix, then report what's left. It exits `1`
 *   on an error-level finding, a file it couldn't read, a write that failed,
 *   or under `--strict` a warning; otherwise `0`, so a fix it refused counts
 *   by the findings it leaves.
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
import type { PathChanges } from "./git.ts";
import type { HouseRules } from "./house-rules.ts";
import type { CheckFormat } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { BundleContext } from "./run-context.ts";

import { buildCheckReport, readCheckedFile } from "./check-engine.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { applyFixes } from "./fix.ts";
import {
  listBranchCommits,
  listPathChanges,
  listPathChangesTogether,
  listUnreachedCommits,
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
   * Whether `--fix` asked to fix what has one obvious fix first, then report
   * what's left.
   *
   * @example true
   */
  isFix: boolean;

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
    isFix,
    isGitHubActions,
    isStrict,
  } = params;
  const { output } = context;
  const read = readBundles({ context, isChanged });

  if (!read.isOk) {
    output.error(read.reason);

    return EXIT_CODES.failure;
  }

  const { bundles, hasBase, historyFailures } = read.value;

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

  const rules = [
    ...SPEC_RULES,
    ...buildTrustRules(drafts),
    ...SOURCE_RULES,
    ...buildHouseRules(houseRules),
  ];
  const buildReport = (checked: typeof read.value): CheckReport =>
    buildCheckReport({
      bundles: checked.bundles,
      isInScope: isChanged
        ? (filePath) =>
            checked.changedKeys.has(toPathKey(filePath)) ||
            checked.citingKeys.has(toPathKey(filePath))
        : undefined,
      rules,
      skipped: checked.skipped,
    });

  let report = buildReport(read.value);

  if (isFix) {
    // Under `--changed`, a record in scope only for citing a changed file
    // is left as it is, so the fix doesn't hide a source change from `T007`.
    const fixed = applyFixes({
      bundles,
      context,
      findings: isChanged
        ? report.findings.filter(({ path: filePath }) =>
            read.value.changedKeys.has(toPathKey(filePath))
          )
        : report.findings,
      houseRules,
    });

    if (!fixed.isOk) {
      // A reason can quote a record's own text, such as a YAML error.
      output.error(
        fixed.reason
          .split("\n")
          .map((line) => toTerminalLine(line))
          .join("\n")
      );

      return EXIT_CODES.failure;
    }

    // A JSON reader takes stdout whole, so the fixes print beside it.
    const say = format === "json" ? output.error : output.info;

    for (const reason of fixed.value.refusals) {
      output.error(toTerminalLine(`Not fixed: ${reason}`));
    }

    for (const { filePath } of fixed.value.written) {
      say(toTerminalLine(`Fixed ${filePath}.`));
    }

    // The report that follows reads each fixed file as written, so it says
    // what the fixes left, with nothing read twice.
    const texts = new Map(
      fixed.value.written.map(({ filePath, text }) => [filePath, text])
    );

    report =
      texts.size === 0
        ? report
        : buildReport({
            ...read.value,
            bundles: bundles.map((bundle) => ({
              ...bundle,
              files: bundle.files.map((file) => {
                const text = texts.get(file.filePath);

                return text === undefined
                  ? file
                  : readCheckedFile({ ...file, text });
              }),
            })),
          });
  }

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
 * Read into `unseen`, for each record that cites a path, which commits to the
 * paths it cites aren't in the history of any commit that changed it.
 *
 * - With the commits' `order` from a history with no merge, a commit is in
 *   a record's history when it comes no earlier than the record's newest
 *   commit, so no more git is run.
 *
 * - Otherwise records changed in the same commits share one `git rev-list`.
 *
 * - A record git has no commits of has seen none of them.
 *
 * - A record whose own history couldn't be read gets nothing, and so does
 *   one whose commits git couldn't place, so the source rules skip it.
 *
 * @returns why git couldn't say, for each record.
 */
function listUnseenCommits(params: {
  /**
   * Each file read, with the paths in the repo its `sources` cite.
   *
   * @example `[{ file, paths: ["src/check.ts"] }]`
   */
  cited: readonly {
    /** The file. @example `readCheckedFile({ … })` */
    file: CheckedFile;

    /** The paths it cites, from the repo root. @example `["src/a.ts"]` */
    paths: readonly string[];
  }[];

  /**
   * The changes git knows to each path, by path from the repo root.
   *
   * @example `new Map([["src/a.ts", [{ at: 1790000000, commit }]]])`
   */
  history: ReadonlyMap<string, readonly FileChange[]>;

  /**
   * Every commit read, newest first, from a history with no merge; else
   * `undefined`.
   *
   * @example `["1a2b3c4d…", "5e6f7a8b…"]`
   */
  order: readonly string[] | undefined;

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;

  /**
   * Where each record's unseen commits go, by its path from the repo root.
   *
   * @example `new Map()`
   */
  unseen: Map<string, ReadonlySet<string>>;
}): string[] {
  const { cited, history, order, repoRoot, unseen } = params;
  const failures: string[] = [];
  const groups = new Map<
    string,
    { candidates: Set<string>; filePaths: string[]; from: string[] }
  >();

  for (const { file, paths } of cited) {
    if (paths.length === 0 || !history.has(file.filePath)) {
      continue;
    }

    const readHashes = (filePath: string): string[] =>
      file
        .readChanges(filePath)
        .flatMap(({ commit }) => (commit === undefined ? [] : [commit.hash]));

    const from = readHashes(file.filePath);
    const own = new Set(from);
    const key = from.join(" ");
    const group = groups.get(key) ?? {
      candidates: new Set<string>(),
      filePaths: [],
      from,
    };

    for (const hash of paths.flatMap(readHashes)) {
      if (!own.has(hash)) {
        group.candidates.add(hash);
      }
    }

    group.filePaths.push(file.filePath);
    groups.set(key, group);
  }

  for (const { candidates, filePaths, from } of groups.values()) {
    const listed = placeCommits({ candidates, from, order, repoRoot });

    if (!listed.isOk) {
      failures.push(
        ...filePaths.map(
          (filePath) =>
            `Couldn't tell which commits are in the history of ${filePath}: ${listed.reason}`
        )
      );

      continue;
    }

    for (const filePath of filePaths) {
      unseen.set(filePath, listed.value);
    }
  }

  return failures;
}

/**
 * Say which of some commits aren't in the history of any of a record's
 * commits.
 *
 * - All of them, when the record has no commits.
 *
 * - By their place in `order`, when the history has no merge.
 *
 * - Else by asking git.
 */
function placeCommits(params: {
  /**
   * The full hashes of the commits to place.
   *
   * @example `new Set(["1a2b3c4d…"])`
   */
  candidates: ReadonlySet<string>;

  /**
   * The full hashes of the record's commits, newest first.
   *
   * @example `["5e6f7a8b…"]`
   */
  from: readonly string[];

  /**
   * Every commit read, newest first, from a history with no merge; else
   * `undefined`.
   *
   * @example `["1a2b3c4d…", "5e6f7a8b…"]`
   */
  order: readonly string[] | undefined;

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;
}): Outcome<ReadonlySet<string>> {
  const { candidates, from, order, repoRoot } = params;
  const [newest] = from;

  if (newest === undefined || candidates.size === 0) {
    return { isOk: true, value: candidates };
  }

  if (order === undefined) {
    return listUnreachedCommits({ commits: [...candidates], from, repoRoot });
  }

  return {
    isOk: true,
    value: new Set(
      order
        .slice(0, order.indexOf(newest))
        .filter((hash) => candidates.has(hash))
    ),
  };
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
  const unseen = new Map<string, ReadonlySet<string>>();
  const readUnseenCommits = (
    filePath: string
  ): ReadonlySet<string> | undefined => unseen.get(filePath);
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
          readUnseenCommits,
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
  const { failures, order } = readHistory({
    filePaths: cited.flatMap(({ file, paths }) =>
      paths.length === 0 ? [] : [file.filePath, ...paths]
    ),
    hasHead: base !== undefined,
    history,
    repoRoot,
  });
  const unseenFailures = listUnseenCommits({
    cited,
    history,
    order,
    repoRoot,
    unseen,
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
      historyFailures: [...failures.values(), ...unseenFailures],
      skipped,
    },
  };
}

/**
 * Read the history of each path into `history`: its uncommitted changes as
 * one change at the current time, then its commits, newest first.
 *
 * - Every path's history is read at once, and one path at a time only when
 *   that fails, as in a history with a merge, so a failure names its path.
 *
 * - A repo with no commits yet has no history to read.
 *
 * - A path git can't read has no history, so the source rules skip it.
 *
 * @returns why git couldn't read a path's history, and the commits' order.
 */
function readHistory(params: {
  /** The paths to read, from the repo root. @example `["src/a.ts"]` */
  filePaths: readonly string[];

  /** Whether the branch has a commit for `git log` to read. @example true */
  hasHead: boolean;

  /**
   * Where each path's changes go, by path from the repo root.
   *
   * @example `new Map()`
   */
  history: Map<string, readonly FileChange[]>;

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;
}): {
  /**
   * Why git couldn't read a path's history, by path from the repo root.
   *
   * @example `new Map([["sub/a.ts", "fatal: …"]])`
   */
  failures: Map<string, string>;

  /**
   * Every commit read, newest first, when every path was read at once from a
   * history with no merge; else `undefined`.
   *
   * @example `["1a2b3c4d…", "5e6f7a8b…"]`
   */
  order: readonly string[] | undefined;
} {
  const { filePaths, hasHead, history, repoRoot } = params;
  const failures = new Map<string, string>();
  const now = Math.floor(DateTime.utc().toSeconds());
  const uniquePaths = [...new Set(filePaths)];

  if (uniquePaths.length === 0) {
    return { failures, order: undefined };
  }

  const together = listPathChangesTogether({
    filePaths: uniquePaths,
    hasHead,
    repoRoot,
  });
  const read: { changes: Outcome<PathChanges>; filePath: string }[] =
    together.isOk
      ? together.value.paths.map(({ changes, filePath }) => ({
          changes: { isOk: true, value: changes },
          filePath,
        }))
      : uniquePaths.map((filePath) => ({
          changes: listPathChanges({ filePath, hasHead, repoRoot }),
          filePath,
        }));

  for (const { changes, filePath } of read) {
    if (!changes.isOk) {
      failures.set(filePath, changes.reason);

      continue;
    }

    const { commits, isDirty } = changes.value;

    history.set(filePath, [
      ...(isDirty ? [{ at: now, commit: undefined }] : []),
      ...commits.map(({ committedAt, hash, shortHash }) => ({
        at: committedAt,
        commit: { hash, shortHash },
      })),
    ]);
  }

  return { failures, order: together.isOk ? together.value.order : undefined };
}
