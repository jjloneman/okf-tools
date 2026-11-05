import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Pick the directory relative paths are resolved from.
 *
 * - pnpm runs a package script from the package root and records where it was
 *   called from in `INIT_CWD`, so `pnpm okf:verify` from a subfolder still
 *   resolves paths from that subfolder.
 *
 * - `INIT_CWD` is inherited by every child process, so it's trusted only while
 *   the process is still in the package root pnpm started the script in (the
 *   folder of `npm_package_json`); a script that changed directory first uses
 *   its own cwd.
 *
 * - The two paths are compared resolved, so a symlink or a different spelling
 *   of the same folder still matches.
 */
export function resolveWorkingDirectory(params: {
  cwd: string;
  env: Readonly<Partial<Record<string, string>>>;
}): string {
  const { cwd, env } = params;
  const { INIT_CWD: initCwd, npm_package_json: packageJsonPath } = env;

  const isInPackageRoot =
    packageJsonPath !== undefined &&
    toRealPath(path.dirname(packageJsonPath)) === toRealPath(cwd);

  return isInPackageRoot ? (initCwd ?? cwd) : cwd;
}

/** Resolve a path through symlinks, or keep it as given when it can't be. */
function toRealPath(directory: string): string {
  try {
    return realpathSync(directory);
  } catch {
    return directory;
  }
}
