---
type: Decision
title: How changelog lines are built
description: "`scripts/changelog.ts` prefixes each changeset's summary with the gitmoji and scope of the squash commit that added it, under changesets' own bump-type headings; it's tested but never published, and runs under Node's type stripping."
tags: [releases]
sources:
  - id: changesets-changelog
    resource: https://github.com/changesets/changesets/blob/main/docs/modifying-changelog-format.md
    title: Changesets, modifying the changelog format
  - id: node-type-stripping
    resource: https://nodejs.org/api/typescript.html
    title: Node.js, modules and TypeScript
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T23:36:00Z }
verified: { by: human:jjloneman, at: 2026-11-12T00:34:41Z }
---

# How changelog lines are built

changesets' default formatter writes `- <short hash>: <summary>` and reads no commit messages. This repo's commit subjects already carry a type, a scope, and a gitmoji, so the changelog reuses them.

## Decision

As of 2026-11-11, from `scripts/changelog.ts` and `.changeset/config.json`:

- **A custom formatter,** named by `changelog` in `.changeset/config.json`[^changesets-changelog].
- **Each line reads the commit that added the changeset,** which after a squash merge is the PR title: `- ✨ **okf-verify:** <summary> (<short hash>)`.
  - A `!` after the type (`feat(cli)!: …`) adds `**Breaking:**` after the scope.
  - When that commit can't be read, such as a hash from before a squash, the line is the bare summary, with no hash.
  - git failing for any other reason also prints a warning on stderr.
- **The headings stay changesets' own** `### Minor Changes` and `### Patch Changes`, by bump type, rather than regrouping lines by commit type; the formatter only builds one line per changeset.
- **It's TypeScript outside `src/`:**
  - covered by `pnpm test:coverage`'s 100% gate like `src/`;
  - never bundled or published, since only `dist/` ships.
- **changesets `import()`s the `.ts` file directly,** under Node's type stripping[^node-type-stripping]:
  - it uses only erasable syntax, which `erasableSyntaxOnly` in `tsconfig.json` enforces, and `.ts` import specifiers;
  - that needs Node 22.18 or later, which `devEngines.runtime` in `package.json` enforces for every `pnpm` script;
  - `engines` stays `>=22`, since the published package runs on any Node 22.

## Why

- The owner asked for changelog lines that read like the commit history, with emoji and scope (review thread on PR #2, filed as issue #3).
- `@changesets/changelog-github` was the other common choice, but it needs a `GITHUB_TOKEN` when versioning and adds no gitmoji.
- Regrouping by commit type would mean post-processing the whole `CHANGELOG.md`, since changesets owns the headings; the gitmoji on each line already shows the type.
- Loading the `.ts` directly keeps one source with no build step for a dev-only script; `devEngines` turns an old Node into a clear error rather than a syntax failure mid-release.

## Consequences

- A PR title is the changelog line's prefix, so it has to follow the commit conventions; a non-conventional title just drops the prefix.
- Raising `devEngines` doesn't affect consumers; raising `engines` does, and is a breaking change.

[^changesets-changelog]: changesets lets `changelog` name a module exporting `getReleaseLine` and `getDependencyReleaseLine`.

[^node-type-stripping]: Node strips erasable TypeScript syntax when it loads a `.ts` file, unflagged from 22.18; it refuses to for files under `node_modules`.
