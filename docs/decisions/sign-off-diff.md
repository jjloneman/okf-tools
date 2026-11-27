---
type: Decision
title: What a re-verification shows as changed
description: The diff from the newest commit that set the signer's current `verified.at` in a record not generated again after it, to the record on disk; with no such commit, or no sign-off, the whole record; shown before the interactive confirm and by `okf diff`.
tags:
  - change-detection
  - git
  - history
  - interactive
  - okf-diff
  - okf-verify
  - timestamps
  - verification
sources:
  - id: sign-off-diff
    resource: ../../src/sign-off-diff.ts
    title: src/sign-off-diff.ts, what changed since a sign-off
  - id: git
    resource: ../../src/git.ts
    title: src/git.ts, every git call
  - id: interactive
    resource: ../../src/interactive.ts
    title: src/interactive.ts, the interactive verify mode
  - id: diff
    resource: ../../src/diff.ts
    title: src/diff.ts, the okf diff command
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T01:36:56Z }
verified: { by: human:jjloneman, at: 2026-11-27T01:13:56Z }
---

# What a re-verification shows as changed

A record that was signed off and then regenerated needs a fresh sign-off, but the checklist only said it had changed, so the signer had to find what changed by hand before confirming.

## Decision

As of 2026-11-25, from `readSignOffDiff` in `src/sign-off-diff.ts`[^sign-off-diff], `listFileCommits`, `readTextAt` and `diffSince` in `src/git.ts`[^git], `src/interactive.ts`[^interactive], and `src/diff.ts`[^diff]:

- **The diff starts at the commit that set the signer's current sign-off.** Of the record's commits under its current name, it is the newest that:
  - holds the same `verified.at` for the signer as the disk, compared to the second;
  - has no parent that holds it, so the commit set it rather than inherited it; a commit that adds the record counts, as `okf verify` on a new record or a squash merge does;
  - holds the record verified, not generated again after the sign-off, so what it holds is what was signed.
  - The parents are read as committed, so a merge, or a branch whose commits interleave with it by date, never hides it; `--no-follow` and `--no-show-signature` keep `log.follow` and `log.showSignature` from changing what git lists.
  - The diff runs from that commit to the file on disk, so committed and uncommitted changes since both show.
  - **Rejected:** the oldest of the newest commits holding the sign-off in a row, which a merged branch's later commit cuts short.
  - **Rejected:** the last commit made by okf-tools' own commit message, which misses a sign-off made by hand and committed, and one squashed into another commit.
  - **Rejected:** the diff against the base branch, which shows the branch's changes, not the ones since the signer last read the record.
- **With no such commit, the whole record is shown, and the heading says why.** That covers a sign-off on disk that no commit holds, as one made by hand and not committed, and one committed only in a record generated again after it, as a sign-off restored by hand after a regeneration, and a shallow clone whose oldest commit holds it, since no commit there shows what the signer read.
  - **Rejected:** following renames with `git log --follow`, which guesses at renames.
- **A record the signer never signed off is shown whole**, under a heading that says so.
- **What is shown is plain text:** the diff ignores color, external drivers, text conversion and `-diff` attributes, and control characters print as `\x..` escapes, so a record can't redraw the lines under review.
- **The interactive mode shows it for each chosen record**, after the checklist and before the files and the confirm, colored by line in a terminal; a diff git can't produce is a warning, and the confirm is still asked.
- **`okf diff <record>...` prints the same,** for records named as `okf verify --yes` names them, with `--bundle` and `--by`, and changes nothing. Every line carries the `[okf]` prefix, as all its output does, and it exits `0` worked, `1` failed.
  - The non-interactive verify shows no diff.

## Why

- The commit that set the sign-off is the last state the signer read, so a diff from it is exactly what a re-verification needs to review.
- Walking the history by the value of `verified.at`, not by commit message, finds a sign-off however it was made and committed.
- Showing the whole record when history can't say what was signed keeps the review complete rather than silently short.

## Links

- [Issue #56](https://github.com/jjloneman/okf-tools/issues/56)
- [How okf-tools lays out its commands](command-layout.md)
- [What a record counts as changed against](base-ref.md)

[^sign-off-diff]: `src/sign-off-diff.ts`, what changed since a sign-off.

[^git]: `src/git.ts`, every git call.

[^interactive]: `src/interactive.ts`, the interactive verify mode.

[^diff]: `src/diff.ts`, the `okf diff` command.
