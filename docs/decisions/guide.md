---
type: Decision
title: What `okf guide` prints, and where the agent rules are written
description: "`okf guide` prints the record rules, each command with when an agent may run it, and the skills `okf init` installs, as unprefixed Markdown from the installed version; the rules are one text in `src/guide.ts`, shared with the `okf init` block and the README, and `okf verify --help` points at the guide."
tags:
  - agents
  - exit-codes
  - guidance
  - instructions
  - okf-guide
  - okf-init
  - okf-verify
  - selection
sources:
  - id: agent-block
    resource: ../../src/agent-block.ts
    title: src/agent-block.ts, the agent block's text and markers
  - id: guide
    resource: ../../src/guide.ts
    title: src/guide.ts, the okf guide text and record rules
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-28T04:40:09Z }
verified: { by: human:jjloneman, at: 2026-11-27T07:03:48Z }
---

# What `okf guide` prints, and where the agent rules are written

Guidance copied into a repo goes stale when the package updates, and before `okf guide` the rules for agents were written in three places: the `okf init` block (which the README quotes), the `okf verify --help` text, and this repo's own AGENTS.md. `okf guide` prints the guidance from the installed version, and the copies became one text.

## Decision

As of 2026-11-25, from `src/guide.ts`[^guide], `src/agent-block.ts`[^agent-block], `src/options.ts`, `src/cli.ts`, and the README:

- **`okf guide` prints, as Markdown, what the records are, the rules for writing and verifying them, then each command and when an agent may run it.**
  - `okf verify --yes` signs as the configured `okf.verifiedBy`, the person, so an agent never passes `--by` with its own name.
  - Each command's line says when an agent may run it, as of 2026-11-26: the read-only ones (`okf status`, `okf diff`, `okf check`, `okf tags`, `okf index --check`, `okf init --check`, `okf migrate` without `--write`, `okf guide`) whenever it likes; the ones that edit records (`okf new`, `okf touch`, `okf format`, `okf index`, `okf deprecate`) as part of its own change to them; `okf verify --yes`, `okf init`, and `okf migrate --write` only when the person asks; `okf verify` without `--yes` is the person's; and `okf review-comments`, which posts to GitHub, is the reusable workflow's, never an agent's.
  - It reads nothing, needs no repo or config, takes no arguments but `--help`, and exits `0`; an argument is a usage error that exits `1`.
  - It ends with each skill `okf init` installs and when to load it, built from the skills' own descriptions (#51); see [Which skills okf-tools ships](skills.md).
- **The guide prints with no `[okf]` prefix,** like `okf status --format json`, so it reads, and pastes, as the Markdown it is. Its `--help` and usage errors are prefixed like any other line.
  - **Rejected:** prefixing every line, which breaks the Markdown an agent reads.
- **The intro and the rules are one text, `RECORDS_INTRO` and `RECORD_RULES` in `src/guide.ts`.** The guide prints them, `AGENT_BLOCK` is built from them, and the README's Agents section quotes the block, with tests keeping all three the same.
  - **The block keeps the rules inline,** and adds one line pointing at `okf guide` for the commands.
    - The line says to run it through the repo's package manager, such as `pnpm exec okf guide`, since okf-tools is a dev dependency and `okf` may not be on the path.
    - **Rejected:** a block that only says "run `okf guide`", since an agent can skip running it, and the rule against verifying unasked must reach it anyway.
  - **`okf verify --help` points at `okf guide`,** keeping only the short rule an agent needs before `--yes`: run it only when the person asks, naming the files they approved, and pass `--changed` only when they asked for every changed record.
    - **Rejected:** a fourth copy of the rules in the help text.
  - A test checks that every command `okf --help` lists has a line in the guide, so a new command can't ship without saying when an agent may run it.

## Why

- Printing from the installed version means an agent reads guidance that matches the commands it has, with no copy to refresh.
- One text, checked by tests, keeps the block, the README, and the guide from drifting apart, which is what the copies did before.

## Links

- [Issue #50](https://github.com/jjloneman/okf-tools/issues/50)
- [What `okf init` writes, and how it keeps the agent block current](init.md)
- [Who verifies a record](who-verifies.md)
- [How okf-tools lays out its commands](command-layout.md)

[^guide]: `src/guide.ts`, the `okf guide` text and record rules.

[^agent-block]: `src/agent-block.ts`, the agent block's text and markers.
