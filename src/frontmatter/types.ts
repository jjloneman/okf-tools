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

/** Why `verifyRecord` refused a record, as a code to switch on. */
export const REFUSAL_KINDS = {
  invalidParams: "invalidParams",
  invalidYaml: "invalidYaml",
  noFrontmatter: "noFrontmatter",
  unsupportedLayout: "unsupportedLayout",
} as const;

/**
 * Why `verifyRecord` refused a record.
 *
 * - `invalidParams`: the signer's name or the timestamp can't be written.
 * - `invalidYaml`: the frontmatter isn't valid YAML.
 * - `noFrontmatter`: the text has no frontmatter block.
 * - `unsupportedLayout`: the frontmatter is valid but needs a hand edit.
 */
export type RefusalKind = (typeof REFUSAL_KINDS)[keyof typeof REFUSAL_KINDS];

/** An ISO 8601 timestamp as a record writes it: `2026-10-02T13:30:00Z`. */
export type Timestamp = string;

/** What `verifyRecord` needs: the record, who signs it, and when. */
export type VerifyRecordParams = {
  /**
   * The timestamp to record, as RFC 3339 profiles ISO 8601.
   *
   * - A date, `T`, a time to the minute or finer, and a zone, `Z` or an
   *   offset such as `+02:00`; anything else is refused.
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
