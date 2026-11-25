/*
 * `okf migrate`: moves each bundle declared OKF v0.1 or v0.2, or undeclared,
 * to v0.3.
 *
 * - A dry run by default: it prints each planned change as a diff and writes
 *   nothing; `--write` applies the changes, and `--check` only says which
 *   bundles still need migrating.
 *
 * - A bundle with a problem only a person can settle is never half-migrated:
 *   it's reported, and left as it is.
 */
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { BundlePlan, MigrateNote, PlannedFile } from "./migrate-plan.ts";
import type { Outcome } from "./outcome.ts";
import type { SkippedRecord } from "./repo.ts";
import type { BundleContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { listWorkingPaths, toPathKey } from "./git.ts";
import { NO_SIGNER } from "./index-command.ts";
import { planBundle, UNDECLARED_VERSION } from "./migrate-plan.ts";
import { describeError, toTerminalLine } from "./output.ts";
import {
  loadCandidates,
  matchExcluded,
  readRecordText,
  writeRecords,
} from "./repo.ts";
import { SUPPORTED_SPEC_VERSION } from "./version.ts";

/** What `okf migrate` does with its plans: print, write, or only check. */
export type MigrateMode = "check" | "dry-run" | "write";

/** A bundle's files, as the planner reads them. */
type BundleFiles = {
  /**
   * Its root `index.md`'s text, or `undefined` when it has none.
   *
   * @example `"---\nokf_version: \"0.2\"\n---\n"`
   */
  indexText: string | undefined;

  /**
   * Its records.
   *
   * @example `[{ filePath: "docs/decisions/a.md", text: "---\n…" }]`
   */
  records: PlannedFile[];

  /**
   * The files in it that couldn't be read, which refuse the bundle.
   *
   * @example `[{ filePath: "docs/decisions/b.md", reason: "…" }]`
   */
  skipped: SkippedRecord[];
};

/** A line of a diff: kept, removed, or added. */
type DiffLine = {
  /**
   * The line's text, without its line break.
   *
   * @example `okf_version: "0.2"`
   */
  content: string;

  /**
   * Whether it's in both texts, only the old one, or only the new one.
   *
   * @example "-"
   */
  mark: "-" | " " | "+";
};

/**
 * Print the changes between two texts as a unified diff with no context
 * lines, under `--- a/<path>` and `+++ b/<path>` headers.
 */
export function formatDiff(params: {
  after: string;
  before: string;
  filePath: string;
}): string {
  const { after, before, filePath } = params;
  const lines = diffLines({ after: toLines(after), before: toLines(before) });
  const output = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let oldLine = 1;
  let newLine = 1;

  for (let index = 0; index < lines.length;) {
    const line = lines[index];

    if (line?.mark === " ") {
      oldLine += 1;
      newLine += 1;
      index += 1;
      continue;
    }

    let end = index;

    while (end < lines.length && lines[end]?.mark !== " ") {
      end += 1;
    }

    const hunk = lines.slice(index, end);
    const removed = hunk.filter((entry) => entry.mark === "-").length;
    const added = hunk.length - removed;

    output.push(
      `@@ -${formatRange({ count: removed, start: oldLine })} +${formatRange({ count: added, start: newLine })} @@`,
      ...hunk
        .filter((entry) => entry.mark === "-")
        .map((entry) => `-${entry.content}`),
      ...hunk
        .filter((entry) => entry.mark === "+")
        .map((entry) => `+${entry.content}`)
    );
    oldLine += removed;
    newLine += added;
    index = end;
  }

  return output.join("\n");
}

/**
 * Run `okf migrate` over the bundles: print each plan, write it under
 * `--write`, or under `--check` only report the bundles that need it.
 *
 * - Exits `1` when a bundle can't be migrated, or under `--check` when one
 *   still needs migrating; a dry run that plans changes exits `0`.
 */
export function runMigrate(params: {
  context: BundleContext;
  mode: MigrateMode;
}): ExitCode {
  const { context, mode } = params;
  const { bundleDirs, excludeGlobs, output, repoRoot } = context;

  const loaded = loadCandidates({
    bundleDirs,
    excludeGlobs,
    isReadOnly: true,
    repoRoot,
    verifiedBy: NO_SIGNER,
  });

  if (!loaded.isOk) {
    output.error(loaded.reason);

    return EXIT_CODES.failure;
  }

  const workingPaths = listWorkingPaths(repoRoot);
  let isFailed = false;

  for (const bundleDir of bundleDirs) {
    const files = readBundleFiles({
      bundleDir,
      bundleDirs,
      excludeGlobs,
      loaded: loaded.value,
      repoRoot,
      workingPaths,
    });
    for (const { reason } of files.skipped) {
      // A reason names its file, and may quote the file's own text.
      output.error(
        toTerminalLine(
          `Blocked: ${reason.trimEnd().replace(/\.$/u, "")}; its paths can't be checked.`
        )
      );
    }

    const plan: BundlePlan =
      files.skipped.length > 0
        ? { changes: [], declared: undefined, notes: [], state: "refused" }
        : planBundle({
            bundleDir,
            doesExist: (filePath) => existsSync(path.join(repoRoot, filePath)),
            indexText: files.indexText,
            records: files.records,
          });

    const isOk = reportPlan({ bundleDir, context, mode, plan });

    isFailed ||= !isOk;
  }

  return isFailed ? EXIT_CODES.failure : EXIT_CODES.ok;
}

/**
 * Diff two lists of lines: kept lines in step, and each run of changes ending
 * at the nearest line the two share again.
 *
 * - The migration replaces lines in place and inserts a few, so the nearest
 *   shared line is the right one; it isn't a minimal diff in general.
 *
 * - Within a run of changes, every removed line comes before every added one.
 */
function diffLines(params: {
  after: readonly string[];
  before: readonly string[];
}): DiffLine[] {
  const { after, before } = params;
  const lines: DiffLine[] = [];
  let left = 0;
  let right = 0;

  for (
    let kept = before[left];
    left < before.length || right < after.length;
    kept = before[left]
  ) {
    if (kept !== undefined && kept === after[right]) {
      lines.push({ content: kept, mark: " " });
      left += 1;
      right += 1;
      continue;
    }

    const next = findSharedLine({ after, before, left, right });

    lines.push(
      ...before
        .slice(left, next.left)
        .map((content): DiffLine => ({ content, mark: "-" })),
      ...after
        .slice(right, next.right)
        .map((content): DiffLine => ({ content, mark: "+" }))
    );
    left = next.left;
    right = next.right;
  }

  return lines;
}

/**
 * Find the bundle a file belongs to: the deepest one that holds it, so a
 * bundle inside another owns its own records.
 */
function findOwner(params: {
  bundleDirs: readonly string[];
  filePath: string;
}): string | undefined {
  const { bundleDirs, filePath } = params;

  const key = toPathKey(filePath);

  return bundleDirs
    .filter(
      (bundleDir) =>
        bundleDir === "." || key.startsWith(`${toPathKey(bundleDir)}/`)
    )
    .sort((left, right) => right.length - left.length)[0];
}

/**
 * Find the nearest pair of positions, from `left` and `right` on, where the
 * two lists hold the same line, or their ends when there's none.
 */
function findSharedLine(params: {
  after: readonly string[];
  before: readonly string[];
  left: number;
  right: number;
}): { left: number; right: number } {
  const { after, before, left, right } = params;
  let best = { left: before.length, right: after.length };

  for (const [offset, line] of before.slice(left).entries()) {
    const match = after.indexOf(line, right);
    const candidate = { left: left + offset, right: match };

    if (
      match !== -1 &&
      candidate.left + candidate.right < best.left + best.right
    ) {
      best = candidate;
    }
  }

  return best;
}

/** Write a hunk range: its start line, and its line count unless it's one. */
function formatRange(params: { count: number; start: number }): string {
  const { count, start } = params;

  if (count === 0) {
    return `${start - 1},0`;
  }

  return count === 1 ? `${start}` : `${start},${count}`;
}

/** The path of a bundle's root `index.md`, from the repo root. */
function indexPathOf(bundleDir: string): string {
  return path.posix.join(bundleDir, "index.md");
}

/** Print a note on the stream its level goes to. */
function printNote(params: {
  context: BundleContext;
  note: MigrateNote;
}): void {
  const { context, note } = params;
  const line = toTerminalLine(`${note.filePath} ${note.message}.`);

  if (note.level === "filled") {
    context.output.info(line);
  } else {
    context.output.error(
      `${note.level === "blocked" ? "Blocked:" : "Check:"} ${line}`
    );
  }
}

/**
 * Read a bundle's root `index.md` and its records from what the load found,
 * each record counted in the deepest bundle that holds it.
 */
function readBundleFiles(params: {
  bundleDir: string;
  bundleDirs: readonly string[];
  excludeGlobs: readonly string[];
  loaded: {
    candidates: readonly PlannedFile[];
    skipped: readonly SkippedRecord[];
  };
  repoRoot: string;
  workingPaths: readonly string[];
}): BundleFiles {
  const {
    bundleDir,
    bundleDirs,
    excludeGlobs,
    loaded,
    repoRoot,
    workingPaths,
  } = params;
  const isOwn = (filePath: string): boolean =>
    findOwner({ bundleDirs, filePath }) === bundleDir;
  const isExcluded = matchExcluded(excludeGlobs);
  const indexPath = indexPathOf(bundleDir);
  const skipped = loaded.skipped.filter((file) => isOwn(file.filePath));
  const records = loaded.candidates
    .filter((file) => isOwn(file.filePath))
    .map(({ filePath, text }) => ({ filePath, text }));
  const read = (filePath: string): string | undefined => {
    const result = readLinkedFile({ filePath, repoRoot });

    if (!result.isOk) {
      skipped.push({ filePath, reason: result.reason });
    }

    return result.isOk ? result.value : undefined;
  };

  const known = new Set([
    ...records.map((file) => file.filePath),
    ...skipped.map((file) => file.filePath),
  ]);

  // A folder's index.md and log.md, and Markdown with no frontmatter, hold
  // links too, which the version bump changes like a record's; files at the
  // bundle root read the same under both rules.
  for (const filePath of workingPaths) {
    if (
      filePath.endsWith(".md") &&
      path.posix.dirname(filePath) !== bundleDir &&
      !known.has(filePath) &&
      !filePath.split("/").some((part) => part.startsWith(".")) &&
      isOwn(filePath) &&
      !isExcluded(filePath) &&
      existsSync(path.join(repoRoot, filePath))
    ) {
      const text = read(filePath);

      if (text !== undefined) {
        records.push({ filePath, text });
      }
    }
  }

  return {
    indexText: existsSync(path.join(repoRoot, indexPath))
      ? read(indexPath)
      : undefined,
    records,
    skipped,
  };
}

/**
 * Read a bundle file that isn't a record, such as an `index.md`, refusing a
 * symlink, as records are, since a write would go through it.
 */
function readLinkedFile(params: {
  filePath: string;
  repoRoot: string;
}): Outcome<string> {
  const { filePath, repoRoot } = params;

  try {
    if (lstatSync(path.join(repoRoot, filePath)).isSymbolicLink()) {
      return {
        isOk: false,
        reason: `${filePath} is a symlink, which is written only at its own path`,
      };
    }

    return { isOk: true, value: readRecordText({ filePath, repoRoot }) };
  } catch (error) {
    return {
      isOk: false,
      reason: `${filePath} can't be read: ${describeError(error)}`,
    };
  }
}

/**
 * Print one bundle's plan, and write it under `--write`.
 *
 * @returns whether the bundle came out as the mode wants it: current, or
 * migrated or migratable outside `--check`.
 */
function reportPlan(params: {
  bundleDir: string;
  context: BundleContext;
  mode: MigrateMode;
  plan: BundlePlan;
}): boolean {
  const { bundleDir, context, mode, plan } = params;
  const { output, repoRoot } = context;
  const from = `v${plan.declared ?? UNDECLARED_VERSION}${plan.declared === undefined ? " (undeclared)" : ""}`;

  if (plan.state === "current") {
    output.info(`${bundleDir} is already on OKF v${SUPPORTED_SPEC_VERSION}.`);

    return true;
  }

  for (const note of plan.notes) {
    printNote({ context, note });
  }

  if (plan.state === "refused") {
    output.error(
      toTerminalLine(
        `${bundleDir} can't be migrated until the problems above are settled.`
      )
    );

    return false;
  }

  const count = `${plan.changes.length} file${plan.changes.length === 1 ? "" : "s"}`;

  if (mode === "check") {
    output.error(
      `${bundleDir} is on OKF ${from} and needs migrating to v${SUPPORTED_SPEC_VERSION} (${count}); run okf migrate --write.`
    );

    return false;
  }

  if (mode === "dry-run") {
    for (const change of plan.changes) {
      // A line can quote anything a file holds, escape sequences included.
      output.data(
        formatDiff(change)
          .split("\n")
          .map((line) => toTerminalLine(line))
          .join("\n")
      );
    }

    output.info(
      `${bundleDir} would move from OKF ${from} to v${SUPPORTED_SPEC_VERSION}, changing ${count}; run okf migrate --write to apply it.`
    );

    return true;
  }

  // The index, which declares v0.3, goes last, and a failed write restores
  // the others, so a bundle never declares v0.3 over paths left as they were.
  const written = writeRecords({
    edits: [...plan.changes]
      .sort(
        (left, right) =>
          Number(left.filePath === indexPathOf(bundleDir)) -
          Number(right.filePath === indexPathOf(bundleDir))
      )
      .map(({ after, before, filePath }) => ({
        filePath,
        originalText: before,
        text: after,
      })),
    repoRoot,
  });

  if (!written.isOk) {
    output.error(written.reason);

    return false;
  }

  output.info(
    `Migrated ${bundleDir} from OKF ${from} to v${SUPPORTED_SPEC_VERSION}, changing ${count}.`
  );

  return true;
}

/** Split a text into lines for a diff, dropping each line break. */
function toLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\r?\n$/u, "").split(/\r?\n/u);
}
