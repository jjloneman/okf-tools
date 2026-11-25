/*
 * `okf deprecate`: marks records `status: deprecated`, naming the record that
 * replaces them when there is one, re-stamps their `generated` from the
 * clock, all or nothing, and commits nothing.
 */
import path from "node:path";

import type { ExitCode } from "./exit-codes.ts";
import type { DeprecateOptions } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { RecordEdit } from "./records.ts";
import type { BundleContext } from "./run-context.ts";

import { describeBadActor, isActor } from "./config.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { deprecateRecord } from "./frontmatter/deprecate.ts";
import { toPathKey } from "./git.ts";
import { NO_SIGNER } from "./index-command.ts";
import { toTerminalLine } from "./output.ts";
import { currentTimestamp } from "./records.ts";
import {
  findBundleDir,
  loadCandidate,
  resolveRecordPaths,
  writeRecords,
} from "./repo.ts";

/**
 * Run `okf deprecate`: deprecate each named record, or write none when any
 * refuses.
 *
 * - Exits `1` when `--by` isn't an actor, a path isn't a record in the
 *   bundles, the replacement isn't a record in the same bundle as each one
 *   it replaces, or is one of them, a record refuses, or a write fails.
 */
export function runDeprecate(params: {
  context: BundleContext;
  options: DeprecateOptions;
}): ExitCode {
  const { context, options } = params;
  const { bundleDirs, cwd, excludeGlobs, output, repoRoot } = context;
  const { by, recordPaths, supersededBy } = options;

  if (!isActor(by)) {
    output.error(describeBadActor(by));

    return EXIT_CODES.failure;
  }

  const resolved = resolveRecordPaths({
    bundleDirs,
    cwd,
    excludeGlobs,
    recordPaths,
    repoRoot,
  });

  if (!resolved.isOk) {
    output.error(resolved.reason);

    return EXIT_CODES.failure;
  }

  const replacement =
    supersededBy === undefined
      ? undefined
      : resolveReplacement({
          context,
          filePaths: resolved.value,
          supersededBy,
        });

  if (replacement?.isOk === false) {
    output.error(replacement.reason);

    return EXIT_CODES.failure;
  }

  const at = currentTimestamp();
  const edits: RecordEdit[] = [];
  const failures: string[] = [];

  for (const filePath of resolved.value) {
    const loaded = loadCandidate({
      filePath,
      isReadOnly: true,
      repoRoot,
      verifiedBy: NO_SIGNER,
    });

    if (loaded.kind !== "record") {
      failures.push(loaded.reason);
      continue;
    }

    const { text } = loaded.candidate;
    const deprecated = deprecateRecord({
      at,
      by,
      supersededBy: replacement?.value,
      text,
    });

    if (deprecated.isOk) {
      edits.push({ filePath, originalText: text, text: deprecated.text });
    } else {
      failures.push(`${filePath}: ${deprecated.reason}`);
    }
  }

  if (failures.length > 0) {
    // A reason can quote a record's own text, such as a YAML error.
    for (const failure of failures) {
      output.error(toTerminalLine(failure));
    }

    output.error("Nothing was written.");

    return EXIT_CODES.failure;
  }

  const written = writeRecords({ edits, repoRoot });

  if (!written.isOk) {
    output.error(written.reason);

    return EXIT_CODES.failure;
  }

  const suffix =
    replacement === undefined ? "" : `, superseded by ${replacement.value}`;

  for (const { filePath } of edits) {
    output.info(`Deprecated ${filePath}${suffix}.`);
  }

  return EXIT_CODES.ok;
}

/**
 * Resolve `--superseded-by` to the path `superseded_by` holds: from the
 * bundle root, with a leading `/`, which OKF v0.3 reads the same from any
 * record in the bundle.
 *
 * - It must be a record in the same bundle as every record it replaces, and
 *   none of them, since a path field names a record in its own bundle.
 */
function resolveReplacement(params: {
  context: BundleContext;
  filePaths: readonly string[];
  supersededBy: string;
}): Outcome<string> {
  const { context, filePaths, supersededBy } = params;
  const { bundleDirs, cwd, excludeGlobs, repoRoot } = context;
  const resolved = resolveRecordPaths({
    bundleDirs,
    cwd,
    excludeGlobs,
    recordPaths: [supersededBy],
    repoRoot,
  });

  if (!resolved.isOk) {
    return { isOk: false, reason: `--superseded-by: ${resolved.reason}` };
  }

  // One path in gives one path out.
  const [target = ""] = resolved.value;
  const loaded = loadCandidate({
    filePath: target,
    isReadOnly: true,
    repoRoot,
    verifiedBy: NO_SIGNER,
  });

  if (loaded.kind !== "record") {
    return {
      isOk: false,
      reason: `--superseded-by: ${toTerminalLine(loaded.reason)}`,
    };
  }

  const targetKey = toPathKey(target);

  if (filePaths.some((filePath) => toPathKey(filePath) === targetKey)) {
    return {
      isOk: false,
      reason: `${supersededBy} can't supersede itself.`,
    };
  }

  // Every record named was resolved inside a bundle, so finding one that
  // holds them all and the replacement means they share it.
  const bundleDir = bundleDirs.find((candidate) =>
    [target, ...filePaths].every(
      (filePath) => findBundleDir({ bundleDirs, filePath }) === candidate
    )
  );

  if (bundleDir === undefined) {
    return {
      isOk: false,
      reason: `${supersededBy} isn't in the same bundle as every record it replaces.`,
    };
  }

  return {
    isOk: true,
    value: `/${path.posix.relative(bundleDir, target)}`,
  };
}
