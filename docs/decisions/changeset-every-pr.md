---
type: Decision
title: Why every PR adds a changeset
description: CI's required `🦋 Changeset` check fails a PR without one; a PR that ships nothing adds `pnpm changeset --empty`, and the version PR, which is exempt, has its CI run approved by hand before it merges.
tags: [ci, releases]
sources:
  - id: changesets-empty
    resource: https://github.com/changesets/changesets/blob/main/docs/command-line-options.md
    title: Changesets, command line options
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T23:36:00Z }
verified: { by: human:jjloneman, at: 2026-11-12T00:34:41Z }
---

# Why every PR adds a changeset

Releases come from changeset files, not commit messages, so a PR that forgets one changes the package without ever releasing the change.

## Decision

As of 2026-11-11, from `.github/workflows/ci.yml` and `.github/rulesets/main.json`:

- **Every PR adds a changeset:**
  - `pnpm changeset` when it changes what ships, a `minor` for a breaking change in 0.x and a `patch` otherwise;
  - `pnpm changeset --empty` when it only touches tooling, tests, or docs, which records no release[^changesets-empty].
- **CI's `🦋 Changeset` job enforces it** with `pnpm changeset status --since=origin/main`, which fails when the PR adds none.
  - It skips the version PR (`changeset-release/main` from this repo), which only consumes changesets; a fork's branch of that name is still checked.
- **Every CI job is a required check on `main`,** so the changeset job blocks a merge rather than just showing red.
- **The version PR's CI run waits for approval:** `github-actions[bot]` starts it, so it sits as `action_required`, and has to be approved on the PR before the PR can merge.

## Why

- The owner wanted every PR to carry one (review thread on PR #2, filed as issue #3): the question "does this release?" gets answered on every PR, rather than by remembering to.
- An empty changeset makes "nothing ships" an explicit answer, which the check can tell from a forgotten one.
- Making every job required closes the gap where the changeset job could fail without blocking (raised in review on PR #9).

## Consequences

- Docs-only PRs, like the one that added this bundle, still add a changeset.
- Renaming a CI job or changing the test matrix means updating `required_status_checks` in the ruleset and reapplying it, or every PR waits on a check that never reports.
- Merging a version PR has one manual step: approving its CI run.

[^changesets-empty]: `changeset --empty` adds a changeset that bumps no package.
