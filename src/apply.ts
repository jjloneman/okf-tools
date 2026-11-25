/*
 * The steps both run modes share once records are chosen: work out the
 * edits, then write and commit them.
 *
 * - Split in two, so the interactive mode can show the plan and ask before
 *   anything is written.
 */
import type { RecordSummary } from "./frontmatter/read.ts";
import type { Timestamp } from "./frontmatter/types.ts";
import type { Outcome } from "./outcome.ts";
import type { Candidate } from "./records.ts";
import type { RunContext } from "./run-context.ts";

import { verifyRecord } from "./frontmatter/edit.ts";
import {
  getRecordState,
  isVerifiedAhead,
  readRecordSummary,
} from "./frontmatter/read.ts";
import { ENTRY_STYLES } from "./frontmatter/types.ts";
import {
  checkCommittable,
  commitFiles,
  listDirtyPaths,
  readCommittedText,
  toPathKey,
} from "./git.ts";
import { describeError } from "./output.ts";
import {
  buildCommitMessage,
  currentTimestamp,
  needsSignOff,
  prepareEdits,
  writeStaleAfter,
} from "./records.ts";
import { isRecordUnchanged, writeRecords } from "./repo.ts";

/** What applying a plan did. */
export type ApplyOutcome =
  | {
      /**
       * Nothing was written: a record changed on disk or became unreadable
       * since it was read, git would refuse the commit, or a write failed
       * and the others were restored; the message names any record the
       * restore couldn't put back.
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

/** The sign-offs on disk that `HEAD` doesn't hold yet. */
export type UncommittedSignOffs = {
  /**
   * The verified records whose sign-off isn't committed.
   *
   * @example `new Set(["docs/decisions/a.md"])`
   */
  paths: ReadonlySet<string>;

  /**
   * Those whose only change from `HEAD` is the sign-off, so the warning about
   * other uncommitted changes leaves them out.
   *
   * @example `new Set(["docs/decisions/a.md"])`
   */
  signOffOnlyPaths: ReadonlySet<string>;
};

/** What a run is about to do, before anything is written. */
export type VerificationPlan = {
  /**
   * The chosen records to edit, as they were read; the edits are rebuilt from
   * them at write time, with that moment's timestamp.
   *
   * @example `[]`
   */
  candidates: readonly Candidate[];

  /**
   * The edited records that have other uncommitted changes, which a commit
   * will include; empty when the run doesn't commit.
   *
   * @example `["docs/decisions/package-promise.md"]`
   */
  dirtyPaths: string[];

  /**
   * The chosen records' paths from the repo root, the edited and the
   * uncommitted alike: what the commit names.
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

  /**
   * The chosen records already verified on disk but not committed, which the
   * commit takes as they are, with no edit.
   *
   * @example `[]`
   */
  uncommitted: readonly Candidate[];
};

/**
 * Write the plan's edits, then commit them unless the run says not to.
 *
 * - Every record is read again first: if one changed on disk since the plan
 *   was made (an edit saved while the prompt was open), or can't be read any
 *   more, nothing is written.
 *
 * - A committing run asks git first whether it would commit these files, so
 *   a refusal git is known to make leaves them as they were.
 *
 * - The edits are rebuilt with the current time, so `verified.at` is when the
 *   person confirmed, not when the checklist opened.
 */
export function applyVerification(params: {
  context: Pick<
    RunContext,
    "repoRoot" | "shouldCommit" | "staleIn" | "style" | "verifiedBy"
  >;
  plan: VerificationPlan;
}): ApplyOutcome {
  const { context, plan } = params;
  const { repoRoot, shouldCommit, staleIn, style, verifiedBy } = context;
  const { candidates, filePaths, message, uncommitted } = plan;

  const changedPaths: string[] = [];

  for (const { filePath, text } of [...candidates, ...uncommitted]) {
    let isUnchanged: boolean;

    try {
      isUnchanged = isRecordUnchanged({ filePath, repoRoot, text });
    } catch (error) {
      return {
        kind: "notWritten",
        message: `${filePath} can't be read any more: ${describeError(error)}\nNo files changed.`,
      };
    }

    if (!isUnchanged) {
      changedPaths.push(filePath);
    }
  }

  if (changedPaths.length > 0) {
    return {
      kind: "notWritten",
      message: `${changedPaths.join(", ")} changed on disk since it was read; nothing written.`,
    };
  }

  if (shouldCommit) {
    const committable = checkCommittable({ filePaths, repoRoot });

    if (!committable.isOk) {
      return {
        kind: "notWritten",
        message: `${committable.reason}\nNo files changed.`,
      };
    }
  }

  // Listing checked these same texts for the sign-off, so this guards
  // against the two checks ever disagreeing, and refuses a `stale_after` that
  // `--stale-in` can't overwrite, which listing doesn't check: all or nothing,
  // as before.
  const { edits, failures } = prepareEdits({
    at: currentTimestamp(),
    candidates,
    staleIn,
    style,
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
 * Pick out the records whose sign-off is on disk but not committed, such as
 * after a hook rejected the commit, so a re-run can commit them as they are.
 *
 * - A verified record counts when `HEAD` lacks it, `HEAD`'s copy still needs
 *   a sign-off, or the sign-off on disk is later than the one `HEAD` holds.
 *   When `HEAD`'s sign-off is ahead of the clock, only `HEAD`'s text with the
 *   sign-off renewed counts.
 *   So a committed sign-off, or an older one restored over it, is never
 *   committed as a new one.
 *
 * - `git status` must report it too, and is asked only when `HEAD` leaves
 *   some record in doubt, so a run whose sign-offs are all committed never
 *   needs it. That leaves out a file git won't stage, such as an ignored
 *   one, and a path git sees as unchanged, such as a symlink.
 *
 * - When `HEAD` can't be read, the record is left out, as it would have been
 *   before: skipped as already verified.
 */
export function findUncommittedSignOffs(params: {
  candidates: readonly Candidate[];
  context: Pick<RunContext, "repoRoot" | "verifiedBy">;
}): Outcome<UncommittedSignOffs> {
  const { candidates, context } = params;
  const { repoRoot, verifiedBy } = context;
  const signOffOnlyPaths = new Set<string>();
  const filePaths: string[] = [];

  candidates.forEach((candidate) => {
    const { filePath, summary, text } = candidate;
    const { verifiedAt } = summary;

    if (verifiedAt === undefined || needsSignOff(candidate)) {
      return;
    }

    const committed = readCommittedText({ filePath, repoRoot });

    if (!committed.isOk) {
      return;
    }

    const headText = committed.value;
    const headSummary =
      headText === undefined
        ? undefined
        : readRecordSummary({ text: headText, verifiedBy });

    const isSignOffOnly =
      headText !== undefined &&
      isSignOffOf({ at: verifiedAt, headText, text, verifiedBy });

    // A sign-off in HEAD dated ahead of the clock is later than any made now,
    // so only a renewal of HEAD's own text counts as a new one, never an
    // older revision restored over it.
    if (
      headSummary !== undefined &&
      getRecordState(headSummary) === "verified" &&
      (isVerifiedAhead(headSummary)
        ? !isSignOffOnly
        : !isLater({ earlier: headSummary, later: verifiedAt }))
    ) {
      return;
    }

    filePaths.push(filePath);

    if (isSignOffOnly) {
      signOffOnlyPaths.add(filePath);
    }
  });

  if (filePaths.length === 0) {
    return { isOk: true, value: { paths: new Set(), signOffOnlyPaths } };
  }

  const dirty = listDirtyPaths({ filePaths, repoRoot });

  return dirty.isOk
    ? { isOk: true, value: { paths: new Set(dirty.value), signOffOnlyPaths } }
    : dirty;
}

/**
 * Work out what verifying the chosen records will do, without writing.
 *
 * - Listing already left out any record the edits refuse, and
 *   `applyVerification` checks again before writing.
 *
 * - `statusPaths` is what `git status` reported for the records, files new
 *   to `HEAD` left out, each as its `toPathKey`, read by the caller, so
 *   planning never calls git and can't fail.
 *
 * - A record in `uncommitted.paths` is committed as it is, not edited, and is
 *   warned about only when it changed by more than the sign-off.
 */
export function planVerification(params: {
  context: Pick<RunContext, "bundleDirs" | "shouldCommit">;
  selected: readonly Candidate[];
  statusPaths: ReadonlySet<string>;
  uncommitted?: UncommittedSignOffs;
}): VerificationPlan {
  const {
    context,
    selected,
    statusPaths,
    uncommitted = { paths: new Set(), signOffOnlyPaths: new Set() },
  } = params;
  const { bundleDirs, shouldCommit } = context;

  const isUncommitted = ({ filePath }: Candidate): boolean =>
    uncommitted.paths.has(filePath);

  const candidates = selected.filter((candidate) => !isUncommitted(candidate));
  const dirtyPaths = selected
    .map(({ filePath }) => filePath)
    .filter(
      (filePath) =>
        statusPaths.has(toPathKey(filePath)) &&
        !uncommitted.signOffOnlyPaths.has(filePath)
    );

  return {
    candidates,
    dirtyPaths: shouldCommit ? dirtyPaths : [],
    filePaths: selected.map(({ filePath }) => filePath),
    message: buildCommitMessage({ bundleDirs, selected }),
    uncommitted: selected.filter(isUncommitted),
  };
}

/**
 * Whether a sign-off time is later than the one a record holds, read the way
 * a record's state is read.
 *
 * - `getRecordState` calls a record `verified` when it was generated no later
 *   than it was signed, so a sign-off taken as the generation time is later
 *   exactly when the state comes out `changed`.
 */
function isLater(params: {
  earlier: RecordSummary;
  later: Timestamp;
}): boolean {
  const { earlier, later } = params;

  return getRecordState({ ...earlier, generatedAt: later }) === "changed";
}

/**
 * Whether a record on disk is `HEAD`'s copy with only the sign-off added: the
 * same edits, at the same time, in any style, give the same text.
 *
 * - Every style is tried, so a sign-off written before `okf.style` changed
 *   still counts as one.
 *
 * - The disk's own `stale_after` is written too, so a sign-off made with
 *   `--stale-in` still counts as one.
 */
function isSignOffOf(params: {
  at: Timestamp;
  headText: string;
  text: string;
  verifiedBy: string;
}): boolean {
  const { at, headText, text, verifiedBy } = params;
  const staleAfter = readRecordSummary({ text, verifiedBy })?.staleAfter;

  return Object.values(ENTRY_STYLES).some((style) => {
    const result = verifyRecord({ at, style, text: headText, verifiedBy });

    if (!result.isOk) {
      return false;
    }

    if (result.text === text) {
      return true;
    }

    if (staleAfter === undefined) {
      return false;
    }

    const withStaleAfter = writeStaleAfter({ staleAfter, text: result.text });

    return withStaleAfter.isOk && withStaleAfter.text === text;
  });
}
