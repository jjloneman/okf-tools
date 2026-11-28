---
type: Decision
title: How a record's tags are laid out
description: okf-tools recommends a block list for `tags`, one `- tag` per line, since Prettier rewraps a long one-line flow list; it reads every valid layout, and recommends block only for new and fixed records.
tags:
  - agents
  - formatting
  - frontmatter
  - okf-format
  - okf-tags
  - prettier
  - tags
  - yaml
sources:
  - id: frontmatter-format
    resource: ../../src/frontmatter/format.ts
    title: src/frontmatter/format.ts, the --fix formatting edits
  - id: house-rules
    resource: ../../src/house-rules.ts
    title: src/house-rules.ts, the opt-in house rules
  - id: prettier-print-width
    resource: https://prettier.io/docs/options#print-width
    title: Prettier options, print width
  - id: tag-rules
    resource: ../../src/tag-rules.ts
    title: src/tag-rules.ts, how an agent chooses a record's tags
  - id: tags
    resource: ../../src/tags.ts
    title: src/tags.ts, the okf tags command
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-28T04:40:09Z }
verified: { by: human:jjloneman, at: 2026-11-27T07:03:48Z }
---

# How a record's tags are laid out

OKF records usually keep `tags` as a one-line flow list, such as `tags: [ai-models, claude-code, git, okf]`. Prettier, at its default `printWidth` of 80[^prettier-print-width], breaks up a flow list whose line runs longer than that, though it leaves long plain values such as `description` alone, so a long list turns into one bracket and one tag per line. It's still valid YAML, but it breaks the one-line style, hides the tags from `grep '^tags:'`, and in practice caps a record at about 7 short tags, when tags exist to give agents 5 to 10 search terms.

## Decision

As of 2026-11-25:

- **The recommended layout is a block list:**

  ```yaml
  tags:
    - ai-models
    - claude-code
    - git
  ```

  - **Rejected:** a one-line flow list plus a recommended Prettier override with a wider `printWidth` for Markdown. Every bundle would have to carry the config, a repo without it hits the bug again, and the wider width also changes how code in record bodies is formatted. 10 tags of about 12 characters still need a width near 160, so it moves the cap rather than removing it.
  - **Rejected:** accepting Prettier's wrapped flow style. A record's layout would flip when its list crosses 80 characters, so short and long lists look different in the same bundle.

- **Records keep any valid layout.** okf-tools reads all of them; it recommends block only for new records and for records a fix rewrites.
- **Agents list a bundle's tags with a command that reads frontmatter,** not with `grep '^tags:'`, which misses a block list.
- **The tools follow it,** as of 2026-11-26:
  - `okf tags` prints every tag with its record count, with `--format json` for scripts, as `okf status` takes it[^tags] (issue #53);
  - the opt-in `tags-layout` house rule (`H005`) takes `block`, `flow` or `any`, default `any`[^house-rules] (issue #46);
  - `check --fix`, with `tags-layout: block` on, rewrites a flow `tags` list as a block list: a flat list of plain scalars, `tags` only, keeping a comment on the `tags` line and refusing anchors, quoted keys or nested values[^frontmatter-format] (issue #47);
  - the agent-instructions block `okf init` writes says to write `tags` as a block list and to list them with `okf tags`[^tag-rules] (issues #49 and #53);
  - the record skill drafts `tags` as a block list (issue #51).

## Why

What was tried on 2026-11-15, with Prettier 3.9.10:

- A 9-tag flow list at the default width wraps as described above; Prettier's own output is then stable.
- A block list is left alone at any length.
- A one-line flow list survives with `printWidth: 160`, but a 93-character TypeScript line in a record's body, which Prettier splits at 80, is joined back onto one line.
- `verifyRecord` signs off a record with a wrapped flow list, a block list, or a one-line list, and leaves `tags` untouched in each.

So a block list is the only layout that holds at any length with no config in each bundle. It also diffs one tag per line, so adding or sorting a tag is a one-line change.

## Consequences

- Existing bundles keep their one-line flow lists; nothing forces a change, and the #47 fix converts them only when a bundle turns the rule on.
- As of 2026-11-26, this bundle's own records use block lists.
- Another OKF tool that reads `tags` with a regex would miss a block list; any YAML parser reads both, as the spec requires.

## Links

- Issue #65, which chose the layout.

[^prettier-print-width]: Prettier's `printWidth` defaults to 80, the line length it wraps at.

[^tags]: `src/tags.ts`, the `okf tags` command.

[^house-rules]: `src/house-rules.ts`, the opt-in house rules.

[^frontmatter-format]: `src/frontmatter/format.ts`, the `--fix` formatting edits.

[^tag-rules]: `src/tag-rules.ts`, how an agent chooses a record's tags.
