import type { Program } from "./output.ts";

import { run } from "./cli.ts";
import { resolveWorkingDirectory } from "./working-directory.ts";

/**
 * Run a program the package installs from the current process, and keep its
 * exit code.
 */
export async function start(program: Program): Promise<void> {
  process.exitCode = await run({
    args: process.argv.slice(2),
    cwd: resolveWorkingDirectory({ cwd: process.cwd(), env: process.env }),
    isInteractive: process.stdin.isTTY && process.stdout.isTTY,
    program,
  });
}
