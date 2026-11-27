---
type: Decision
title: Which repo files a decision record cites in sources
description: Each decision record cites in sources the code and config files it was written from, relative to its folder, so okf check's T007 warns when one changes; files every release or most features touch, package.json, src/options.ts, src/cli.ts, README.md and AGENTS.md, are left out.
tags:
  - agents
  - change-detection
  - ci
  - okf-check
  - sources
  - staleness
sources:
  - id: source-rules
    resource: ../../src/source-rules.ts
    title: src/source-rules.ts, the rules on a record's sources
  - id: ci-workflow
    resource: ../../.github/workflows/ci.yml
    title: .github/workflows/ci.yml, the CI workflow
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T01:36:56Z }
verified: { by: human:jjloneman, at: 2026-11-27T02:05:49Z }
---

# Which repo files a decision record cites in sources

Each record in this bundle named the files it was written from only in prose ("As of …, from `src/init.ts`, …"), which `okf check` can't read, so a record drifted from the code unnoticed until someone re-read it. `T007 source-changed` warns when a file a record cites in `sources` changes after the record was written or signed off, and `T008 source-gone` fails when it's gone.[^source-rules]

## Decision

As of 2026-11-26:

- **Each record cites in `sources` the code and config files it was written from**, with `resource` relative to the record's folder (`../../src/git.ts`), and a footnote keyed to the source's `id` on the claim it supports.
  - A folder is cited only when the record covers all of it; `library.md` and `writes.md` cite the files in `src/frontmatter/` they rest on, since the folder's history includes its tests.
  - **Rejected:** keeping the prose "from" lines alone, which no rule reads.
- **Files that nearly every change touches are left out:**
  - `package.json`, which every version PR and dependency bump edits; CI runs `okf check --strict` on every PR, so the version PR, which touches no record, would fail.[^ci-workflow]
  - `src/options.ts` and `src/cli.ts`, which nearly every feature edits; nine and six records cited them, so most PRs would have had to re-stamp up to nine signed-off records.
  - `README.md` and `AGENTS.md`, which change in most PRs.
  - **Rejected:** citing them anyway, which would teach a reviewer to re-stamp records without re-reading them.
- **A file several records cite stays cited**, such as `src/config.ts` and `src/repo.ts` (four records each): a PR that changes one re-stamps the records citing it, and the owner signs them off again, which is the drift check doing its job.
- **The okf-record skill says to cite a record's repo files**, and this repo's AGENTS.md states the rule with the files it leaves out; `okf guide`'s rules carry it in #135.

## Why

- A warning when the code moves catches drift when it happens, in CI and the pre-commit hook, rather than at the next review: #124's review found 5 of 24 drafts had drifted within a day.
- `T007` works at file level, so a change that leaves a record true still warns; leaving out the files nearly every change touches keeps those warnings rare enough to be read.

## Links

- [Issue #133](https://github.com/jjloneman/okf-tools/issues/133)
- [How okf check judges whether a sign-off still holds](trust-rules.md)
- [Which skills okf-tools ships, and how okf init installs them](skills.md)

[^source-rules]: `src/source-rules.ts`, the rules on a record's sources.

[^ci-workflow]: `.github/workflows/ci.yml`, the CI workflow.
