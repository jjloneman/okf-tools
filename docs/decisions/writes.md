---
type: Decision
title: How okf-verify writes and commits records
description: Edits only an allowlist of layouts, writing a new entry in the record's own style, never through a symlink; all or nothing; each record is re-read just before writing and the time re-stamped at confirmation, a commit git would refuse writes nothing, a failed write rolls back the others, the commit names only the verified files and is unstaged if rejected, and it never pushes or skips hooks.
tags:
  - commits
  - encoding
  - frontmatter
  - git
  - okf-verify
  - refusals
  - rollback
  - safety
  - symlinks
  - yaml
sources:
  - id: apply
    resource: ../../src/apply.ts
    title: src/apply.ts, which writes and commits sign-offs
  - id: frontmatter-edit
    resource: ../../src/frontmatter/edit.ts
    title: src/frontmatter/edit.ts, verifyRecord's position-based edits
  - id: frontmatter-meaning
    resource: ../../src/frontmatter/meaning.ts
    title: src/frontmatter/meaning.ts, the checks that an edit keeps its meaning
  - id: frontmatter-layout
    resource: ../../src/frontmatter/layout.ts
    title: src/frontmatter/layout.ts, the allowlist of editable layouts
  - id: frontmatter-read
    resource: ../../src/frontmatter/read.ts
    title: src/frontmatter/read.ts, the field reads
  - id: frontmatter-shared
    resource: ../../src/frontmatter/shared.ts
    title: src/frontmatter/shared.ts, the failsafe-schema parse and the positions the edits share
  - id: git
    resource: ../../src/git.ts
    title: src/git.ts, every git call
  - id: repo
    resource: ../../src/repo.ts
    title: src/repo.ts, the file-system work on records
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T00:38:08Z }
verified: { by: human:jjloneman, at: 2026-11-27T00:08:02Z }
---

# How okf-verify writes and commits records

Between listing records and committing them, the interactive mode waits on a person, and either mode can hit a hook or a disk error. Each step guards against leaving a record half-verified or sweeping other work into the commit.

## Decision

As of 2026-11-11, from `src/apply.ts`[^apply], `src/frontmatter/edit.ts`[^frontmatter-edit], `meaning.ts`[^frontmatter-meaning], `layout.ts`[^frontmatter-layout], `read.ts`[^frontmatter-read], `shared.ts`[^frontmatter-shared], `src/git.ts`[^git], and `src/repo.ts`[^repo]:

