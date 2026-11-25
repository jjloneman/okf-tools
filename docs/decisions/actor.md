---
type: Decision
title: Which actors can sign a record
description: "`okf.verifiedBy` or `--by` must be an OKF actor YAML reads back as a plain string: it starts with a letter, has a `:` or `/` after it, and holds no whitespace, quotes, `#`, or flow indicators; there is no default."
tags: [cli, frontmatter]
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md
    title: Open Knowledge Format specification
  - id: yaml-spec
    resource: https://yaml.org/spec/1.2.2/
    title: YAML 1.2.2 specification
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T17:06:26Z }
verified: { by: human:jjloneman, at: 2026-11-25T15:54:46Z }
---

# Which actors can sign a record

`okf-verify` writes the signer into an inline entry, `verified: { by: <actor>, at: <timestamp> }`, editing only the characters that change. As of 2026-11-25, the entry itself is written by the `yaml` package (`formatEntry` in `src/frontmatter/edit.ts`), which would quote an actor that needed it. The rule below keeps every actor one YAML reads back as the same string unquoted, so the entries it writes keep the unquoted shape people and agents write by hand.

## Decision

As of 2026-11-11, from `src/config.ts`:

- **Who signs** comes from `--by <actor>`, else `okf.verifiedBy` in `package.json`. With neither, the run stops with exit `1` and, as of 2026-11-25, an error naming the `package.json` it read; there's no default actor.
- **An actor must:**
  - start with a letter, so YAML can't read it as a number, a date, a sexagesimal like `12:30`, or an indicator such as `*`, `&`, `!`, or `@`;
  - have a `:` or a `/` after its first character, a kind or a producer, as OKF's actor convention does: `human:jjloneman`, `claude-code/2.1.316`[^okf-spec];
  - hold no whitespace, quotes, `#`, `(`, `)`, `,`, `[`, `]`, `{`, or `}`;
  - not end in `:`, which would read as a key.
- **Anything else is refused** before a record is touched, with an error naming the value.
- **`generated.by` isn't checked.** The tool reads only `generated.at`, so any actor an agent writes there works.

## Why

- Inside a flow mapping, YAML treats `,`, `{`, `}`, `[`, and `]` as structure, `#` after a space as a comment, and a leading indicator as syntax[^yaml-spec]. An actor holding any of them has to be quoted, and one written unquoted, as people and agents write entries by hand, would corrupt the record or read back as something else.
- Quoting keeps such an actor safe in the entries `okf-verify` writes, but they would then differ in shape from the unquoted ones written by hand, and a hand-written entry that left the quotes off would sign as someone else, or break the record.
- No default actor, because signing as the wrong person is worse than stopping: every run names who signs.

## Consequences

- An actor such as `process:ci` or `human:jj-loneman` works; `jjloneman`, `@jjloneman`, and `human:jj loneman` don't.
- Widening the rule means proving YAML still reads the new form back as the same string.

[^okf-spec]: OKF's actor convention: `<producer>/<version>` for agents, `human:<id>` for people, `process:<id>` for automated processes.

[^yaml-spec]: YAML 1.2.2 plain scalars, flow collections, and indicator characters.
