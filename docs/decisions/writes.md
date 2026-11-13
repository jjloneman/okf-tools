---
type: Decision
title: How okf-verify writes and commits records
description: Edits only an allowlist of layouts; all or nothing; each record is re-read just before writing and the time re-stamped at confirmation, a failed write rolls back the others, the commit names only the verified files and is unstaged if rejected, and it never pushes or skips hooks.
tags: [git, safety]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-13T02:28:00Z }
verified: { by: human:jjloneman, at: 2026-11-13T02:54:56Z }
---

# How okf-verify writes and commits records

Between listing records and committing them, the interactive mode waits on a person, and either mode can hit a hook or a disk error. Each step guards against leaving a record half-verified or sweeping other work into the commit.

## Decision

As of 2026-11-11, from `src/apply.ts`, `src/frontmatter/`, `src/git.ts`, and `src/repo.ts`:

- **Targeted edits, never a YAML round-trip:** `status: draft` becomes `stable` (any other status is left alone), and the signer's `verified` entry is added or renewed. Nothing else in the record is reformatted.
  - As of 2026-11-12, fields are read with the `yaml` package's failsafe schema, and an edit replaces only the characters it changes, at the positions the parser reports.
  - Frontmatter that isn't valid YAML is refused, since where its fields end can't be known.
  - As of 2026-11-12, an edit is also refused when its result doesn't parse to the original plus the intended changes (`draft` made `stable`, the signer's entry added or renewed), so a layout the edits get wrong is refused rather than written with a different meaning.
  - As of 2026-11-12, only an allowlist of `status` and `verified` layouts is edited, listed in the README; any other is refused with a reason naming the field, for a hand edit. Refused: an anchor, alias, or tag on a `draft` status, `verified`, an entry, any entry's `by`, or the signer's `at`; a value or flow collection spread over several lines; a quoted or `?` `status` or `verified` key; a `verified` holding a single value; someone else's entry written as a block mapping when it's the whole `verified` value; and a signer's name holding a line break.
  - Also refused, anywhere in the frontmatter, before any edit is planned: a carriage return that doesn't end a line (YAML 1.2 reads it as a line break, the parser as text); an alias whose anchor isn't set before it; and two keys that mean the same, such as an alias key repeating another, `~` beside `null`, or equal collection keys.
  - A null `by` names nobody, so it never counts as the signer's entry.
  - The meaning check tells a null from an empty string, though the failsafe schema reads both as `""`.
  - A status other than `draft`, and other people's `at`, are never edited, so they may take any form.
  - The frontmatter is sliced out of the record by position, after any byte order mark, so no line ending outside an edit is rewritten, and a line an edit adds takes the line break of the line it follows.
  - Only an unquoted `~`, `null`, `Null`, `NULL`, or empty value is null, for the reads and the edits alike; a quoted `"null"` is text.
- **All or nothing before writing:** if any chosen record refuses the edit, nothing is written.
  - As of 2026-11-12, a record the edits would refuse is reported when the records are listed and left out of the selection, so it can't hold the others back; the write-time refusal still guards a record changed on disk since.
- **Re-read before writing:** each record is read again just before the write; if one changed on disk since it was listed, such as an edit saved while the prompt was open, nothing is written.
- **Re-stamped at confirmation:** the edits are rebuilt with the current UTC time at write time, so `verified.at` is when the person confirmed, not when the checklist opened.
- **A failed write rolls back:** if a write fails partway, the records already written get their original text back.
- **The commit names only the verified files:** `git add -- <files>`, then `git commit -m <message> -- <files>`, so anything else staged stays out of it.
  - A chosen record with other uncommitted changes is committed whole, with a warning listing it first.
- **A rejected commit is unstaged:** if a hook rejects it, the files are unstaged again so the next unrelated commit doesn't pick them up; the edits stay on disk, and the hook's output is printed.
  - Staging done before the run for those same files is lost; their content isn't.
- **It never pushes and never passes `--no-verify`.** `--no-commit` stops after the write.

## Why

- A record that's half-verified, or verified with text the person never saw, is worse than one left as a draft; each guard keeps the result to "all verified as reviewed" or "nothing changed".
- Hooks are the repo's own checks, so a sign-off goes through them like any other commit; pushing stays the person's step.
- These guards came from two `/code-review` passes and PR review on PR #2.
- The OKF spec lets a record use any YAML, so reading must accept every layout, but a writer may refuse one. Each layout the edits accepted beyond the common ones (anchors, aliases, multi-line flow collections, `?` keys) needed its own code path and drew its own review findings; an allowlist turns the unknown layouts into refusals instead of bugs, and every `verified` field in the owner's bundles as of 2026-11-12 was already a one-line `{ by, at }`.
- The `yaml` package's CST layer (`CST.setScalarValue`) was tried for the value overwrites on 2026-11-12 and not adopted: an empty value (`at:`) has no CST token, so the range-based edit was needed anyway, and the values written (`stable`, an ISO timestamp) never need the escaping it adds. A full round-trip with `doc.toString()` was also rejected: it changed 13 of the owner's records, such as `[a, b]` to `[ a, b ]`.
- Property tests with `fast-check` generate the allowed layouts and check the edits' meaning and untouched lines on each; they found the insert point after a block whose last value is empty, and, with a wider generator, after a `? generated` key with no value.
- Reading with hand-written patterns mis-read valid YAML: reordered keys, escaped quotes, `at:` inside other values, nested lists, comments (issue #8). A parser reads every form YAML allows; it's used to find positions, not to re-serialize, so the no-reformatting rule holds.

## Consequences

- Running `okf-verify` with unrelated work staged is safe; that work stays staged and uncommitted.
- Changing the write path means keeping each guard above, or updating this record in the same PR.
