---
okf_version: "0.2"
---

# Decisions

- [How changelog lines are built](changelog-formatter.md) - `scripts/changelog.ts` prefixes each changeset's summary with the gitmoji and scope of the squash commit that added it, under changesets' own bump-type headings; it's tested but never published, and runs under Node's type stripping.
- [How okf-tools is distributed](distribution.md) - A public package on the npm registry, installed as an exact-pinned dev dependency; not a private package, GitHub Packages, a git dependency, or a global CLI.
- [How okf-verify writes and commits records](writes.md) - All or nothing; each record is re-read just before writing and the time re-stamped at confirmation, a failed write rolls back the others, the commit names only the verified files and is unstaged if rejected, and it never pushes or skips hooks.
- [What `--yes` verifies, and how it exits](yes-selection.md) - `--yes` needs an explicit selection, `--changed` or record paths, never both and never neither; it skips records already verified, and exits `0` worked, `1` failed, `2` nothing to verify.
- [What a record counts as changed against](base-ref.md) - The branch diff against `origin/HEAD`, else `origin/main`, else the local `main`, plus whatever `git status` reports, untracked files included; if the diff can't be read, uncommitted changes alone.
- [Which actors can sign a record](actor.md) - `okf.verifiedBy` or `--by` must be an OKF actor YAML reads back as a plain string: it starts with a letter, has a `:` or `/` after it, and holds no whitespace, quotes, `#`, or flow indicators; there is no default.
- [Who verifies a record](who-verifies.md) - Verification is the person's call, but not only a terminal prompt may record it; an agent verifies with `--yes` when the person asks, naming the files and signing as the person.
- [Why every PR adds a changeset](changeset-every-pr.md) - CI's required `🦋 Changeset` check fails a PR without one; a PR that ships nothing adds `pnpm changeset --empty`, and the version PR, which is exempt, has its CI run approved by hand before it merges.

# About this bundle

This directory is an [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle of okf-tools' design decisions — one Markdown file per decision, listed above as `- [Title](file.md) - one-line description`, sorted by title.

Each decision opens with YAML frontmatter:

```yaml
---
type: Decision
title: Who verifies a record
description: Verification is the person's call; an agent verifies only when asked.
tags: [agents, verification]
sources:
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format specification
status: stable
generated: { by: <agent>/<model-id>, at: 2026-11-11T12:00:00Z }
verified: { by: human:jjloneman, at: 2026-11-12T09:00:00Z }
---
```

- **`type`** — always `Decision`.
- **`tags`** — one to four words from the vocabulary below, as a flow-style list right after `description`.
  - Lowercase kebab-case, sorted alphabetically.
- **`sources`** — the external material a decision rests on, such as a spec or a tool's docs, when there is any.
  - The body cites each one with a footnote keyed to its `id`.
- **`status`** — the decision's lifecycle:
  - `draft` — proposed, not yet settled.
  - `stable` — in force (the default when `status` is absent).
  - `deprecated` — superseded; kept for links and history.
- **`generated`** — who or what wrote the current text, and when.
  - `by` is an actor: `<producer>/<version>` for an agent, `human:<id>` for a person.
- **`verified`** — who has reviewed the decision, and when.
  - Absent means unreviewed.
  - `human:jjloneman` means the repo owner signed off — treat it as settled, and change it only with their agreement.
  - It's added by `pnpm okf:verify`, this repo's own `okf-verify` run from source.

## Tag vocabulary

- `agents` — How coding agents use the tool.
- `ci` — CI jobs and required checks.
- `cli` — The command line: flags, selections, exit codes, and config.
- `distribution` — How the package is published and installed.
- `frontmatter` — What the tool reads from and writes into a record's frontmatter.
- `git` — How the tool reads and changes the repo through git.
- `releases` — Changesets, the changelog, and publishing.
- `safety` — Guards against half-written records or unintended commits.
- `verification` — Who signs a record off, and what that means.
