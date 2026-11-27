---
type: Decision
title: How okf-check.yml posts drafts as review comments
description: "With `review-comments: true`, the reusable workflow posts each draft record's `T001` on a same-repo pull request as a file-level review comment, found again by a hidden marker naming the record, the code and its blob, which the owner resolves to acknowledge that the record merges as a draft; the comments job takes the calling job's permissions, and a fork, another event or a refused comment falls back to annotations."
tags:
  - ci
  - okf-check
  - pull-requests
  - verification
sources:
  - id: okf-check-yml
    resource: ../../.github/workflows/okf-check.yml
    title: .github/workflows/okf-check.yml, the reusable workflow
  - id: ci-yml
    resource: ../../.github/workflows/ci.yml
    title: .github/workflows/ci.yml, which calls it on this repo's records
  - id: ruleset
    resource: ../../.github/rulesets/main.json
    title: .github/rulesets/main.json, which protects main
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T01:48:07Z }
---

# How okf-check.yml posts drafts as review comments

A notice on a pull request can't be replied to, resolved or deferred, so the owner had no way to say that a draft would merge unverified, or why. #146 asked for a draft's finding to be a review comment instead, which the owner resolves to acknowledge it.

## Decision

As of 2026-11-27, from `.github/workflows/okf-check.yml`[^okf-check-yml]:

- **An opt-in input, `review-comments`, off by default**, so a caller that doesn't set it sees no change.
- **Only on a `pull_request` from the same repo:** a fork's token can't write, so there, on any other event, and for a comment GitHub refuses, each draft stays an annotation.
  - So does a draft the pull request doesn't change, such as a record in scope under `--changed` for citing a changed file, since GitHub takes a comment only on a file in the diff.
  - When the threads can't be read, such as when the calling job grants no `pull-requests` access, every draft is an annotation.
- **Only `T001` becomes a comment**, the one finding that's about whether a record may merge as it is.
  - Every other finding stays an annotation, and an error such as `T006` or `T008` still fails the check job, so resolving a thread can't wave it through.
  - With `review-comments` on, the check job runs `okf check --format json`, then annotates each other finding and prints each as a line, as `okf check` would, and fails as `okf check` exited.
- **A file-level comment, not a line comment**, so it never needs a line inside the diff, and never moves with one.
- **A hidden marker, `<!-- okf-check: <path> <code> <blob> -->`, finds a comment again**, with the record's git blob at the pull request's head, so a run tells a changed record from an acknowledged one by its text, not its line, and a change to the record on the base branch, which the merge checkout holds, asks for no new acknowledgment:
  - a thread for the same blob is kept as it is, resolved or not, its text edited only when the wording changed;
  - an open thread for an older blob is edited to the new one;
  - when every thread for the record is resolved, a changed record gets a new comment, so a resolved thread stays resolved until the record changes again;
  - every other open thread, as when the record was signed off, is resolved, with its marker's blob set to `0`, so if the record comes back as it was, a resolution the owner never made can't stand for theirs;
  - only a marker on a comment by `github-actions` counts, so no one else's comment can stand in for one.
- **The message's own text can't mention anyone or open an HTML comment**, so a record's `verified.by` can't ping someone or forge a marker; a section such as §5.3 links to the pinned spec.
- **The comments job declares no `permissions`, so it takes the calling job's**, which must grant `pull-requests: write`, and the workflow drops its workflow-wide `permissions: {}`.
  - **Rejected:** asking for `pull-requests: write` in the workflow. A called job that asks for more than its caller grants fails the whole run before it starts, even when its `if` is false, so every caller that doesn't grant it would break.
  - The check job still declares `contents: read` alone.
  - **Rejected:** a second reusable workflow. The issue asked for an input, and a second call would run `okf check` twice.
- **One comments run at a time for each pull request**, by a `concurrency` group, so two runs never both post the same draft.
- **The check job keeps its name, `🩺 OKF check`**, so no caller's required check moves; the comments job is a new one, `💬 OKF review comments`, which falls back to annotations rather than failing, so it needn't be required.
- **Comments are posted with `actions/github-script`**, inline, since the workflow runs against the caller's checkout and can't load a script from this repo.
- **This repo opts in**[^ci-yml], with a ruleset[^ruleset] that already blocks a merge while a thread is unresolved, so a draft merges only once the owner has resolved its thread.

## Why

- Resolving a thread is GitHub's own way to say a point was seen and settled, and a ruleset can require it, so it needs no new button or app.
- Keying a comment by the record's blob ties the acknowledgment to the text that was acknowledged.

## Consequences

- The inline scripts are covered by no test; this repo's own pull requests run them first, as `ci.yml`'s `okf` job calls the workflow from the same commit.
- A spec pin moves the spec link in the comments job with every other spec link.

## Links

- [#146](https://github.com/jjloneman/okf-tools/issues/146) — review comments the owner can resolve.
- [How okf check judges whether a sign-off still holds](trust-rules.md) — what `T001` says.

[^okf-check-yml]: `.github/workflows/okf-check.yml`, the reusable workflow.

[^ci-yml]: `.github/workflows/ci.yml`, which calls it on this repo's records.

[^ruleset]: `.github/rulesets/main.json`, which protects `main`.
