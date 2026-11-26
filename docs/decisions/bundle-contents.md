---
type: Decision
title: Which files in a bundle are records
description: "Every `.md` file at any depth under a configured bundle is a record, other than `index.md` and `log.md` at every level and the paths `okf.exclude` matches; a bundle inside another counts each record once, and a symlink to a folder is never followed."
tags:
  - bundles
  - config
  - dependencies
  - git
  - globs
  - node
  - paths
  - selection
  - spec
  - symlinks
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification
  - id: repo
    resource: ../../src/repo.ts
    title: src/repo.ts, the file-system work on records
  - id: config
    resource: ../../src/config.ts
    title: src/config.ts, which reads the okf block of package.json
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-26T22:59:21Z }
---

# Which files in a bundle are records

A bundle may hold subdirectories, and reserves `index.md` and `log.md` at every level[^okf-spec]; a bundle inside a repo often holds Markdown that isn't a record too, such as a `README.md`.

## Decision

As of 2026-11-25, from `src/repo.ts`[^repo] and `src/config.ts`[^config]:

- **A record is any `.md` file at any depth under a configured bundle**, both when the bundle is listed and when a path is named or found by `--changed`.
  - **Rejected:** only the files directly inside a bundle, as before, since a bundle that groups its records in folders had none of them offered.
- **`index.md` and `log.md` are never records, at any level.**
- **`okf.exclude` lists globs, relative to the repo root, of paths that aren't records.**
  - A path is excluded when it, or a folder above it, matches one, so `docs/decisions/drafts` excludes that folder without a `/**`, and an excluded folder isn't read at all.
  - `*` matches dot files too, so a glob matches what it spells.
  - A record named on the command line that a glob matches is refused as excluded, rather than as not a record.
  - It has no flag, and applies to `--bundle` too.
  - **Rejected:** leaving out every file git ignores instead of only its folders, since a record can be ignored on purpose and still signed with `--no-commit`, and a README is usually committed.
- **Globs are matched with [picomatch](https://github.com/micromatch/picomatch)**, a runtime dependency with no dependencies of its own.
  - **Rejected:** Node's `path.matchesGlob`, which only Node 22.5 and later has, while `engines` accepts any Node 22.
- **A bundle inside another counts each record once**, listed under the first configured bundle that holds it; records are listed in bundle order, then by path.
- **A folder git ignores, such as `node_modules`, or an untracked one holding only ignored files, is never read, nor `.git` or a folder holding one**, a submodule or another clone, since this repo's git can't commit its files.
  - A file git ignores in a folder git reads is still read, as before, so an ignored record is still offered and refused when it's committed.
- **`okf.exclude` refuses a glob that starts with `!` or `/`, or ends with `/`**, though an extglob such as `!(drafts)` is allowed, since those gitignore habits would match nothing, or, for `!`, every bundle.
- **The commit's scope is the bundle's folder name**, whichever of its folders the records are in.
- **A symlink to a folder is never followed**, so a link can't loop or reach outside the bundle; a symlink to a file is still listed, for the run to refuse it (see [How okf-verify writes and commits records](writes.md)).

## Why

- The spec lets a bundle organize records into subdirectories, each with its own `index.md` and `log.md`[^okf-spec].
- A repo that keeps its bundle beside other docs needs a way to say which Markdown isn't a record, or every run reports those files as skipped or refused.
- Listing a record twice when one bundle holds another would offer it twice, and sign it twice in one commit.

## Consequences

- A repo that configured a parent folder as a bundle now sees the records in its subfolders too; the changeset says so.
- The commit message and the interactive checklist still name each record by its file name, so two records with one name in different folders read alike there.

## Links

- Issue #42.

[^okf-spec]: OKF v0.3 §3, the bundle layout, §3.1, the reserved file names, and §9, `log.md` at any level of the hierarchy.

[^repo]: `src/repo.ts`, the file-system work on records.

[^config]: `src/config.ts`, which reads the `okf` block of `package.json`.
