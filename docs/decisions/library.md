---
type: Decision
title: What the library accepts, and how it refuses
description: "`verifyRecord` refuses an `at` that isn't an RFC 3339 date and time with a zone; a refusal carries a `kind` to switch on; the frontmatter checks are exported; a summary's `writtenStatus` tells an absent status from one OKF doesn't define; and `signOffRecord` is the sign-off `okf verify` makes."
tags:
  - api
  - frontmatter
  - refusals
  - status
  - timestamps
  - typescript
  - validation
sources:
  - id: frontmatter-edit
    resource: ../../src/frontmatter/edit.ts
    title: src/frontmatter/edit.ts, verifyRecord and findEditProblem
  - id: frontmatter-read
    resource: ../../src/frontmatter/read.ts
    title: src/frontmatter/read.ts, the record reads and findFrontmatterProblem
  - id: frontmatter-shared
    resource: ../../src/frontmatter/shared.ts
    title: src/frontmatter/shared.ts, the timestamp checks
  - id: frontmatter-sign-off
    resource: ../../src/frontmatter/sign-off.ts
    title: src/frontmatter/sign-off.ts, signOffRecord and findSignOffProblem
  - id: frontmatter-types
    resource: ../../src/frontmatter/types.ts
    title: src/frontmatter/types.ts, the public types and constants
  - id: index
    resource: ../../src/index.ts
    title: src/index.ts, the library's exports
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-28T09:22:44Z }
verified: { by: human:jjloneman, at: 2026-11-28T06:30:15Z }
---

# What the library accepts, and how it refuses

The package exports the frontmatter functions `okf-verify` is built on. Their types took any string as a timestamp and refused only in prose, so a tool of someone else's could write a sign-off that never reads as verified, or couldn't tell why a record was refused.

## Decision

As of 2026-11-25, from `src/frontmatter/edit.ts`[^frontmatter-edit], `read.ts`[^frontmatter-read], `shared.ts`[^frontmatter-shared] and `types.ts`[^frontmatter-types], and `src/index.ts`[^index]:

- **`verifyRecord` refuses an `at` it can't write as a sign-off every reader dates alike.** It accepts RFC 3339's profile of ISO 8601: a date, `T`, a time to the minute, second, or fraction, and a zone, `Z` or `±HH:MM`. Hours, minutes, and offsets are range-checked, and luxon's `DateTime.fromISO` must read it, so a day the month lacks is refused too.
  - **Rejected:** accepting whatever luxon reads. It reads a time on its own as today's, so the sign-off would date differently every day; it reads `+99:99` and `24:00`; and a decimal comma (`13:30:00,5Z`) ends the value inside `{ by, at }`.
  - **Rejected:** a date alone, which reads as midnight, so a record generated later that day reads as changed right after its sign-off.
  - **Rejected:** a time with no zone, which okf-tools reads as UTC but ISO 8601 and JavaScript read as local time.
  - **Rejected:** basic form (`20261002T133000Z`), week dates, and ordinal dates. They're valid ISO 8601, but no record uses them and the CLI never writes them.
  - **Rejected:** a branded `Timestamp` type. It would break every caller passing a string, and still not check the value.
- **`verifyRecord` takes an optional `style`** for a new entry, from the exported `ENTRY_STYLES` (`match`, `inline`, `block`), and `match` when it's left out, so existing callers keep working; see [How okf-verify writes and commits records](writes.md) (issue #48).
- **Every refusal carries a `kind`** beside its `reason`, from the exported `REFUSAL_KINDS`: `invalidParams` (the signer or the timestamp), `noFrontmatter`, `invalidYaml`, or `unsupportedLayout` (valid, but it needs a hand edit).
- **`findFrontmatterProblem` and `findEditProblem` are exported**, so a tool can tell frontmatter that isn't valid YAML from a readable record, since `readRecordSummary` still reads what it can of either.
- **`RecordSummary.writtenStatus`** holds the `status` as written, so an absent, empty, or null status (`undefined`) differs from one OKF doesn't define, such as `wip`. `status` keeps its meaning: a status OKF defines, or `undefined`.
  - `getRecordState` takes only `generatedAt` and `verifiedAt` (`RecordTimes`), so a caller that builds a summary by hand needn't add the new field.
  - **Rejected:** reading an absent `status` as `stable`, as OKF does. It changes what existing callers see, the CLI's "no status" hint included.
- **`signOffRecord` is exported as the sign-off `okf verify` makes**, and `findSignOffProblem` as its listing check, from `src/frontmatter/sign-off.ts`[^frontmatter-sign-off], as of 2026-11-28 (issue #172). It runs `verifyRecord`, then takes out the reason the last re-stamp gave, `x-okf-restamp-reason`, which [How okf new and okf touch stamp generated](new-and-touch.md) says never outlives the review it was written for (issue #161).
  - `verifyRecord` and `findEditProblem` stay the bare edit of `status` and `verified`, and their doc comments point at `signOffRecord`, so a tool that already calls them gets the same text it always did. Adding two exports is a `patch` in 0.x.
  - **Rejected:** having `verifyRecord` take the reason out too. It would change the text an existing export returns, and add a refusal, a reason whose layout `removeField` can't edit, to a function callers already switch on: a breaking change, for a field only `okf touch --reason` writes.
- **A backdated `at` renews the signer's latest entry but may not become it.** With two entries for the signer, an `at` earlier than the other stays behind it, and the reads still judge by the later one. The CLI always stamps the current time, so it never meets this.

## Why

The types promised what the functions couldn't keep, and the fix had to be additive where it could be: refusing an unreadable `at` is the one breaking change, a `minor` in 0.x.

## Links

- [#172](https://github.com/jjloneman/okf-tools/issues/172) — export the sign-off that takes out a re-stamp's reason.
- [#161](https://github.com/jjloneman/okf-tools/issues/161) — `okf touch --reason`, and the sign-off that takes the reason out.
- [#36](https://github.com/jjloneman/okf-tools/issues/36) — validate the timestamp and export the frontmatter checks.
- [#25](https://github.com/jjloneman/okf-tools/issues/25) — the code audit that found it.

[^frontmatter-edit]: `src/frontmatter/edit.ts`, `verifyRecord` and `findEditProblem`.

[^frontmatter-read]: `src/frontmatter/read.ts`, the record reads and `findFrontmatterProblem`.

[^frontmatter-shared]: `src/frontmatter/shared.ts`, the timestamp checks.

[^frontmatter-sign-off]: `src/frontmatter/sign-off.ts`, `signOffRecord` and `findSignOffProblem`.

[^frontmatter-types]: `src/frontmatter/types.ts`, the public types and constants.

[^index]: `src/index.ts`, the library's exports.
