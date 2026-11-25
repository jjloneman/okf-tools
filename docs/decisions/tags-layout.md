---
type: Decision
title: How a record's tags are laid out
description: okf-tools recommends a block list for `tags`, one `- tag` per line, since Prettier rewraps a long one-line flow list; it reads every valid layout, and recommends block only for new and fixed records.
tags: [agents, frontmatter]
sources:
  - id: prettier-print-width
    resource: https://prettier.io/docs/options#print-width
    title: Prettier options, print width
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T07:20:10Z }
verified: { by: human:jjloneman, at: 2026-11-25T15:54:46Z }
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
- **Planned work follows it:**
  - issue #53 adds `okf tags`, printing every tag with its record count, with `--json` for scripts;
  - issue #46 adds an opt-in `tags-layout` rule, `block`, `flow` or `any`, default `any`;
  - issue #47's `check --fix`, with `tags-layout: block` on, rewrites a flow `tags` list as a block list: a flat list of plain scalars, `tags` only, keeping a comment on the `tags` line and refusing anchors, quoted keys or nested values;
  - issue #49's agent-instructions block says to write `tags` as a block list and to list them with `okf tags`;
  - issue #51's record skill drafts `tags` as a block list.

## Why

What was tried on 2026-11-15, with Prettier 3.9.10:

- A 9-tag flow list at the default width wraps as described above; Prettier's own output is then stable.
- A block list is left alone at any length.
- A one-line flow list survives with `printWidth: 160`, but a 93-character TypeScript line in a record's body, which Prettier splits at 80, is joined back onto one line.
- `verifyRecord` signs off a record with a wrapped flow list, a block list, or a one-line list, and leaves `tags` untouched in each.

So a block list is the only layout that holds at any length with no config in each bundle. It also diffs one tag per line, so adding or sorting a tag is a one-line change.

## Consequences

- Existing bundles keep their one-line flow lists; nothing forces a change, and the #47 fix converts them only when a bundle turns the rule on.
- This bundle's own records keep one-line flow lists, which are all short enough today.
- Another OKF tool that reads `tags` with a regex would miss a block list; any YAML parser reads both, as the spec requires.

## Links

- Issue #65, which chose the layout.

[^prettier-print-width]: Prettier's `printWidth` defaults to 80, the line length it wraps at.
