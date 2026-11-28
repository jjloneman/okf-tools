/*
 * The sign-off `okf verify` makes, for the CLI and the library alike:
 * `verifyRecord`'s edits, then the reason the record's last re-stamp gave
 * taken out, so an old reason never outlives the review it was written for.
 *
 * - `verifyRecord` stays the bare edit of `status` and `verified`, so a
 *   caller that already uses it gets the same text it always did.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import type { FindEditProblemParams, RecordVerification } from "./edit.ts";
import type { VerifyRecordParams } from "./types.ts";

import { LISTING_AT, verifyRecord } from "./edit.ts";
import { removeField } from "./fields.ts";
import { FRONTMATTER_KEYS } from "./shared.ts";

/**
 * Say why a record can't be signed off by `verifiedBy` as `signOffRecord`
 * signs it off, so a listing can report it before anyone chooses it.
 *
 * - It plans with the same fixed, valid timestamp as `findEditProblem`, so it
 *   never reports the refusal `verifyRecord` gives for a caller's own `at`.
 *
 * - Beyond `findEditProblem`'s refusals, it reports an
 *   `x-okf-restamp-reason` whose layout `removeField` refuses.
 *
 * @returns the refusal `signOffRecord` would give, or `undefined` when none.
 */
export function findSignOffProblem(
  params: FindEditProblemParams
): string | undefined {
  const result = signOffRecord({ ...params, at: LISTING_AT });

  return result.isOk ? undefined : result.reason;
}

/**
 * Sign a record off as `okf verify` does: `verifyRecord`'s edits, then the
 * reason its last re-stamp gave, `x-okf-restamp-reason`, taken out.
 *
 * - A record with no reason gets the same text `verifyRecord` gives it.
 *
 * - A reason whose layout `removeField` refuses refuses the sign-off, with
 *   `unsupportedLayout`, so the old reason is never left behind.
 */
export function signOffRecord(params: VerifyRecordParams): RecordVerification {
  const verified = verifyRecord(params);

  return verified.isOk
    ? removeField({ key: FRONTMATTER_KEYS.restampReason, text: verified.text })
    : verified;
}
