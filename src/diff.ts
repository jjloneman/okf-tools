import type { ExitCode } from "./exit-codes.ts";
import type { RunContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { describeError } from "./output.ts";
import { readRecordText, resolveRecordPaths } from "./repo.ts";
import { describeSignOffDiff, readSignOffDiff } from "./sign-off-diff.ts";

/**
 * Print what changed in each named record since the signer's last sign-off,
 * or the whole record when no commit shows that, changing nothing.
 *
 * - A record that can't be read or diffed is reported, and the rest are still
 *   printed.
 *
 * @returns the exit code: `1` when a record can't be found, read, or diffed,
 * else `0`.
 */
export function runDiff(params: {
  context: RunContext;
  recordPaths: readonly string[];
}): ExitCode {
  const { context, recordPaths } = params;
  const { bundleDirs, cwd, excludeGlobs, output, repoRoot, verifiedBy } =
    context;

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

  let code: ExitCode = EXIT_CODES.ok;

  for (const filePath of resolved.value) {
    let text: string;

    try {
      text = readRecordText({ filePath, repoRoot });
    } catch (error) {
      output.error(`${filePath} can't be read: ${describeError(error)}`);
      code = EXIT_CODES.failure;

      continue;
    }

    const diff = readSignOffDiff({ filePath, repoRoot, text, verifiedBy });

    if (!diff.isOk) {
      output.error(diff.reason);
      code = EXIT_CODES.failure;

      continue;
    }

    const { body, heading } = describeSignOffDiff({
      diff: diff.value,
      filePath,
      verifiedBy,
    });

    output.info(body === "" ? heading : `${heading}\n\n${body}`);
  }

  return code;
}
