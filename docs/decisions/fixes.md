---
type: Decision
title: What okf check --fix fixes, and how it writes
description: "`okf check --fix`, also `okf format`, fixes only the house-rule findings with one obvious fix, sorted tags, a block tags list, sorted sources, key order and index lines, moving text by position under verify's guards; it never edits generated or verified, refuses what it can't move safely, and commits nothing."
tags:
  - formatting
  - frontmatter
  - index
  - okf-check
  - okf-format
  - prettier
  - refusals
  - safety
  - tags
  - yaml
sources:
  - id: check
    resource: ../../src/check.ts
    title: src/check.ts, the okf check command
  - id: fix
    resource: ../../src/fix.ts
    title: src/fix.ts, which plans and writes the --fix fixes
  - id: frontmatter-format
    resource: ../../src/frontmatter/format.ts
    title: src/frontmatter/format.ts, the --fix formatting edits
  - id: house-rules
    resource: ../../src/house-rules.ts
    title: src/house-rules.ts, the opt-in house rules
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T05:39:11Z }
verified: { by: human:jjloneman, at: 2026-11-27T06:03:41Z }
---

# What okf check --fix fixes, and how it writes

`okf check` reports house-rule findings that have one obvious fix, such as tags out of order, and a person fixed each by hand. #47 adds `okf check --fix`, also run as `okf format`, which makes those fixes. It writes records, so it carries the guards `okf verify` does, and it must never void a sign-off or fight Prettier.

## Decision

As of 2026-11-27, from `src/fix.ts`[^fix], `src/frontmatter/format.ts`[^frontmatter-format], `src/check.ts`[^check], and `src/house-rules.ts`[^house-rules]:

- **It fixes only what `okf check` reported**, so the house rules `okf.rules` turns on and `okf.exclude` decide what it touches; then it reports what's left, with the same exit code `okf check` gives, so a refused fix counts by the findings it leaves.
  - Under `--changed`, it fixes the files the branch changed, the indexes that list them, and the records reported for citing a changed file.
  - A record with a `T007` finding, a source changed since it was written, is fixed like any other, and the warning stays: since #144, `T007` counts only a commit that changes `generated` or `verified` as the record having seen its sources, and a fix changes neither (see [How okf check judges whether a sign-off still holds](trust-rules.md)).
    - Until the fix is committed, the record has uncommitted changes of its own, so `T007` judges it by `generated.at` and the latest sign-off, as for any uncommitted edit, and an uncommitted change to the source doesn't count.
  - **Rejected:** leaving such a record unfixed, in any mode, as #130 did, which #149 reversed. Before #144, any commit to a record counted as it having caught up with its source, so a fix's commit could hide a source change; since then the guard only kept house-rule findings unfixed.
  - **Rejected:** fixing every record whatever the rules say. A repo that didn't turn `tags-sorted` on didn't choose sorted tags.
- **The fixes, as of 2026-11-27:**
  - `tags-sorted` sorts `tags` in place, flow or block, keeping each tag's quotes;
  - `tags-layout` with `block` rewrites a flow `tags` list as a block list, two spaces in, one `- tag` per line, moving a comment after the list to the `tags:` line; `flow` has no fix, and stays a finding;
  - `sources-sorted`, `H013`, sorts `sources` by `id`, by code unit as `tags-sorted` compares tags, moving each entry's text as written, comments inside it included, and keeping two entries with the same `id` in their order (#150);
  - `key-order`, a new house rule, `H012`, puts the top-level keys its `order` lists first, in that order, and the rest after them in their own order;
  - `index-entry-missing`, `index-entry-stale` and `index-entry-order` write the index the rule judged, whole, as `okf index` would, its other stale lines and its tag index included.
- **`key-order` is a house rule with an `order` option**, since a fix answers a finding, and a key order is a convention the spec leaves open.
  - Keys it doesn't list, unknown and `x-` keys included, are kept, after the listed ones, never dropped.
  - **Rejected:** keeping unlisted keys where they are and ordering only the listed ones around them. It leaves no single order to check against, and a key added later lands anywhere.
