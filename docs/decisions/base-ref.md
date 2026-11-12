---
type: Decision
title: What a record counts as changed against
description: The branch diff against `origin/HEAD`, else `origin/main`, else the local `main`, plus whatever `git status` reports, untracked files included; if the diff can't be read, uncommitted changes alone.
tags: [git]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T23:36:00Z }
---

# What a record counts as changed against

The interactive checklist opens on the records changed on the branch, and `--yes --changed` verifies them. Both need a base to diff against, and safe-fns' original script hard-coded `main`.

## Decision

As of 2026-11-11, from `readBaseRef` and `listChangedPaths` in `src/repo.ts`:

- **The base ref, first match wins:**
  1. `origin/HEAD`, the remote's default branch;
  2. `origin/main`;
  3. the local `main`.
- **A changed record** is one under a bundle that is either:
  - in `git diff <base>...HEAD`, the changes since the branch left the base;
  - or reported by `git status`, staged, unstaged, or untracked.
- **When the diff can't be read**, such as a base that doesn't exist, the run says so and uses uncommitted changes only, rather than failing.
- **Every git path is literal** (`--literal-pathspecs`), so a record named `[ab].md` matches only itself.

## Why

- **A remote-tracking ref before a local branch:** a fresh clone may not have a local `main`, and an existing one may be behind, which would list records already merged.
- **`origin/main` as the second choice:** `git clone` sets `origin/HEAD`, but `git remote add` doesn't, so a repo that gained its remote later still diffs against the remote.
- **The three-dot diff** compares against the merge base, so commits that landed on the base after the branch started don't show up as this branch's changes.
- **`git status` too,** since a record drafted but not yet committed is the most common one to verify.

## Consequences

- A repo whose default branch isn't `main` works once `origin/HEAD` is set (`git remote set-head origin --auto`).
