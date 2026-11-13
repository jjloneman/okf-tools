/*
 * The steps both run modes share once records are chosen: work out the
 * edits, then write and commit them.
 *
 * - Split in two, so the interactive mode can show the plan and ask before
 *   anything is written.
 */
import type { Candidate } from "./records.ts";
import type { RunContext } from "./run-context.ts";

import { commitFiles, listDirtyPaths } from "./git.ts";
import {
  buildCommitMessage,
  currentTimestamp,
  prepareEdits,
} from "./records.ts";
import { readRecordText, writeRecords } from "./repo.ts";

/** What applying a plan did. */
export type ApplyOutcome =
  | {
      /**
       * Nothing was written: a record changed on disk since it was read, or a
       * write failed and the others were restored.
       *
       * @example "notWritten"
       */
      kind: "notWritten";

      /**
       * What to tell the person.
       *
       * @example `"docs/decisions/a.md changed on disk since it was read; nothing written."`
       */
      message: string;
    }
  | {
      /**
       * The commit's short hash.
       *
       * @example "1a2b3c4"
       */
      hash: string;

      /**
       * The files were written and committed.
       *
       * @example "committed"
       */
      kind: "committed";
    }
  | {
      /**
       * The commit failed after the files were written.
       *
       * @example "commitFailed"
       */
      kind: "commitFailed";

      /**
       * What to tell the person.
       *
       * @example `"The files are edited on disk but the commit failed:\nhook says no"`
       */
      message: string;
    }
  | {
      /**
       * The files were written, and left uncommitted on purpose.
       *
       * @example "written"
       */
      kind: "written";
    };

/** What a run is about to do, before anything is written. */
export type VerificationPlan = {
  /**
   * The chosen records, as they were read; the edits are rebuilt from them at
   * write time, with that moment's timestamp.
   *
   * @example `[]`
   */
  candidates: readonly Candidate[];

  /**
   * The chosen records that have other uncommitted changes, which a commit
   * will include; empty when the run doesn't commit.
   *
   * @example `["docs/decisions/package-promise.md"]`
   */
  dirtyPaths: string[];

  /**
   * The chosen records' paths from the repo root.
   *
   * @example `["docs/decisions/package-promise.md"]`
   */
  filePaths: string[];

  /**
   * The commit message.
   *
   * @example `"docs(decisions): 📝 verify 1 decision record\n\n- A (a.md)"`
   */
  message: string;
};

/**
 * Write the plan's edits, then commit them unless the run says not to.
 *
 * - Every record is read again first: if one changed on disk since the plan
 *   was made (an edit saved while the prompt was open), nothing is written.
 *
 * - The edits are rebuilt with the current time, so `verified.at` is when the
 *   person confirmed, not when the checklist opened.
 */
export function applyVerification(params: {
  context: Pick<RunContext, "repoRoot" | "shouldCommit" | "verifiedBy">;
  plan: VerificationPlan;
}): ApplyOutcome {
  const { context, plan } = params;
  const { repoRoot, shouldCommit, verifiedBy } = context;
  const { candidates, filePaths, message } = plan;

  const changedPaths = candidates
    .filter(
      ({ filePath, text }) => readRecordText({ filePath, repoRoot }) !== text
    )
    .map(({ filePath }) => filePath);

  if (changedPaths.length > 0) {
    return {
      kind: "notWritten",
      message: `${changedPaths.join(", ")} changed on disk since it was read; nothing written.`,
    };
  }

  // Listing checked these same texts, so this only guards against the two
  // checks ever disagreeing: all or nothing, as before.
  const { edits, failures } = prepareEdits({
    at: currentTimestamp(),
    candidates,
    verifiedBy,
  });

  if (failures.length > 0) {
    return {
      kind: "notWritten",
      message: `No files changed.\n${failures.join("\n")}`,
    };
  }

  const written = writeRecords({ edits, repoRoot });

  if (!written.isOk) {
    return { kind: "notWritten", message: written.reason };
  }

  if (!shouldCommit) {
    return { kind: "written" };
  }

  const commit = commitFiles({ filePaths, message, repoRoot });

  return commit.isOk
    ? { hash: commit.hash, kind: "committed" }
    : {
        kind: "commitFailed",
        message: `The files are edited on disk but the commit failed:\n${commit.reason}`,
      };
}

/** Word the warning about chosen records that have other uncommitted changes. */
export function describeDirtyPaths(dirtyPaths: readonly string[]): string {
  return `These also have other uncommitted changes, which the commit will include:\n${dirtyPaths.join("\n")}`;
}

/**
 * Work out what verifying the chosen records will do, without writing.
 *
 * - Listing already left out any record the edits refuse, and
 *   `applyVerification` checks again before writing.
 *
 * - `statusPaths` is what `git status` already reported this run, when the
 *   caller has it, so the dirty check needn't ask again.
 */
export function planVerification(params: {
  context: Pick<RunContext, "repoRoot" | "shouldCommit">;
  selected: readonly Candidate[];
  statusPaths?: ReadonlySet<string>;
}): VerificationPlan {
  const { context, selected, statusPaths } = params;
  const { repoRoot, shouldCommit } = context;

  const filePaths = selected.map(({ filePath }) => filePath);

  const dirtyPaths =
    statusPaths === undefined
      ? listDirtyPaths({ filePaths, repoRoot })
      : filePaths.filter((filePath) => statusPaths.has(filePath));

  return {
    candidates: selected,
    dirtyPaths: shouldCommit ? dirtyPaths : [],
    filePaths,
    message: buildCommitMessage(selected),
  };
}
