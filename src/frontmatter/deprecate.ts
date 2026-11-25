/*
 * Deprecates a record in place: `status: deprecated`, with `superseded_by`
 * when a replacement is named, as OKF v0.3's §5.4 describes, and `generated`
 * re-stamped, since a deprecation changes what the record means to anyone
 * reading it.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import type { RecordVerification } from "./edit.ts";
import type { FieldWrite } from "./fields.ts";
import type { Timestamp } from "./types.ts";

import { writeFields } from "./fields.ts";
import { FRONTMATTER_KEYS } from "./shared.ts";
import { touchRecord } from "./touch.ts";
import { RECORD_STATUSES } from "./types.ts";

/** What `deprecateRecord` needs: the record, who deprecated it, and when. */
export type DeprecateRecordParams = {
  /**
   * The time to write as `generated.at`, as RFC 3339 profiles ISO 8601.
   *
   * @example "2026-11-25T21:24:51Z"
   */
  at: Timestamp;

  /**
   * Who deprecated the record, written as `generated.by`.
   *
   * @example "claude-code/claude-opus-5-5"
   */
  by: string;

  /**
   * The path to the record that replaces it, written as `superseded_by`;
   * `undefined` leaves any `superseded_by` as it is.
   *
   * @example "/metrics/gross-margin.md"
   */
  supersededBy: string | undefined;

  /**
   * The record's text, frontmatter included.
   *
   * @example `"---\ntype: Metric\nstatus: stable\n---\n"`
   */
  text: string;
};

/**
 * Deprecate a record: set `status: deprecated`, and `superseded_by` when
 * given, after re-stamping `generated` as `touchRecord` does.
 *
 * - A missing `status` is added at the end of the frontmatter, and a missing
 *   `superseded_by` after `status`.
 *
 * - It never adds or changes `verified`, so a signed-off record reads as
 *   changed until it's signed off again, and a sign-off keeps it deprecated.
 *
 * - It refuses whatever `touchRecord` or `writeFields` refuses.
 */
export function deprecateRecord(
  params: DeprecateRecordParams
): RecordVerification {
  const { at, by, supersededBy, text } = params;
  const touched = touchRecord({ at, by, shouldDraft: false, text });

  if (!touched.isOk) {
    return touched;
  }

  const fields: FieldWrite[] = [
    { key: FRONTMATTER_KEYS.status, value: RECORD_STATUSES.deprecated },
  ];

  if (supersededBy !== undefined) {
    fields.push({
      after: FRONTMATTER_KEYS.status,
      key: FRONTMATTER_KEYS.supersededBy,
      value: supersededBy,
    });
  }

  return writeFields({ fields, text: touched.text });
}
