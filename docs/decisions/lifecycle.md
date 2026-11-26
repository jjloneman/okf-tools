---
type: Decision
title: How okf deprecate and --stale-in write a record's lifecycle
description: "`okf deprecate` sets `status: deprecated` and a bundle-rooted `superseded_by`, re-stamping `generated`, and `okf verify --stale-in` writes `stale_after` as an ISO 8601 duration past the sign-off, in UTC."
tags:
  - deprecation
  - frontmatter
  - okf-deprecate
  - okf-verify
  - paths
  - refusals
  - staleness
  - status
  - timestamps
  - validation
sources:
  - id: deprecate
    resource: ../../src/deprecate.ts
    title: src/deprecate.ts, the okf deprecate command
  - id: frontmatter-deprecate
    resource: ../../src/frontmatter/deprecate.ts
    title: src/frontmatter/deprecate.ts, the deprecation edit
  - id: records
    resource: ../../src/records.ts
    title: src/records.ts, the record edits and stale_after from --stale-in
  - id: frontmatter-touch
    resource: ../../src/frontmatter/touch.ts
    title: src/frontmatter/touch.ts, touchRecord's re-stamp
  - id: frontmatter-fields
    resource: ../../src/frontmatter/fields.ts
    title: src/frontmatter/fields.ts, writeFields' single-value edits
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:22:42Z }
verified: { by: human:jjloneman, at: 2026-11-26T22:59:21Z }
---

# How okf deprecate and --stale-in write a record's lifecycle

OKF v0.3 has two lifecycle families: `status` with `superseded_by` (§5.4), and `stale_after` (§5.5). As of 2026-11-25 nothing in okf-tools set either, so retiring a record or giving a sign-off a review date meant a hand edit. `okf deprecate` and `okf verify --stale-in` write them with the same position-based edits and refusals as `okf verify` and `okf touch`.

## Decision

- **`okf deprecate <record>... --by <producer>`**[^deprecate] sets `status: deprecated`, whatever the status was, adding `status` at the end of the frontmatter when there's none.
- **It re-stamps `generated`**[^frontmatter-deprecate][^frontmatter-touch] as `okf touch` does, so a signed-off record shows as changed until it's signed off again.
  - **Rejected:** leaving `generated` alone, which would let a sign-off, and its human-reviewed tier, cover a deprecation no one reviewed.
  - `--by` is required and must be an actor, as for `okf touch` (see [How okf new and okf touch stamp generated](new-and-touch.md)).
  - `okf verify` promotes only a `draft` to `stable`, so signing a deprecated record off keeps it deprecated.
- **`--superseded-by <record>` sets `superseded_by`**, after `status`, to the replacement's path from the bundle root with a leading `/`, the form the spec's own example uses.
  - **Rejected:** a path relative to each record's folder, which differs for each record deprecated in one run and changes meaning if a record moves.
  - The replacement must be a record in the same bundle as every record it replaces, and not one of them.
  - **Rejected:** writing any path or URI as given, which v0.3 allows, since a typo would leave a dangling path; a URI can still be written by hand.
  - Without the flag, any `superseded_by` is left as it is. **Rejected:** clearing it, which would drop a replacement someone named on purpose.
- **`okf verify --stale-in <duration>`**[^records] writes `stale_after`, after `verified`, that long after the sign-off's `at`, in UTC to the second, replacing any it has; without the flag, `stale_after` is left as it is, as the issue asks.
  - The duration is ISO 8601, such as `P90D` or `P6M`, read and added by luxon in the calendar, so a month from January 31 is February 28. It must be longer than nothing and have no negative part.
  - **Rejected:** a shorthand such as `90d`, which would be one more grammar to define and document.
  - **Rejected:** an absolute `--stale-after <date>`, since the issue asks for a time from the sign-off.
  - It applies to the interactive mode too, and a re-run after a rejected commit still recognizes a sign-off with its `stale_after` as one, and commits it as it is.
- **Both edit through `writeFields`**[^frontmatter-fields], which overwrites a field that holds one value, keeping its quotes, or adds it on a line of its own, and refuses whatever `verifyRecord` refuses, a field that isn't a single value, and a result that means more than the fields written.
- **Neither adds or changes `verified` on its own account, and `okf deprecate` never commits**, writing nothing when any record refuses.

## Why

- v0.3 retires a record by keeping it deprecated rather than deleting it, so links keep working, and asks producers to write `stale_after` as an absolute instant rather than a relative TTL; these commands write exactly that.
- Re-stamping on deprecation follows the rule the spec gives for agent rewrites: a human review covers only the text the human read.
- Reusing the editor means a deprecated or dated record reads the same to every other command, and inherits their refusals.

## Links

- [Issue #55](https://github.com/jjloneman/okf-tools/issues/55)
- [OKF v0.3 §5.4 and §5.5](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#54-lifecycle-status-and-superseded_by)
- [How okf new and okf touch stamp generated](new-and-touch.md)
- [How okf-verify writes and commits records](writes.md)

[^deprecate]: `src/deprecate.ts`, the `okf deprecate` command.

[^frontmatter-deprecate]: `src/frontmatter/deprecate.ts`, the deprecation edit.

[^records]: `src/records.ts`, the record edits and `stale_after` from `--stale-in`.

[^frontmatter-touch]: `src/frontmatter/touch.ts`, `touchRecord`'s re-stamp.

[^frontmatter-fields]: `src/frontmatter/fields.ts`, `writeFields`' single-value edits.
