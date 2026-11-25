import { realpathSync } from "node:fs";
import path from "node:path";

import { findRepoRoot } from "./git.ts";

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
 * - `pnpm --dir <package>` and `npm --prefix <package>` set `INIT_CWD` to the
 *   caller's folder, which can be another repo, so it's trusted only when it's
 *   in the same repo as the package. A subfolder and a monorepo root running
 *   the script with a filter both are.
 *
 * - The package root is compared resolved, so a symlink or a different
 *   spelling of the same folder still matches; git resolves the repo roots.
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

  if (!isInPackageRoot || initCwd === undefined) {
    return cwd;
  }

  return isInSameRepo({ cwd, initCwd }) ? initCwd : cwd;
}

/**
 * Spell the working directory so paths resolved from it fall inside the repo
 * as git spells its root.
 *
 * - Kept as given when it's already inside, so a drive mapped onto another
 *   folder, which git keeps unresolved, still matches.
 *
 * - Otherwise resolved, through symlinks and into the disk's case and Unicode
 *   form, as git resolves its root.
 */
export function spellLikeRepoRoot(params: {
  cwd: string;
  repoRoot: string;
}): string {
  const { cwd, repoRoot } = params;
  const relativePath = path.relative(repoRoot, cwd);

  const isInside =
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath);

  return isInside ? cwd : realpathSync.native(cwd);
}

/** Whether `initCwd` is in the same git repo as `cwd`; false outside any. */
function isInSameRepo(params: { cwd: string; initCwd: string }): boolean {
  const { cwd, initCwd } = params;
  const cwdRoot = findRepoRoot(cwd);
  const initCwdRoot = findRepoRoot(initCwd);

  return (
    cwdRoot.isOk && initCwdRoot.isOk && cwdRoot.value === initCwdRoot.value
  );
}

/** Resolve a path through symlinks, or keep it as given when it can't be. */
function toRealPath(directory: string): string {
  try {
    return realpathSync(directory);
  } catch {
    return directory;
  }
}
