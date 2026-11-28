/*
 * `okf touch`: re-stamps records' `generated` from the clock after an edit,
 * with `--reason`'s why, all or nothing, and commits nothing.
 */
import type { ExitCode } from "./exit-codes.ts";
import type { TouchOptions } from "./options.ts";
import type { RecordEdit } from "./records.ts";
import type { BundleContext } from "./run-context.ts";

import { describeBadActor, isActor } from "./config.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { touchRecord } from "./frontmatter/touch.ts";
import { NO_SIGNER } from "./index-command.ts";
import { toTerminalLine } from "./output.ts";
import { currentTimestamp } from "./records.ts";
import { loadCandidate, resolveRecordPaths, writeRecords } from "./repo.ts";

/**
 * Run `okf touch`: re-stamp each named record, or write none when any
 * refuses.
 *
 * - Exits `1` when `--by` isn't an actor, a path isn't a record in the
 *   bundles, a record refuses, or a write fails.
 */
export function runTouch(params: {
  context: BundleContext;
  options: TouchOptions;
}): ExitCode {
  const { context, options } = params;
  const { bundleDirs, cwd, excludeGlobs, output, repoRoot } = context;
  const { by, reason, recordPaths, shouldDraft } = options;

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
    const touched = touchRecord({ at, by, reason, shouldDraft, text });

    if (touched.isOk) {
      edits.push({ filePath, originalText: text, text: touched.text });
    } else {
      failures.push(`${filePath}: ${touched.reason}`);
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

  for (const { filePath } of edits) {
    output.info(`Re-stamped ${filePath} at ${at}.`);
  }

  return EXIT_CODES.ok;
}