- **Targeted edits, never a YAML round-trip:** `status: draft` becomes `stable` (any other status is left alone), and the signer's `verified` entry is added or renewed. Nothing else in the record is reformatted.
  - As of 2026-11-12, fields are read with the `yaml` package's failsafe schema, and an edit replaces only the characters it changes, at the positions the parser reports.
  - Frontmatter that isn't valid YAML is refused, since where its fields end can't be known.
  - As of 2026-11-12, an edit is also refused when its result doesn't parse to the original plus the intended changes (`draft` made `stable`, the signer's entry added or renewed), so a layout the edits get wrong is refused rather than written with a different meaning.
  - As of 2026-11-12, only an allowlist of `status` and `verified` layouts is edited, listed in the README; any other is refused with a reason naming the field, for a hand edit. Refused: an anchor, alias, or tag on a `draft` status, `verified`, an entry, any entry's `by`, or the signer's `at`; a value or flow collection spread over several lines; a quoted or `?` `status` or `verified` key; a `verified` holding a single value; someone else's entry written as a block mapping when it's the whole `verified` value; and a signer's name holding a line break.
  - Also refused, anywhere in the frontmatter, before any edit is planned: a carriage return that doesn't end a line (YAML 1.2 reads it as a line break, the parser as text); an alias whose anchor isn't set before it; and two keys that mean the same, such as an alias key repeating another, `~` beside `null`, or equal collection keys.
  - A null `by` names nobody, so it never counts as the signer's entry.
  - As of 2026-11-25, when the signer has several entries, the one with the latest readable `at` is renewed, the first of any that tie, or the first entry when none reads; the reads judge the state by the same entry, so the sign-off always clears it (issue #32).
- **A new entry in the record's own style:** as of 2026-11-25, `okf.style` in `package.json` (`style` for `verifyRecord`) lays out a new `verified` entry, and an existing entry keeps its layout, only its `at` renewed (issue #48).
  - `match`, the default, copies the form of `generated`: a block mapping when `generated` is one, else inline.
    - **Rejected:** matching the existing `verified` list's items instead; the issue settled on `generated`, which every record an agent writes has. `inline` and `block` ask for one form whatever `generated` is. There is no flag for it.
  - A block entry is written as a `-` list item, even as the only entry, with `at` aligned under `by`.
    - **Rejected:** a bare block mapping as the whole `verified` value, as the inline form is bare. The edits refuse to add a second signer to someone else's bare block mapping, since re-indenting it into a list item is a rewrite, so the first block sign-off would block every later one.
  - An inline list keeps getting inline entries, whatever the style, since a block mapping can't go inside one.
  - The new `at` is quoted as `generated.at` is, else as the first other entry's `at`, passing over an alias or a null, else plain, in every style.
  - Any other `style` passed to `verifyRecord`, such as `null` from a caller without the types, is refused as `invalidParams`, as a bad `at` is.
  - Listing records (`findEditProblem`) plans in the default style, since no refusal depends on the style.
  - A sign-off left on disk is recognized by redoing it in every style, so one written before `okf.style` changed still counts as a sign-off on the re-run. One written unquoted by an earlier okf-tools, in a record whose timestamps are quoted, doesn't, and is committed with a warning that it has other changes.
  - The meaning check tells a null from an empty string, though the failsafe schema reads both as `""`.
  - A status other than `draft`, and other people's `at`, are never edited, so they may take any form.
  - The frontmatter is sliced out of the record by position, after any byte order mark, so no line ending outside an edit is rewritten, and a line an edit adds takes the line break of the line it follows.
  - Only an unquoted `~`, `null`, `Null`, `NULL`, or empty value is null, for the reads and the edits alike; a quoted `"null"` is text.
- **Strict UTF-8 reads:** as of 2026-11-25, a record is read as bytes and decoded only when it's valid UTF-8, keeping any byte order mark, so its text re-encodes to exactly the bytes on disk (issue #27).
  - A record that isn't valid UTF-8 can't be read: it's skipped in the checklist and fails a `--yes` run, with a line naming it.
  - The rollback writes back the text the record was read as, which is its original bytes.
  - The re-read before writing compares bytes, so a record saved since in another encoding counts as changed on disk, and nothing is written.
- **Never through a symlink:** as of 2026-11-25, a record is edited only at its own path: one whose real path differs, because it or a folder above it in the repo is a symlink, is refused with a reason naming where it leads (issue #28).
  - A linked record is skipped in the checklist and fails a `--yes` run, wherever the link leads, even to another record in the same bundle.
  - A bundle directory reached through a symlink fails the run before any record is read.
  - The re-read before writing counts a record replaced by a symlink since it was listed as changed on disk, so nothing is written through it.
  - Each write opens the record with `O_NOFOLLOW`, so a symlink swapped in at the record's own name after that re-read fails the write, and the others roll back, rather than edit the file it points to. A folder above it swapped for a symlink in that window isn't caught.
- **All or nothing before writing:** if any chosen record refuses the edit, nothing is written.
  - As of 2026-11-12, a record the edits would refuse is reported when the records are listed and left out of the selection, so it can't hold the others back; the write-time refusal still guards a record changed on disk since.
- **Re-read before writing:** each record is read again just before the write; if one changed on disk since it was listed, such as an edit saved while the prompt was open, nothing is written.
  - As of 2026-11-25, a record that can't be read any more, such as one deleted while the prompt was open, also writes nothing, with a message naming it (issue #34).
- **Re-stamped at confirmation:** the edits are rebuilt with the current UTC time at write time, so `verified.at` is when the person confirmed, not when the checklist opened.
- **Checked with git before writing:** as of 2026-11-25, a committing run asks git first whether it would commit just these files, and writes nothing, naming why, when it wouldn't (issue #29):
  - a merge or cherry-pick in progress, since git refuses a commit of only some files during one;
  - a path `git add --dry-run` refuses, such as an ignored file or one beyond a symlinked folder.
- **A failed write rolls back:** if a write fails partway, the records already written get their original text back.
  - As of 2026-11-25, the rollback is best effort: it tries every record written so far and the one whose write failed, which may be left truncated, and the message names each one it couldn't restore, in place of "No files changed." (issue #34).
- **Failures are outcomes, not exceptions:** as of 2026-11-25, a file or git call that fails on the way (re-reading a record, listing a bundle, `git status`) ends the run with exit `1` and a message naming the path, and closes the interactive prompts cleanly (issue #34).
  - A commit whose hash can't be read back still counts as committed, reported as `(hash unknown)`, since git made it.
- **The commit names only the verified files:** `git add -- <files>`, then `git commit -m <message> -- <files>`, so anything else staged stays out of it.
  - A chosen record with other uncommitted changes is committed whole, with a warning listing it first.
    - As of 2026-11-25, a record new to the repo (untracked, or added to the index) isn't listed, since every line of it is new (issue #35).
- **A rejected commit is unstaged:** if a hook rejects it, the files are unstaged again so the next unrelated commit doesn't pick them up; the edits stay on disk, and the hook's output is printed.
  - As of 2026-11-25, a `--yes` run's message says to run the same command again once the commit can go through, and that re-run commits the sign-off left on disk as it is (see [What `--yes` verifies](yes-selection.md); issue #29).
  - Staging done before the run for those same files is lost; their content isn't.
- **It never pushes and never passes `--no-verify`.** `--no-commit` stops after the write.

## Why

- A record that's half-verified, or verified with text the person never saw, is worse than one left as a draft; each guard keeps the result to "all verified as reviewed" or "nothing changed".
- A lossy decode turned each byte it couldn't read into U+FFFD, so verifying a Latin-1 record rewrote bytes in its body, and a rollback wrote that damage back while saying no files changed. The OKF spec requires UTF-8, so refusing such a record costs nothing a valid one needs (issue #27).
- Writing through a symlink rewrote whatever it pointed at, a file outside the repo included, while git committed the link itself, so the sign-off was left uncommitted or the commit failed (issue #28). A repo that links records on purpose is refused with the reason, since no write through the link can be committed at the record's path.
- Hooks are the repo's own checks, so a sign-off goes through them like any other commit; pushing stays the person's step.
- These guards came from two `/code-review` passes and PR review on PR #2.
- A sign-off left on disk after a failed commit used to be stranded: a re-run skipped the record as already verified and exited `2` (issue #29). Git's known refusals are now caught before anything is written, and the re-run finishes the rest.
  - Restoring the files when the commit fails was considered and not adopted on 2026-11-25: it would undo a hook that reformats the record, and reverse "the edits stay on disk" above.
- A raw `ENOENT` from a deleted record, or a prompt frame left open, tells the person nothing about which record or what state the files are in; the code audit (issue #25) found the unguarded calls, and issue #34 made each return a reason that the run mode prints.
- The OKF spec lets a record use any YAML, so reading must accept every layout, but a writer may refuse one. Each layout the edits accepted beyond the common ones (anchors, aliases, multi-line flow collections, `?` keys) needed its own code path and drew its own review findings; an allowlist turns the unknown layouts into refusals instead of bugs, and every `verified` field in the owner's bundles as of 2026-11-12 was already a one-line `{ by, at }`.
- The `yaml` package's CST layer (`CST.setScalarValue`) was tried for the value overwrites on 2026-11-12 and not adopted: an empty value (`at:`) has no CST token, so the range-based edit was needed anyway, and the values written (`stable`, an ISO timestamp) never need the escaping it adds. A full round-trip with `doc.toString()` was also rejected: it changed 13 of the owner's records, such as `[a, b]` to `[ a, b ]`.
- A new entry was always written inline and unquoted, so a record that writes `generated` as a block, or quotes its timestamps, got a sign-off that didn't match the rest of it (issue #48). Matching the record avoids choosing a timestamp style for the owner, since some YAML parsers coerce an unquoted timestamp into a date (upstream issue 56).
- Property tests with `fast-check` generate the allowed layouts and check the edits' meaning and untouched lines on each; they found the insert point after a block whose last value is empty, and, with a wider generator, after a `? generated` key with no value.
- Reading with hand-written patterns mis-read valid YAML: reordered keys, escaped quotes, `at:` inside other values, nested lists, comments (issue #8). A parser reads every form YAML allows; it's used to find positions, not to re-serialize, so the no-reformatting rule holds.

## Consequences

- Running `okf-verify` with unrelated work staged is safe; that work stays staged and uncommitted.
- Changing the write path means keeping each guard above, or updating this record in the same PR.
- `okf check --fix` writes records under the same guards, but never edits `generated` or `verified`, and commits nothing (see [What okf check --fix fixes, and how it writes](fixes.md)).

[^apply]: `src/apply.ts`, which writes and commits sign-offs.

[^frontmatter-edit]: `src/frontmatter/edit.ts`, `verifyRecord`'s position-based edits.

[^frontmatter-meaning]: `src/frontmatter/meaning.ts`, the checks that an edit keeps its meaning.

[^frontmatter-layout]: `src/frontmatter/layout.ts`, the allowlist of editable layouts.

[^frontmatter-read]: `src/frontmatter/read.ts`, the field reads.

[^frontmatter-shared]: `src/frontmatter/shared.ts`, the failsafe-schema parse and the positions the edits share.

[^git]: `src/git.ts`, every git call.

[^repo]: `src/repo.ts`, the file-system work on records.
