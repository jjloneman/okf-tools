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
 *   once, with the record's own, and the record's frontmatter at each of its
 *   commits and their parents, for the source rules.
 *
 * - It writes nothing, unless `--fix` (or `okf format`) asks it to fix what
 *   it found that has one obvious fix, then report what's left. It exits `1`
 *   on an error-level finding, a file it couldn't read, a write that failed,
 *   or under `--strict` a warning; otherwise `0`, so a fix it refused counts
 *   by the findings it leaves.
 */
import { DateTime } from "luxon";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  CheckedBundle,
  CheckedFile,
  CheckFinding,
  CheckReport,
  CheckSeverity,
  CheckSkipped,
  FileChange,
  UnseenCommits,
} from "./check-engine.ts";
import type { DraftPolicy } from "./config.ts";
import type { ExitCode } from "./exit-codes.ts";
import type { PathChanges, PathCommit } from "./git.ts";
import type { HouseRules } from "./house-rules.ts";
import type { CheckFormat } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { Output } from "./output.ts";
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
  readTextsAt,
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
import { readSourcePaths, readStamp, SOURCE_RULES } from "./source-rules.ts";
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

  /**
   * Where to write each draft's `T001` finding as JSON, for
   * `okf review-comments`, which posts them instead of the annotations.
   *
   * @example "/tmp/okf-drafts.json"
   */
  reviewFile: string | undefined;
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
    reviewFile,
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
    /*
     * A record with a stale source is fixed like any other.
     *
     * - A fix never edits `generated` or `verified`, so its commit never
     *   counts to `T007` as the record having seen its sources.
     *
     * - Nor does it before it's committed, since `T007` falls back to the clock
     *   only while a record's `generated` or `verified` differs from `HEAD`'s.
     */
    const fixed = applyFixes({
      bundles,
      context,
      findings: report.findings,
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

  let isReviewFailed = false;

  if (format === "json") {
    output.data(JSON.stringify(report, undefined, 2));
  } else {
    for (const { reason } of report.skipped) {
      output.error(toTerminalLine(`Skipped: ${reason}`));
    }

    const drafts = report.findings.filter(isReviewDraft);

    // Written before anything prints, so a write that fails leaves the
    // drafts as annotations rather than nowhere.
    const isWritten =
      reviewFile !== undefined &&
      writeReviewFile({ drafts, output, reviewFile });

    isReviewFailed = reviewFile !== undefined && !isWritten;

    // GitHub shows only so many annotations, and hides an annotation's
    // path in the log, so each finding prints as a line too.
    for (const finding of report.findings) {
      if (isGitHubActions && !(isWritten && isReviewDraft(finding))) {
        output.data(formatAnnotation(finding));
      }

      output.info(formatFinding(finding));
    }

    output.info(formatSummary(report));
  }

  const isFailed =
    isReviewFailed ||
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

/** Whether a finding is a draft's, which `okf review-comments` posts. */
function isReviewDraft(finding: CheckFinding): boolean {
  return finding.code === "T001";
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
 * List, for each record that cites a path, the commits that re-stamped or
 * signed it off: changed its `generated` or `verified` from what every
 * parent held, by `readStamp`, in one `git cat-file --batch` for them all.
 *
 * - A commit that added the record counts, and one that deleted it doesn't.
 *
 * - A commit whose parent held frontmatter that can't be read doesn't count,
 *   since what changed can't be told, so repairing a broken frontmatter
 *   isn't a re-stamp.
 *
 * - A merge that took the record from one side doesn't count, since that
 *   side's own commit did.
 *
 * - A record whose own history couldn't be read gets nothing, and so does
 *   one whose path has a line break, which `git cat-file --batch` can't
 *   name, and every record when git can't read the files, so the source
 *   rules skip them.
 *
 * - A record counts as re-stamped in the working tree when its `generated`
 *   or `verified` there differs from `HEAD`'s, read in the same batch; one
 *   no commit holds yet always does.
 *
 * @returns the commits, by the record's path from the repo root, the records
 *   re-stamped in the working tree, and why git couldn't say, for each
 *   record.
 */
function listStampCommits(params: {
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
   * The commits git knows to each path, newest first, by path from the repo
   * root.
   *
   * @example `new Map([["kb/a.md", [{ committedAt: 1790000000, … }]]])`
   */
  commits: ReadonlyMap<string, readonly PathCommit[]>;

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;
}): {
  /**
   * Why git couldn't say, one line a record.
   *
   * @example `["Couldn't tell which commits re-stamped or signed off kb/a.md: …"]`
   */
  failures: string[];

  /**
   * The records whose `generated` or `verified` in the working tree differs
   * from `HEAD`'s, by path from the repo root.
   *
   * @example `new Set(["kb/a.md"])`
   */
  restamped: Set<string>;

  /**
   * The full hashes of each record's re-stamps and sign-offs, by its path
   * from the repo root.
   *
   * @example `new Map([["kb/a.md", new Set(["1a2b3c4d…"])]])`
   */
  stamps: Map<string, ReadonlySet<string>>;
} {
  const { cited, commits, repoRoot } = params;
  const failures: string[] = [];
  const records = cited.flatMap(({ file, paths }) => {
    const own = commits.get(file.filePath);

    if (paths.length === 0 || own === undefined) {
      return [];
    }

    if (file.filePath.includes("\n")) {
      failures.push(
        `Couldn't tell which commits re-stamped or signed off ${file.filePath}: git cat-file can't read a path with a line break`
      );

      return [];
    }

    return [{ file, filePath: file.filePath, own }];
  });

  // `HEAD` holds a record only when some commit does.
  const names = records.flatMap(({ filePath, own }) => [
    ...(own.length === 0 ? [] : [`HEAD:${filePath}`]),
    ...own.flatMap(({ hash, parents }) =>
      [hash, ...parents].map((commit) => `${commit}:${filePath}`)
    ),
  ]);
  const read =
    names.length === 0
      ? { isOk: true as const, value: new Map<string, string | undefined>() }
      : readTextsAt({ names: [...new Set(names)], repoRoot });
  const restamped = new Set<string>();
  const stamps = new Map<string, ReadonlySet<string>>();

  if (!read.isOk) {
    return {
      failures: [
        ...failures,
        ...records.map(
          ({ filePath }) =>
            `Couldn't tell which commits re-stamped or signed off ${filePath}: ${read.reason}`
        ),
      ],
      restamped,
      stamps,
    };
  }

  const texts = read.value;

  for (const { file, filePath, own } of records) {
    if (readStamp(file.text) !== readStamp(texts.get(`HEAD:${filePath}`))) {
      restamped.add(filePath);
    }

    stamps.set(
      filePath,
      new Set(
        own
          .filter(({ hash, parents }) => {
            const stamp = readStamp(texts.get(`${hash}:${filePath}`));

            return (
              stamp !== undefined &&
              parents.every((parent) => {
                const text = texts.get(`${parent}:${filePath}`);
                const parentStamp = readStamp(text);

                return (
                  text === undefined ||
                  (parentStamp !== undefined && parentStamp !== stamp)
                );
              })
            );
          })
          .map(({ hash }) => hash)
      )
    );
  }

  return { failures, restamped, stamps };
}

/**
 * Read into `unseen`, for each record that cites a path, which commits to the
 * paths it cites aren't in the history of any commit that re-stamped or
 * signed it off, and the newest such commit.
 *
 * - With the commits' `order` from a history with no merge, a commit is in
 *   a record's history when it comes no earlier than the record's newest
 *   re-stamp or sign-off, so no more git is run.
 *
 * - Otherwise records with the same re-stamps and sign-offs share one
 *   `git rev-list`.
 *
 * - A record no commit re-stamped or signed off has seen none of them.
 *
 * - A record with no `stamps` gets nothing, and so does one whose commits
 *   git couldn't place, so the source rules skip it.
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
   * Every commit read, newest first, from a history with no merge; else
   * `undefined`.
   *
   * @example `["1a2b3c4d…", "5e6f7a8b…"]`
   */
  order: readonly string[] | undefined;

  /** The repo's root folder. @example "/home/me/repo" */
  repoRoot: string;

  /**
   * The records whose `generated` or `verified` in the working tree differs
   * from `HEAD`'s, by path from the repo root.
   *
   * @example `new Set(["kb/a.md"])`
   */
  restamped: ReadonlySet<string>;

  /**
   * The full hashes of each record's re-stamps and sign-offs, by its path
   * from the repo root.
   *
   * @example `new Map([["kb/a.md", new Set(["1a2b3c4d…"])]])`
   */
  stamps: ReadonlyMap<string, ReadonlySet<string>>;

  /**
   * Where each record's unseen commits go, by its path from the repo root.
   *
   * @example `new Map()`
   */
  unseen: Map<string, UnseenCommits>;
}): string[] {
  const { cited, order, repoRoot, restamped, stamps, unseen } = params;
  const failures: string[] = [];
  const groups = new Map<
    string,
    {
      candidates: Set<string>;
      from: string[];
      records: { filePath: string; lastSeen: FileChange["commit"] }[];
    }
  >();

  for (const { file, paths } of cited) {
    const stamped = stamps.get(file.filePath);

    if (paths.length === 0 || stamped === undefined) {
      continue;
    }

    const seen = file
      .readChanges(file.filePath)
      .flatMap(({ commit }) =>
        commit !== undefined && stamped.has(commit.hash) ? [commit] : []
      );
    const from = seen.map(({ hash }) => hash);
    const key = from.join(" ");
    const group = groups.get(key) ?? {
      candidates: new Set<string>(),
      from,
      records: [],
    };

    for (const { commit } of paths.flatMap((filePath) =>
      file.readChanges(filePath)
    )) {
      if (commit !== undefined) {
        group.candidates.add(commit.hash);
      }
    }

    group.records.push({ filePath: file.filePath, lastSeen: seen[0] });
    groups.set(key, group);
  }

  for (const { candidates, from, records } of groups.values()) {
    const listed = placeCommits({ candidates, from, order, repoRoot });

    if (!listed.isOk) {
      failures.push(
        ...records.map(
          ({ filePath }) =>
            `Couldn't tell which commits are in the history of ${filePath}: ${listed.reason}`
        )
      );

      continue;
    }

    for (const { filePath, lastSeen } of records) {
      unseen.set(filePath, {
        hasUncommittedStamp: restamped.has(filePath),
        lastSeen,
        unseen: listed.value,
      });
    }
  }

  return failures;
}

/**
 * Say which of some commits aren't in the history of any of a record's
 * re-stamps and sign-offs.
 *
 * - All of them, when it has none.
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
   * The full hashes of the record's re-stamps and sign-offs, newest first.
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
  const unseen = new Map<string, UnseenCommits>();
  const readUnseenCommits = (filePath: string): undefined | UnseenCommits =>
    unseen.get(filePath);
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
  const commits = new Map<string, readonly PathCommit[]>();
  const { failures, order } = readHistory({
    commits,
    filePaths: cited.flatMap(({ file, paths }) =>
      paths.length === 0 ? [] : [file.filePath, ...paths]
    ),
    hasHead: base !== undefined,
    history,
    repoRoot,
  });
  const stamped = listStampCommits({ cited, commits, repoRoot });
  const unseenFailures = listUnseenCommits({
    cited,
    order,
    repoRoot,
    restamped: stamped.restamped,
    stamps: stamped.stamps,
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
      historyFailures: [
        ...failures.values(),
        ...stamped.failures,
        ...unseenFailures,
      ],
      skipped,
    },
  };
}

/**
 * Read the history of each path into `history`: its uncommitted changes as
 * one change at the current time, then its commits, newest first, and its
 * commits as git read them, parents included, into `commits`.
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
  /**
   * Where each path's commits go, as git read them, by path from the repo
   * root.
   *
   * @example `new Map()`
   */
  commits: Map<string, readonly PathCommit[]>;

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
  const {
    commits: pathCommits,
    filePaths,
    hasHead,
    history,
    repoRoot,
  } = params;
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

    pathCommits.set(filePath, commits);
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

/**
 * Write the drafts' findings as a JSON list, for `okf review-comments`, and
 * say why when the write fails.
 */
function writeReviewFile(params: {
  /** The drafts' findings. @example `[{ code: "T001", … }]` */
  drafts: readonly CheckFinding[];

  /** Where a failed write is said. @example `createOutput("okf")` */
  output: Output;

  /** The file to write. @example "/tmp/okf-drafts.json" */
  reviewFile: string;
}): boolean {
  const { drafts, output, reviewFile } = params;

  try {
    writeFileSync(reviewFile, `${JSON.stringify(drafts, undefined, 2)}\n`);

    return true;
  } catch (error) {
    output.error(
      toTerminalLine(`Couldn't write ${reviewFile}: ${describeError(error)}`)
    );

    return false;
  }
}
