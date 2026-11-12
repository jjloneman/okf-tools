---
type: Decision
title: How okf-verify writes and commits records
description: All or nothing; each record is re-read just before writing and the time re-stamped at confirmation, a failed write rolls back the others, the commit names only the verified files and is unstaged if rejected, and it never pushes or skips hooks.
tags: [git, safety]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T23:36:00Z }
---

# How okf-verify writes and commits records

Between listing records and committing them, the interactive mode waits on a person, and either mode can hit a hook or a disk error. Each step guards against leaving a record half-verified or sweeping other work into the commit.

## Decision

As of 2026-11-11, from `src/apply.ts` and `src/repo.ts`:

- **Targeted line edits, never a YAML round-trip:** `status: draft` becomes `stable` (any other status is left alone), and the signer's `verified` entry is added or renewed. Nothing else in the record is reformatted.
- **All or nothing before writing:** if any chosen record refuses the edit, nothing is written.
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

## Consequences

- Running `okf-verify` with unrelated work staged is safe; that work stays staged and uncommitted.
- Changing the write path means keeping each guard above, or updating this record in the same PR.
