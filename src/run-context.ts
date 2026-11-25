import type { EntryStyle } from "./frontmatter/types.ts";
import type { Output } from "./output.ts";

/**
 * What a command that only reads the bundles needs, with no one's sign-off:
 * `okf index` and `okf tags`.
 */
export type BundleContext = Pick<
  RunContext,
  "bundleDirs" | "cwd" | "excludeGlobs" | "output" | "repoRoot"
>;

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
   * Globs, relative to the repo root, of files and folders in the bundles
   * that hold no records.
   *
   * @example `["docs/decisions/README.md", "docs/drafts"]`
   */
  excludeGlobs: readonly string[];

  /**
   * Where the run prints its non-prompt lines.
   *
   * @example `createOutput("okf")`
   */
  output: Output;

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
   * How long a sign-off holds, as an ISO 8601 duration, from `--stale-in`;
   * `undefined` leaves `stale_after` as it is.
   *
   * @example "P90D"
   */
  staleIn: string | undefined;

  /**
   * How a new `verified` entry is laid out.
   *
   * @example "match"
   */
  style: EntryStyle;

  /**
   * The OKF actor a `verified` entry is recorded as.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
};
