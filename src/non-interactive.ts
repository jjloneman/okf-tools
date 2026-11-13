import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { CliOptions } from "./options.ts";
import type { Candidate } from "./records.ts";
import type { RunContext } from "./run-context.ts";

import {
  applyVerification,
  describeDirtyPaths,
  planVerification,
} from "./apply.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { listChangedPaths } from "./git.ts";
import { printError, printInfo } from "./output.ts";
import { needsSignOff } from "./records.ts";
import { loadCandidate, loadCandidatesAt, resolveRecordPaths } from "./repo.ts";

/** The records a run would consider, or why they can't be loaded. */
type LoadResult =
  | {
      /**
       * The records.
       *
       * @example `[]`
       */
      candidates: Candidate[];

      /**
       * Whether they loaded; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * What `git status` reported while loading, when it was asked.
       *
       * @example `new Set(["docs/decisions/a.md"])`
       */
      statusPaths?: ReadonlySet<string>;
    }
  | {
      /**
       * Whether they loaded; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not.
       *
       * @example "No record at docs/decisions/missing.md."
       */
      reason: string;
    };

/**
 * Verify records with no prompts: every changed record still needing a
 * sign-off (`--changed`), or the records named on the command line.
 *
 * - A named record that's already verified is skipped, not an error.
 */
export function runNonInteractive(params: {
  context: RunContext;
  options: Pick<CliOptions, "isChanged" | "recordPaths">;
}): ExitCode {
  const { context, options } = params;
  const loaded = options.isChanged
    ? loadChanged(context)
    : loadNamed({ context, recordPaths: options.recordPaths });

  if (!loaded.isOk) {
    printError(loaded.reason);

    return EXIT_CODES.failure;
  }

  loaded.candidates
    .filter((candidate) => !needsSignOff(candidate))
    .forEach(({ filePath }) => {
      printInfo(`skipped ${filePath}: already verified, unchanged`);
    });

  const selected = loaded.candidates.filter(needsSignOff);

  if (selected.length === 0) {
    printInfo("Nothing to verify.");

    return EXIT_CODES.nothingToVerify;
  }

  return applySelection({
    context,
    selected,
    statusPaths: loaded.statusPaths,
  });
}

/** Edit, then commit unless told not to, reporting each step. */
function applySelection(params: {
  context: RunContext;
  selected: readonly Candidate[];
  statusPaths: ReadonlySet<string> | undefined;
}): ExitCode {
  const { context, selected, statusPaths } = params;

  const plan = planVerification({
    context,
    selected,
    ...(statusPaths === undefined ? {} : { statusPaths }),
  });

  if (plan.dirtyPaths.length > 0) {
    printInfo(describeDirtyPaths(plan.dirtyPaths));
  }

  const outcome = applyVerification({ context, plan });

  const printVerified = (): void => {
    plan.filePaths.forEach((filePath) => {
      printInfo(`verified ${filePath}`);
    });
  };

  switch (outcome.kind) {
    case "commitFailed": {
      printVerified();
      printError(outcome.message);

      return EXIT_CODES.failure;
    }

    case "committed": {
      printVerified();
      printInfo(`committed ${outcome.hash}`);

      return EXIT_CODES.ok;
    }

    case "notWritten": {
      printError(outcome.message);

      return EXIT_CODES.failure;
    }

    case "written": {
      printVerified();
      printInfo("Left uncommitted (--no-commit).");

      return EXIT_CODES.ok;
    }
  }
}

/** Load every changed record in the bundles. */
function loadChanged(context: RunContext): LoadResult {
  const { bundleDirs, repoRoot, verifiedBy } = context;
  const { hasBranchDiff, paths, statusPaths } = listChangedPaths({
    bundleDirs,
    repoRoot,
  });

  if (!hasBranchDiff) {
    printInfo(
      "Can't diff against the base branch; using uncommitted changes only."
    );
  }

  // Bundle order, then file name in code-unit order, as `loadCandidates`
  // lists them for the interactive checklist.
  const filePaths = bundleDirs.flatMap((bundleDir) =>
    [...paths]
      .filter((changedPath) => path.posix.dirname(changedPath) === bundleDir)
      .sort()
  );

  const { candidates, skipped } = loadCandidatesAt({
    bundleDirs,
    filePaths,
    repoRoot,
    verifiedBy,
  });

  // A changed record left out unseen would read as signed off, so it fails.
  if (skipped.length > 0) {
    return {
      isOk: false,
      reason: skipped.map(({ reason }) => reason).join("\n"),
    };
  }

  return { candidates, isOk: true, statusPaths };
}

/** Load the records named on the command line. */
function loadNamed(params: {
  context: RunContext;
  recordPaths: readonly string[];
}): LoadResult {
  const { context, recordPaths } = params;
  const { bundleDirs, cwd, repoRoot, verifiedBy } = context;

  const resolved = resolveRecordPaths({
    bundleDirs,
    cwd,
    recordPaths,
    repoRoot,
  });

  if (!resolved.isOk) {
    return resolved;
  }

  const candidates: Candidate[] = [];

  for (const filePath of resolved.value) {
    const record = loadCandidate({ filePath, repoRoot, verifiedBy });

    if (record.kind !== "record") {
      return { isOk: false, reason: record.reason };
    }

    candidates.push(record.candidate);
  }

  return { candidates, isOk: true };
}
