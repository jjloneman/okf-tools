/*
 * The public types and constants of a record's frontmatter, exported from
 * `index.ts`.
 *
 * - They live apart from `shared.ts` and import nothing, so the published
 *   declarations never import the `yaml` package's types.
 */

/** The lifecycle statuses OKF defines for a record. */
export const RECORD_STATUSES = {
  deprecated: "deprecated",
  draft: "draft",
  stable: "stable",
} as const;

/** A lifecycle status OKF defines, such as `draft`. */
export type RecordStatus =
  (typeof RECORD_STATUSES)[keyof typeof RECORD_STATUSES];

/** An ISO 8601 timestamp as a record writes it: `2026-10-02T13:30:00Z`. */
export type Timestamp = string;

/** What `verifyRecord` needs: the record, who signs it, and when. */
export type VerifyRecordParams = {
  /**
   * The UTC timestamp to record.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  at: Timestamp;

  /**
   * The record's text, frontmatter included.
   *
   * @example `"---\nstatus: draft\n---\n"`
   */
  text: string;

  /**
   * Who is signing off.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
};
