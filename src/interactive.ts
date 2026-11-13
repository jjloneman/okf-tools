import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  MULTISELECT_INSTRUCTIONS,
  note,
  outro,
  select,
} from "@clack/prompts";
import path from "node:path";
import { styleText } from "node:util";

import type { ApplyOutcome } from "./apply.ts";
import type { ExitCode } from "./exit-codes.ts";
import type { Candidate } from "./records.ts";
import type { RunContext } from "./run-context.ts";

import {
  applyVerification,
  describeDirtyPaths,
  planVerification,
} from "./apply.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { listChangedPaths } from "./git.ts";
import { describeState, needsSignOff } from "./records.ts";
import { loadCandidates } from "./repo.ts";

/** The checklist's legend entry for clack's toggle-all key. */
const TOGGLE_ALL_INSTRUCTION = `${styleText("dim", "A:")} toggle all`;

/**
 * Verify records through prompts: choose, review, confirm, edit, commit.
 *
 * @returns the exit code; a cancel ends the run with nothing changed and `0`.
 */
export async function runInteractive(context: RunContext): Promise<ExitCode> {
  const { bundleDirs, repoRoot, shouldCommit, verifiedBy } = context;

  intro(`Verify records in ${bundleDirs.join(", ")}`);

  const { hasBranchDiff, paths, statusPaths } = listChangedPaths({
    bundleDirs,
    repoRoot,
  });

  if (!hasBranchDiff) {
    log.warn(
      "Can't diff against the base branch; showing uncommitted changes only."
    );
  }

  const { candidates: all, skipped } = loadCandidates({
    bundleDirs,
    repoRoot,
    verifiedBy,
  });
  const hasSkipped = skipped.length > 0;

  for (const { reason } of skipped) {
    log.warn(`Skipping ${reason}`);
  }

  if (all.length === 0) {
    cancel(describeAllSkipped(skipped.length));

    return EXIT_CODES.failure;
  }

  const changed = all.filter(({ filePath }) => paths.has(filePath));
  const shown = await chooseScope({
    all,
    changed,
    hasSkippedChanges: skipped.some(({ filePath }) => paths.has(filePath)),
  });

  if (shown === undefined) {
    return cancelRun();
  }

  if (!shown.some(needsSignOff)) {
    outro(
      hasSkipped
        ? "Every listed record is already verified; fix the skipped ones above."
        : "Every listed record is already verified."
    );

    return EXIT_CODES.ok;
  }

  const selected = await chooseRecords(shown);

  if (selected === undefined) {
    return cancelRun();
  }

  const plan = planVerification({ context, selected, statusPaths });
  const { dirtyPaths, filePaths, message } = plan;

  note(
    shouldCommit
      ? `${filePaths.join("\n")}\n\n${message}`
      : filePaths.join("\n"),
    shouldCommit ? "Files and commit message" : "Files"
  );

  if (dirtyPaths.length > 0) {
    log.warn(describeDirtyPaths(dirtyPaths));
  }

  const isConfirmed = await confirm({
    message: shouldCommit
      ? "Verify and commit?"
      : "Verify, without committing?",
  });

  if (isCancel(isConfirmed) || !isConfirmed) {
    return cancelRun();
  }

  return reportOutcome({
    count: filePaths.length,
    outcome: applyVerification({ context, plan }),
  });
}

/** Report that nothing changed. */
function cancelRun(): ExitCode {
  cancel("Nothing changed.");

  return EXIT_CODES.ok;
}

/**
 * Ask which of the shown records to verify; an already-verified one is listed
 * but can't be picked.
 *
 * @returns the chosen records, or `undefined` when the person cancels.
 */
async function chooseRecords(
  shown: readonly Candidate[]
): Promise<readonly Candidate[] | undefined> {
  /*
   * clack has no option for the legend's text, so list the toggle-all key in
   * the shared array it reads at render time, then take it back out.
   *
   * - Inserted before `Enter: confirm`, which stays last.
   */
  MULTISELECT_INSTRUCTIONS.splice(-1, 0, TOGGLE_ALL_INSTRUCTION);

  try {
    const chosen = await multiselect({
      message: "Which records do you verify?",
      options: shown.map((candidate) => ({
        disabled: !needsSignOff(candidate),
        hint: describeState(candidate),
        label: `${candidate.summary.title ?? "(untitled)"} — ${path.posix.basename(candidate.filePath)}`,
        value: candidate,
      })),
      required: true,
    });

    return isCancel(chosen) ? undefined : chosen;
  } finally {
    MULTISELECT_INSTRUCTIONS.splice(
      MULTISELECT_INSTRUCTIONS.indexOf(TOGGLE_ALL_INSTRUCTION),
      1
    );
  }
}

/**
 * Decide which records to list: the changed ones, or every one.
 *
 * - Asks only when both lists are non-empty and differ; with nothing changed,
 *   every record is shown.
 *
 * @returns the records to list, or `undefined` when the person cancels.
 */
async function chooseScope(params: {
  all: readonly Candidate[];
  changed: readonly Candidate[];
  hasSkippedChanges: boolean;
}): Promise<readonly Candidate[] | undefined> {
  const { all, changed, hasSkippedChanges } = params;

  if (changed.length === 0) {
    log.info(
      hasSkippedChanges
        ? "Each changed record was skipped; showing every record."
        : "No records changed on this branch; showing every record."
    );

    return all;
  }

  if (changed.length === all.length) {
    return changed;
  }

  const scope = await select({
    message: "Which records?",
    options: [
      { label: `Changed on this branch (${changed.length})`, value: "changed" },
      { label: `Every record (${all.length})`, value: "all" },
    ],
  });

  if (isCancel(scope)) {
    return undefined;
  }

  return scope === "all" ? all : changed;
}

/**
 * Say why there's nothing to list, given how many records were skipped.
 *
 * - With none skipped, the bundles hold no records at all.
 */
function describeAllSkipped(skippedCount: number): string {
  if (skippedCount === 0) {
    return "No records found.";
  }

  return skippedCount === 1
    ? "The only record was skipped; fix it and run again."
    : `All ${skippedCount} records were skipped; fix them and run again.`;
}

/** Close the prompts with what applying the plan did. */
function reportOutcome(params: {
  count: number;
  outcome: ApplyOutcome;
}): ExitCode {
  const { count, outcome } = params;

  switch (outcome.kind) {
    case "commitFailed": {
      cancel(outcome.message);

      return EXIT_CODES.failure;
    }

    case "committed": {
      outro(`Verified ${count}, committed ${outcome.hash}.`);

      return EXIT_CODES.ok;
    }

    case "notWritten": {
      cancel(outcome.message);

      return EXIT_CODES.failure;
    }

    case "written": {
      outro(`Verified ${count}; left uncommitted.`);

      return EXIT_CODES.ok;
    }
  }
}
