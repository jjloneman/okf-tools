---
okf_version: "0.2"
---

# Decisions

- [How a record's tags are laid out](tags-layout.md) - okf-tools recommends a block list for `tags`, one `- tag` per line, since Prettier rewraps a long one-line flow list; it reads every valid layout, and recommends block only for new and fixed records.
- [How changelog lines are built](changelog-formatter.md) - `scripts/changelog.ts` prefixes each changeset's summary with the gitmoji and scope of the squash commit that added it, under changesets' own bump-type headings; it's tested but never published, and runs under Node's type stripping.
- [How okf-tools is distributed](distribution.md) - A public package on the npm registry, installed as an exact-pinned dev dependency; not a private package, GitHub Packages, a git dependency, or a global CLI.
- [How okf-tools lays out its commands](command-layout.md) - One `okf` binary takes the command as its first argument, starting with `okf verify`; `okf-verify` stays as an alias that runs `okf verify` and prints under its own name.
- [How okf-verify writes and commits records](writes.md) - Edits only an allowlist of layouts, writing a new entry in the record's own style, never through a symlink; all or nothing; each record is re-read just before writing and the time re-stamped at confirmation, a commit git would refuse writes nothing, a failed write rolls back the others, the commit names only the verified files and is unstaged if rejected, and it never pushes or skips hooks.
- [How product ideas are found and decided](product-review.md) - A `/product-review` skill, run only on the owner's go-ahead, opens one `💡 idea` issue of at most three ranked ideas; an ntfy push every fourth Monday says one is due, and a rejected idea gets a one-line reason, closing its issue as not planned when no idea was taken.
- [What a re-verification shows as changed](sign-off-diff.md) - The diff from the newest commit that set the signer's current `verified.at` in a record not generated again after it, to the record on disk; with no such commit, or no sign-off, the whole record; shown before the interactive confirm and by `okf diff`.
- [What `--yes` verifies, and how it exits](yes-selection.md) - `--yes` needs an explicit selection, `--changed` or record paths, never both and never neither; it skips records already verified and committed, and exits `0` worked, `1` failed, `2` nothing to verify.
- [What `okf init` writes, and how it keeps the agent block current](init.md) - `okf init` writes the `okf` block of `package.json` and a block of agent rules between two marker lines in `AGENTS.md`, rewriting only the text between them; malformed markers are refused, and `--check` fails when a block is missing or stale.
- [What a record counts as changed against](base-ref.md) - The branch diff against `origin/HEAD`, else `origin/main`, else the local `main`, plus whatever `git status` reports, untracked files included; if the diff can't be read, uncommitted changes alone.
- [What the library accepts, and how it refuses](library.md) - `verifyRecord` refuses an `at` that isn't an RFC 3339 date and time with a zone; a refusal carries a `kind` to switch on; the frontmatter checks are exported; and a summary's `writtenStatus` tells an absent status from one OKF doesn't define.
- [Which actors can sign a record](actor.md) - `okf.verifiedBy` or `--by` must be an OKF actor YAML reads back as a plain string: it starts with a letter, has a `:` or `/` after it, and holds no whitespace, quotes, `#`, or flow indicators; there is no default.
- [Which files in a bundle are records](bundle-contents.md) - Every `.md` file at any depth under a configured bundle is a record, other than `index.md` and `log.md` at every level and the paths `okf.exclude` matches; a bundle inside another counts each record once, and a symlink to a folder is never followed.
- [Which OKF spec okf-tools follows](spec-pin.md) - okf-tools follows the spec at its home, `open-knowledge-format/open-knowledge-format`, pinned in `spec/upstream.json` to the v0.2 text at `0b87c52`; every spec link points to the pin, and adopting v0.3 is a PR of its own.
- [Who verifies a record](who-verifies.md) - Verification is the person's call, but not only a terminal prompt may record it; an agent verifies with `--yes` when the person asks, naming the files and signing as the person.
- [Why every PR adds a changeset](changeset-every-pr.md) - CI's required `🦋 Changeset` check fails a PR without one; a PR that ships nothing adds `pnpm changeset --empty`, and the version PR, which is exempt, has its CI run approved by hand before it merges.

# About this bundle

This directory is an [Open Knowledge Format v0.2](https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md) bundle of okf-tools' design decisions — one Markdown file per decision, listed above as `- [Title](file.md) - one-line description`, sorted by title, ignoring case.

Each decision opens with YAML frontmatter:

```yaml
---
type: Decision
title: Who verifies a record
description: Verification is the person's call; an agent verifies only when asked.
tags:
  - actors
  - agents
  - cli
  - selection
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md
    title: Open Knowledge Format specification
status: stable
generated: { by: <agent>/<model-id>, at: 2026-11-11T12:00:00Z }
verified: { by: human:jjloneman, at: 2026-11-12T09:00:00Z }
---
```

- **`type`** — always `Decision`.
- **`tags`** — every subject the decision covers, usually 5 to 10, from the vocabulary below, as a block list right after `description`, one `- tag` per line (see [How a record's tags are laid out](tags-layout.md)).
  - Lowercase kebab-case, sorted alphabetically.
  - Add a tag to the vocabulary before using it.
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

- `actors` — Who can sign or write a record: OKF actor strings such as `human:<id>`.
- `agents` — How coding agents use the tool.
- `api` — The library's exported functions and types.
- `change-detection` — How the tool decides which records changed.
- `changelog` — How `CHANGELOG.md` lines are built.
- `changesets` — Changeset files and the `changeset` commands.
- `ci` — CI jobs and required checks.
- `cli` — The command line: flags, selections, and output.
- `commits` — The git commits the tool or the release flow makes.
- `config` — The `okf` block in `package.json`.
- `dependencies` — How consumers depend on the package.
- `distribution` — How the package is published and installed.
- `encoding` — How record bytes are read and written, such as UTF-8 and line endings.
- `exit-codes` — What each exit code means.
- `formatting` — How formatters such as Prettier treat records.
- `frontmatter` — What the tool reads from and writes into a record's frontmatter.
- `git` — How the tool reads and changes the repo through git.
- `github-actions` — Workflows and how their runs are approved.
- `instructions` — The block of agent rules `okf init` keeps in a repo's instruction files.
- `links` — How docs and records link to the spec and to each other.
- `node` — Node.js versions and features the tool relies on.
- `npm` — The npm registry and package metadata.
- `paths` — How record paths are resolved and matched.
- `pull-requests` — What every pull request must carry.
- `refusals` — When the tool refuses a record or a value, and how it says so.
- `releases` — Versioning and publishing.
- `rollback` — Undoing a partial write.
- `roadmap` — How ideas for the package are found, ranked, and decided.
- `rulesets` — The branch rules that protect `main`.
- `safety` — Guards against half-written records or unintended commits.
- `selection` — Which records a run acts on.
- `spec` — Which OKF spec text the tool follows.
- `spec-watch` — How the tool watches the upstream spec for changes.
- `status` — A record's `status` lifecycle: `draft`, `stable`, `deprecated`.
- `symlinks` — How the tool treats symbolic links in and out of a bundle.
- `tags` — How a record's `tags` are written and read.
- `timestamps` — How `generated.at` and `verified.at` are written and compared.
- `typescript` — TypeScript features and type stripping.
- `upstream` — The OKF spec's repositories and where it lives.
- `validation` — How the tool checks values before using them.
- `verification` — Who signs a record off, and what that means.
- `yaml` — How YAML is parsed and what it reads back.