- **No UTC fix.** #47's plan listed UTC timestamps, but OKF v0.3 defines timestamps only in `generated.at` and `verified[].at`, which a fix never touches, and `okf verify --stale-in` already writes `stale_after` in UTC.
- **It never edits `generated` or `verified`**, so formatting never voids a sign-off, and never re-stamps `generated`, as upstream's okf-generate keeps `generated.at` on a format-only fix (#47's comment of 2026-11-25).
  - The trust rule on a changed body (`T006`) reads only the body, so a frontmatter fix doesn't trip it.
  - Sorting `sources` re-stamps nothing either: a footnote cites its source by `id`, so the order changes no claim, as a `tags` sort changes none. When #150 sorted every record's `sources` in this repo, each record the sort alone changed kept its `generated`, `status` and `verified`.
    - **Rejected:** re-stamping each record the sort moved, which would have sent 27 records back for sign-off over an order that means nothing.
- **A fix moves text by the positions the parser reports**, as `okf verify`'s edits do, and the result must parse to the original's meaning, its tags and its sources sorted and its keys in order when asked.
  - **Rejected:** a YAML round-trip. It rewrote 13 of the owner's records when tried for `okf verify` (see [How okf-verify writes and commits records](writes.md)).
  - Converting between flow and block is out of scope but for `tags`, as [How a record's tags are laid out](tags-layout.md) settled.
- **It refuses what it can't move safely**, naming the file and why, and leaves its findings in the report:
  - frontmatter `okf verify` would refuse: no frontmatter, YAML that isn't valid or whose meaning is ambiguous, a lone carriage return, or frontmatter that isn't a block mapping;
  - a `tags` list that's an alias, carries an anchor or a tag, holds anything but single values on one line each, or has a comment between its tags; to write it as a block, a quoted `tags` key, or anything but `:` between `tags` and the list, such as a comment;
  - a `sources` list that's an alias or a flow list, carries an anchor or a tag, has a comment before or between its entries, or after its last entry on the same line or on an indented line below it (a comment on the `sources:` line, or at the left edge after the list, stays where it is), or has entries that don't all start at the same column; or an entry that isn't a mapping or has no `id`, carries a tag, holds an anchor or an alias anywhere inside it, or ends in a block scalar, whose line break the entry moved after it would lose;
  - to order the keys, a comment line between two top-level keys, which could head either, or a key that's indented or isn't plain at the start of its line.
- **The writes keep `okf verify`'s guards:** strict UTF-8 reads, no write through a symlink, and only over a file still holding the text the check read; all or nothing, restoring the files already written when one fails; and it commits nothing.
- **The fixer and Prettier don't fight:** a test runs Prettier at its defaults over the fixer's output, with a 9-tag list in flow and block style, and expects no change, and the fixer leaves Prettier's own output alone.

## Why

- Every fix is mechanical, so a person fixing each by hand is time spent on nothing a reviewer needs to judge.
- Moving text by position keeps every byte outside a fix, so a fixed record's diff shows only the fix.
- A fix that re-stamped `generated` would void every sign-off it touched, and turn formatting into a reason to sign records off again.

## Links

- [#47](https://github.com/jjloneman/okf-tools/issues/47) — `okf check --fix` and `okf format`, with the comment that aligned it with v0.3.
- [#65](https://github.com/jjloneman/okf-tools/issues/65) — the block `tags` fix.
- [#149](https://github.com/jjloneman/okf-tools/issues/149) — fixing records with a `T007` finding, once #144 made a fix unable to hide a source change.
- [#150](https://github.com/jjloneman/okf-tools/issues/150) — the `sources` sort.
- [Which house rules okf check runs, and how a repo turns them on](house-rules.md) — the rules these fix.

[^fix]: `src/fix.ts`, which plans and writes the `--fix` fixes.

[^frontmatter-format]: `src/frontmatter/format.ts`, the `--fix` formatting edits.

[^check]: `src/check.ts`, the `okf check` command.

[^house-rules]: `src/house-rules.ts`, the opt-in house rules.
