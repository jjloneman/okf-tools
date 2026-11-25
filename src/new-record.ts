/*
 * `okf new`: writes a new draft record's frontmatter, stamped from the clock,
 * and syncs the index that lists it.
 *
 * - Everything is worked out before anything is written, so a record it
 *   can't list is never left behind.
 */
import type { ExitCode } from "./exit-codes.ts";
import type { NewOptions } from "./options.ts";
import type { BundleContext } from "./run-context.ts";

import { describeBadActor, isActor } from "./config.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { scaffoldRecord } from "./frontmatter/scaffold.ts";
import { planIndexWithRecord } from "./index-command.ts";
import { toTerminalLine } from "./output.ts";
import { currentTimestamp } from "./records.ts";
import {
  createRecordFile,
  removeRecordFile,
  resolveNewRecordPath,
  writeRecords,
} from "./repo.ts";

/**
 * Run `okf new`: write the record, then its index's new text.
 *
 * - Exits `1`, writing nothing, when `--by` isn't an actor, the path can't
 *   take a new record, or its index can't be synced; a failed index write
 *   removes the record again.
 */
export function runNew(params: {
  context: BundleContext;
  options: NewOptions;
}): ExitCode {
  const { context, options } = params;
  const { bundleDirs, cwd, excludeGlobs, output, repoRoot } = context;
  const { by, description, recordPath, tags, title, type } = options;

  if (!isActor(by)) {
    output.error(describeBadActor(by));

    return EXIT_CODES.failure;
  }

  const resolved = resolveNewRecordPath({
    bundleDirs,
    cwd,
    excludeGlobs,
    recordPath,
    repoRoot,
  });

  if (!resolved.isOk) {
    output.error(resolved.reason);

    return EXIT_CODES.failure;
  }

  const filePath = resolved.value;
  const index = planIndexWithRecord({
    context,
    record: { description, path: filePath, tags, title },
  });

  if (!index.isOk) {
    // A reason can quote a record's own text, such as a YAML error.
    output.error(toTerminalLine(`${index.reason} Nothing was written.`));

    return EXIT_CODES.failure;
  }

  const created = createRecordFile({
    filePath,
    repoRoot,
    text: scaffoldRecord({
      at: currentTimestamp(),
      by,
      description,
      tags,
      title,
      type,
    }),
  });

  if (!created.isOk) {
    output.error(created.reason);

    return EXIT_CODES.failure;
  }

  const edit = index.value;

  if (edit === undefined) {
    output.info(
      `Wrote ${filePath} as a draft. No index.md in its folder or above lists it.`
    );

    return EXIT_CODES.ok;
  }

  if (edit.text === edit.originalText) {
    output.info(
      `Wrote ${filePath} as a draft. ${edit.filePath} already lists it.`
    );

    return EXIT_CODES.ok;
  }

  const written = writeRecords({ edits: [edit], repoRoot });

  if (!written.isOk) {
    const unremoved = removeRecordFile({ filePath, repoRoot });

    output.error(
      unremoved === undefined
        ? `${written.reason}\n${filePath} was removed again.`
        : `${written.reason}\n${filePath} is left behind, since removing it failed: ${unremoved}`
    );

    return EXIT_CODES.failure;
  }

  output.info(
    `Wrote ${filePath} as a draft, and listed it in ${edit.filePath}.`
  );

  return EXIT_CODES.ok;
}
