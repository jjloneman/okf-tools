---
type: Decision
title: How product ideas are found and decided
description: A `/product-review` skill, run only on the owner's go-ahead, opens one `💡 idea` issue of at most three ranked ideas; an ntfy push every fourth Monday says one is due, and a rejected idea gets a one-line reason, closing its issue as not planned when no idea was taken.
tags:
  - agents
  - github-actions
  - ideas
  - issues
  - ntfy
  - roadmap
  - skills
  - staleness
sources:
  - id: product-review-skill
    resource: ../../.claude/skills/product-review/SKILL.md
    title: .claude/skills/product-review/SKILL.md, the product review skill
  - id: product-review-reminder
    resource: ../../.github/workflows/product-review-reminder.yml
    title: .github/workflows/product-review-reminder.yml, the review reminder
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-26T22:59:21Z }
---

# How product ideas are found and decided

Ideas for okf-tools beyond the bugs in front of it only came up when the owner remembered to ask for them.

## Decision

As of 2026-11-25, from `.claude/skills/product-review/SKILL.md`[^product-review-skill] and `.github/workflows/product-review-reminder.yml`[^product-review-reminder]:

- **A repo-local skill, `/product-review`, holds the review prompt.**
  - It reads the README, the decision records, the changelog, this repo's issues, the spec's new issues and PRs, and the landscape record in `docs/references/`.
  - It reads the closed `💡 idea` issues first, so it doesn't offer a rejected idea again.
  - It opens one issue labeled `💡 idea`, with at most three ranked ideas and a line for each idea it dropped, and builds nothing it suggests.
- **It runs only when the owner types it.** The skill sets `disable-model-invocation`, so no agent starts it on its own judgment.
  - **Rejected:** a scheduled run, in CI or as a cloud routine; a run spends the owner's subscription, so it waits for a go-ahead.
- **A workflow says when a review is due:** `product-review-reminder.yml` runs every Monday and sends an ntfy push, to the same `NTFY_TOPIC` as the spec watch, only when the weeks since the Unix epoch are a multiple of four.
  - A manual run from the Actions tab always sends, to test it or to make up a run GitHub skipped.
- **A rejected idea gets a one-line reason.**
  - A review issue closes once each of its ideas is decided, with one comment giving each idea's outcome: the issue it became, or its reason.
  - It closes as completed when any idea was taken, and as not planned when none was.

## Why

- The issue asked for a review the owner triggers on a reminder, rather than one that runs unattended or one nobody remembers ([#61](https://github.com/jjloneman/okf-tools/issues/61)).
- Recording each rejection with a reason gives the next run something to read, so the same idea isn't offered every four weeks.
- Cron can't count weeks, and a monthly schedule would drift from four weeks, so the job counts the weeks itself.
- Reusing the spec watch's ntfy topic needs no new secret, and the topic stays out of every URL and log line.

## Consequences

- The cadence is a guess: revisit it after three reviews.
- GitHub disables the reminder after 60 days without repo activity, like the spec watch.
- The landscape record, [docs/references/landscape.md](../references/landscape.md) ([#62](https://github.com/jjloneman/okf-tools/issues/62)), carries a `stale_after`; a review that finds it missing or past that date says so rather than researching other tools itself.

## Links

- [#61](https://github.com/jjloneman/okf-tools/issues/61) — the issue that asked for the review.
- [#64](https://github.com/jjloneman/okf-tools/issues/64) — the roadmap it was planned in.

[^product-review-skill]: `.claude/skills/product-review/SKILL.md`, the product review skill.

[^product-review-reminder]: `.github/workflows/product-review-reminder.yml`, the review reminder.
