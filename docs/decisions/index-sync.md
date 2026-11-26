---
type: Decision
title: How okf index keeps an index.md in step with its records
description: "`okf index` rewrites each top-level list line that links to a record from its title and description, sorted by title within its run, adds missing records, drops gone ones, and keeps a tag index between markers; everything else in the file stays as written, and `--check` fails when an index differs."
tags:
  - exit-codes
  - index
  - links
  - okf-index
  - okf-tags
  - refusals
  - safety
  - tags
sources:
  - id: index-sync
    resource: ../../src/index-sync.ts
    title: src/index-sync.ts, the rewrite of one index.md
  - id: index-command
    resource: ../../src/index-command.ts
    title: src/index-command.ts, the okf index command
  - id: tags
    resource: ../../src/tags.ts
    title: src/tags.ts, the okf tags command
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:19Z }
---

# How okf index keeps an index.md in step with its records

A bundle's `index.md` repeats each record's title and description on one line, so the two drift apart, and listing a bundle's tags meant a `grep '^tags:'` that misses a block list. `okf index` rewrites those lines from frontmatter, and `okf tags` lists the tags.

## Decision

As of 2026-11-25, from `src/index-sync.ts`[^index-sync], `src/index-command.ts`[^index-command], `src/tags.ts`[^tags], `src/options.ts`, and `src/cli.ts`:

- **Only record lines are rewritten:** a top-level list item that opens with a link to a record. Its link text becomes the `title`, escaped, or the file name with none; what follows becomes the `description` on one line, after the separator the line already uses.
  - The target, anything indented under the line, the frontmatter (such as a root index's `okf_version`), headings, prose, fenced code, and every other line are kept as written.
  - **Rejected:** regenerating the whole index, which would overwrite an index's own prose and headings, out of scope by the issue.
- **Each run of consecutive record lines is sorted by title, ignoring case, then path**, so a grouped index keeps each record under the heading it's already in.
- **A record no line lists joins the first run**, or a new list under the first heading, or at the end with none; the index that lists it is the nearest `index.md` in its folder or above, inside the bundle.
  - A line linking to any record is rewritten wherever it is, so a record listed in two indexes stays in both.
  - A record any list line already links to, nested, numbered, or spelled in another case, isn't added again.
- **Every `index.md` in a bundle that exists is synced:** each bundle's own, each one a record lists under, and each one git tracks, so an index whose records were all removed still loses their lines.
- **A line linking to a Markdown file in the index's folder that no longer exists is dropped**, since its record was removed; a link outside that folder, or to anything but Markdown, is kept, and so is a gone line with lines indented under it, which are the person's own.
- **It edits only `index.md` files that exist.** An index listing a record it can't read is refused, since its line can't be written, and so is a symlinked one, as records are.
- **`--check` writes nothing and exits `1` when an index is out of date**; a sync that writes exits `0`, and any refusal exits `1`.
- **The tag index sits between `<!-- tag-index:start -->` and `<!-- tag-index:end -->`**, the markers safe-fns' own script used, so its index needs no edit to switch.
  - Each tag, sorted, then a link to each of the index's records that carries it, sorted by title.
  - A tag's meaning is kept from the line already there; a tag no record carries stays, with a placeholder line, so the vocabulary never loses one unseen.
  - **Rejected:** records sorted by file name, as safe-fns' script did, which would order the tag index differently from the list above it.
  - Malformed markers refuse the index, as `okf init` refuses its own; markers quoted in fenced code don't count.
- **`okf tags` prints every tag with its record count, sorted by name**, read from frontmatter, so every list layout counts. `--format json` prints `TagsReport`, a public shape with `schemaVersion`.
  - **Rejected:** a `--json` flag, as the issue first said; `okf status` already takes `--format json`, and one flag for both keeps the commands alike.
- **Neither command needs a signer**, so neither asks for `okf.verifiedBy` or `--by`.

## Why

- Rewriting lines in place keeps the index the owner wrote, and fixes only what frontmatter already says.
- A check that fails in CI catches the drift the issue was filed for, the way `okf init --check` does for the agent block.
- Reading tags from frontmatter is what [How a record's tags are laid out](tags-layout.md) asked for, since a block list hides from `grep`.

## Links

- [Issue #53](https://github.com/jjloneman/okf-tools/issues/53)
- [Issue #65](https://github.com/jjloneman/okf-tools/issues/65), which asked for `okf tags`
- [How a record's tags are laid out](tags-layout.md)
- [What `okf init` writes, and how it keeps the agent block current](init.md)

[^index-sync]: `src/index-sync.ts`, the rewrite of one `index.md`.

[^index-command]: `src/index-command.ts`, the `okf index` command.

[^tags]: `src/tags.ts`, the `okf tags` command.
