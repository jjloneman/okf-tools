/** What both run modes need once the arguments and config are resolved. */
export type RunContext = {
  /**
   * Bundle directories from the repo root, with `/` separators.
   *
   * @example `["docs/decisions", "docs/references"]`
   */
  bundleDirs: readonly string[];

  /**
   * The directory the command was run from, which record paths are relative
   * to.
   *
   * @example "/repo/docs"
   */
  cwd: string;

  /**
   * The repo's root directory.
   *
   * @example "/repo"
   */
  repoRoot: string;

  /**
   * Whether to commit the verified files.
   *
   * @example true
   */
  shouldCommit: boolean;

  /**
   * The OKF actor a `verified` entry is recorded as.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
};
