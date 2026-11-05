#!/usr/bin/env node
import { run } from "./cli.ts";
import { resolveWorkingDirectory } from "./working-directory.ts";

process.exitCode = await run({
  args: process.argv.slice(2),
  cwd: resolveWorkingDirectory({ cwd: process.cwd(), env: process.env }),
  isInteractive: process.stdin.isTTY && process.stdout.isTTY,
});
