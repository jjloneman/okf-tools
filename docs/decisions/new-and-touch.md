---
type: Decision
title: How okf new and okf touch stamp generated
description: "`okf new` writes a draft record's frontmatter and syncs its index, and `okf touch` re-stamps `generated` in place, both from the clock with no flag for the time; neither adds `verified` or commits, and each writes nothing when any part refuses; a change to `tags` alone, or to the order of `sources` or of the top-level keys alone, isn't re-stamped."
tags:
  - agents
  - frontmatter
  - generated
  - index
  - okf-new
  - okf-touch
  - refusals
  - tags
  - timestamps
  - verification
sources:
  - id: frontmatter-scaffold
    resource: ../../src/frontmatter/scaffold.ts
    title: src/frontmatter/scaffold.ts, a new draft record's frontmatter
  - id: frontmatter-touch
    resource: ../../src/frontmatter/touch.ts
    title: src/frontmatter/touch.ts, the re-stamp edit
  - id: new-record
    resource: ../../src/new-record.ts
    title: src/new-record.ts, the okf new command
  - id: touch
    resource: ../../src/touch.ts
    title: src/touch.ts, the okf touch command
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T07:00:17Z }
verified: { by: human:jjloneman, at: 2026-11-27T07:03:48Z }
---

# How okf new and okf touch stamp generated

Agents typed `generated.at` by hand and got it wrong, and a time later than a sign-off makes a signed-off record look changed. As of 2026-11-25, OKF v0.3 reads `generated.at` as a record's last meaningful change, so it has to be right. `okf new` and `okf touch` take it from the clock instead.

## Decision

- **`okf new <record> --type <type> --by <producer>`**[^frontmatter-scaffold] writes a record holding only frontmatter: `type`, then `title`, `description`, and `tags` when given, `status: draft`, and an inline `generated: { by, at }`.
  - Tags are a block list, sorted, each once, as [How a record's tags are laid out](tags-layout.md) recommends.
  - The body is left to the writer, out of scope by the issue.
  - It never overwrites anything at the path, a broken symlink included, and never makes folders.
- **`okf new` then syncs the `index.md` that lists the record**[^new-record], as `okf index` syncs it, so the record's line is written the way every other line is.
  - It plans both files before writing either, so an index it can't sync writes nothing, and a failed index write removes the record again.
  - **Rejected:** writing the record and leaving a failed index for `okf index`, which would leave a half-done change for a broken record elsewhere in the bundle.
  - **Rejected:** adding only the new line, which would need a second way of placing a line beside `okf index`'s.
- **`okf touch <record>... --by <producer>`**[^frontmatter-touch] re-stamps `generated.by` and `generated.at` in place, with the same position-based edits and refusals as `okf verify`, adding either key, or `generated` after `status`, when missing.
  - `--draft` sets a `stable` record back to `status: draft`, only when asked, as the issue says; any other status is kept.
  - It writes nothing when any named record refuses.[^touch]
- **Neither takes a time**: there is no `--at`, since a typed time is the mistake they exist to stop.
- **Neither adds or changes `verified`, and neither commits**, since signing off stays the person's call (see [Who verifies a record](who-verifies.md)).
- **`--by` is required and must be an actor**, as `okf.verifiedBy` must; it names the producer, so it never falls back to `okf.verifiedBy`.
- **The agent rules point at both commands** in place of telling an agent to stamp `generated` itself.
- **A change to `tags` alone isn't re-stamped:** the agent rules and the `okf-record` skill say to skip `okf touch` for it, keeping `generated` and `status`, so a signed-off record stays signed off.
  - Any other change in the same edit, to the body or another field, is re-stamped as before, apart from a reorder of `sources` or of the top-level keys.
  - `title` and `description` aren't exempt, since they summarize what the record says.
  - In a tag audit, the record skill proposes every retag in one table first, so the person sees each change before it's written; a retag made in other work is shown only in its diff.
  - **Rejected:** re-stamping every edit, tags included, which sent each retagged record back for sign-off, so a bundle-wide tag audit queued every record it touched.
- **A change to the order of `sources` alone isn't re-stamped either** (#150, #155): the agent rules and the `okf-record` skill name it beside `tags`, alone or with a `tags` change in the same edit, since a footnote cites its source by `id`, so the order changes no claim. `okf format` sorts `sources` under the `sources-sorted` house rule without re-stamping, per [What okf check --fix fixes, and how it writes](fixes.md).
  - Adding, removing, or editing an entry is re-stamped as before, since it changes what the record rests on.
- **A change to the order of the top-level keys alone isn't re-stamped either** (#157): the agent rules and the `okf-record` skill name it beside `tags` and the order of `sources`, since a key means the same wherever it sits. `okf format` orders the keys under the `key-order` house rule without re-stamping, per [What okf check --fix fixes, and how it writes](fixes.md).
  - As of 2026-11-28, `okf check` and `okf status` already kept a signed-off record signed off after a key reorder alone; only the rules were silent on it.
  - **Rejected:** saying that any change `okf format` alone makes keeps `generated`. It would cover a later fix too, but an agent can't tell a format-only change from a hand edit in a diff, while each exception named here can be checked from it.

## Why

- A stamp from the clock is right every time, which a typed one isn't, and it matches what v0.3 means by `generated.at`.
- Reusing the editor and the index sync means a scaffolded or re-stamped record reads the same to every other command, and inherits their refusals.
- Tags help a reader find a record, while a sign-off confirms what the record says against its sources, which a tag can't change.
  - As of 2026-11-25, upstream's okf-generate skill re-stamps `generated.at` only for a change in meaning, and keeps it for a move, which changes how a record is found but not what it says; a retag is the same kind of change.
  - The CLI needed no change for it: a sign-off is judged by `generated.at`, and `okf check`'s `T006` gate compares only the body.
- All-or-nothing writes match `okf verify`'s (see [How okf-verify writes and commits records](writes.md)).

## Links

- [Issue #54](https://github.com/jjloneman/okf-tools/issues/54)
- [Issue #66](https://github.com/jjloneman/okf-tools/issues/66), where the tags exception was decided
- [Issue #150](https://github.com/jjloneman/okf-tools/issues/150), where the `sources` sort was decided, and [issue #155](https://github.com/jjloneman/okf-tools/issues/155), which named its exception in the guidance
- [Issue #157](https://github.com/jjloneman/okf-tools/issues/157), which named the key-order exception
- [What okf check --fix fixes, and how it writes](fixes.md)
- [How a record's tags are laid out](tags-layout.md)
- [How okf index keeps an index.md in step with its records](index-sync.md)
- [How okf-verify writes and commits records](writes.md)
- [Who verifies a record](who-verifies.md)

[^frontmatter-scaffold]: `src/frontmatter/scaffold.ts`, a new draft record's frontmatter.

[^new-record]: `src/new-record.ts`, the `okf new` command.

[^frontmatter-touch]: `src/frontmatter/touch.ts`, the re-stamp edit.

[^touch]: `src/touch.ts`, the `okf touch` command.
