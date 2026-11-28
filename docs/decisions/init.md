---
type: Decision
title: What `okf init` writes, and how it keeps the agent block current
description: "`okf init` writes the `okf` block of `package.json`, a block of agent rules between two marker lines in `AGENTS.md`, rewriting only the text between them, and the okf skills in `.claude/skills`; malformed markers and skills it didn't write are refused, and `--check` fails when a block or a skill is missing or stale."
tags:
  - agents
  - config
  - copilot
  - instructions
  - okf-init
  - package-json
  - refusals
  - safety
  - skills
  - tags
sources:
  - id: agent-block
    resource: ../../src/agent-block.ts
    title: src/agent-block.ts, the agent block's text and markers
  - id: guide
    resource: ../../src/guide.ts
    title: src/guide.ts, the okf guide text and record rules
  - id: init
    resource: ../../src/init.ts
    title: src/init.ts, the okf init command
  - id: tag-rules
    resource: ../../src/tag-rules.ts
    title: src/tag-rules.ts, how an agent chooses a record's tags
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-28T04:40:09Z }
verified: { by: human:jjloneman, at: 2026-11-27T07:03:48Z }
---

# What `okf init` writes, and how it keeps the agent block current

Each repo that uses okf-tools hand-wrote its OKF rules for agents, and the copies drifted from what the tool does. `okf init` writes the config and one marked block of agent rules, and running it again after an upgrade refreshes the block from the installed version.

## Decision

As of 2026-11-25, from `src/init.ts`[^init], `src/agent-block.ts`[^agent-block], `src/options.ts`, and the README:

- **The block sits between two whole lines, `<!-- okf:start -->` and `<!-- okf:end -->`,** and only the text between them is ever rewritten. A marker must start its line, so one quoted in an indented code block isn't taken for one; one quoted in a ``` fence still is, and is then refused as a repeat. A byte order mark before the first line is kept and skipped.
  - **Rejected:** owning the whole file, which would overwrite a repo's own rules.
  - **Rejected:** a heading as the boundary, since a heading's section runs to the next heading, which the repo may move or edit.
- **A file with no block gets it at the end, after a blank line, and a missing file is created.** The block takes the file's line breaks, CRLF when its first one is.
- **Malformed markers are refused, and nothing is written:** a marker without its pair, a repeated one, or the end before the start. The person fixes them by hand.
  - **Rejected:** repairing them, which means guessing where the person's text ends.
- **`AGENTS.md` always gets the block; `.github/copilot-instructions.md` gets it under `--copilot`,** or whenever it already holds a marker, so a refresh doesn't depend on remembering the flag. A Copilot file that isn't asked for and can't be read is skipped, not refused.
- **The `okf` block of `package.json` takes the flags over what's there.** `--bundle` replaces `okf.bundles`, read from where it's run and stored from the repo root; `--by` sets `okf.verifiedBy`. Only the `okf` member's text changes, found by position: every other byte of the file is kept, and the new value follows the file's indent, line breaks, and whether its arrays sit on one line (a one-line file stays on one line). It's written only when the `okf` block changes.
  - **Rejected:** re-serializing the whole file with `JSON.stringify`, which reformats unrelated keys, unescapes strings, and rewrites numbers such as `1.0`, so a Prettier check fails after every run.
  - The bundles must already exist inside the repo, checked as `okf verify` checks them; `okf init` creates no folders or records.
  - **An actor is optional:** with none set, it says `okf verify` will need `--by`. One that is set, by `--by` or in the config, must be an actor a record can hold, so init never passes a config `okf verify` rejects.
    - **Rejected:** requiring one, since `okf verify --by` can name the signer, and a shared repo may leave `okf.verifiedBy` unset on purpose.
  - **Rejected:** creating a `package.json` when there's none; `okf init` refuses and says to add one.
- **Every file is planned before any is written,** so a refusal in one writes none. Each file, `package.json` included, must resolve inside the repo, an existing one must be a file, and a missing one's nearest existing ancestor must be a folder, so a write can't fail on a known problem after others have landed. A write that fails midway names the files already written. It never commits.
- **It writes the okf skills to `.claude/skills/<name>/SKILL.md`,** whole, refreshing only a file an earlier `okf init` wrote, and refusing one it didn't, writing nothing (#51); see [Which skills okf-tools ships, and how okf init installs them](skills.md).
- **`okf init --check` writes nothing,** and exits `1` when a target is missing, has no block, has a stale one, or has malformed markers, or when a skill is missing, stale, or not its own; it checks the blocks and the skills, not the config. `--check` takes no `--bundle` or `--by`.
- **The block's text is one constant, `AGENT_BLOCK`,** which the README's Agents section quotes, and a test keeps the two the same, so the rules are written once.
  - Its intro and rules come from `src/guide.ts`[^guide], which `okf guide` prints too, and it ends with a line pointing at `okf guide` for the commands (#50); see [What `okf guide` prints](guide.md).
  - It names only commands that exist: `okf tags` (#53) is how its tag rules list the bundles' tags, and `okf init` then brings every repo up to date.
  - It ends with the tag rules from `src/tag-rules.ts`[^tag-rules] (#66), which the okf-record skill quotes too: 5 to 10 specific tags that reuse the bundle's own, a block list per [How a record's tags are laid out](tags-layout.md), no re-stamp for a change to `tags` alone, and the repo's tag house rules winning where `okf.rules` turns one on.

## Why

- Rules copied by hand go stale silently; a block written from the installed version, with a `--check` for CI, makes the drift visible and the fix one command.
- Rewriting only between markers keeps a repo's stricter rules, which [Who verifies a record](who-verifies.md) expects it to state in its own instructions.
- Refusing malformed markers and planning every file first mean a refresh can't damage what's outside the block.

## Links

- [Issue #49](https://github.com/jjloneman/okf-tools/issues/49)
- [Issue #51](https://github.com/jjloneman/okf-tools/issues/51), which added the skills
- [Issue #65](https://github.com/jjloneman/okf-tools/issues/65), which added the tags rules to the block's plan
- [How okf-tools lays out its commands](command-layout.md)
- [What `okf guide` prints](guide.md)
- [Which skills okf-tools ships, and how okf init installs them](skills.md)
- [How a record's tags are laid out](tags-layout.md)
- [Who verifies a record](who-verifies.md)

[^init]: `src/init.ts`, the `okf init` command.

[^agent-block]: `src/agent-block.ts`, the agent block's text and markers.

[^guide]: `src/guide.ts`, the `okf guide` text and record rules.

[^tag-rules]: `src/tag-rules.ts`, how an agent chooses a record's tags.
