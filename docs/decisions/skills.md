---
type: Decision
title: Which skills okf-tools ships, and how okf init installs them
description: "`okf init` installs three Agent Skills in `.claude/skills`, okf-record, okf-review and okf-architecture, written whole from the installed version; they cover the trust workflow and point at upstream's okf-generate for content, never write `verified`, and stamp only through the CLI."
tags:
  - agents
  - claude-code
  - guidance
  - instructions
  - okf-init
  - skills
  - timestamps
  - upstream
  - verification
sources:
  - id: guide
    resource: ../../src/guide.ts
    title: src/guide.ts, the okf guide text and record rules
  - id: init
    resource: ../../src/init.ts
    title: src/init.ts, the okf init command
  - id: skills
    resource: ../../src/skills.ts
    title: src/skills.ts, the skills okf init installs
  - id: tag-rules
    resource: ../../src/tag-rules.ts
    title: src/tag-rules.ts, how an agent chooses a record's tags
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T02:55:27Z }
verified: { by: human:jjloneman, at: 2026-11-27T04:41:52Z }
---

# Which skills okf-tools ships, and how okf init installs them

A CLI can't write a record's prose; an agent can, but it needs to be told how, and instructions an agent can skip or misremember must never own the clock or the sign-off. okf-tools ships three Agent Skills for the prose and keeps both of those in the CLI.

## Decision

As of 2026-11-25, from `src/skills.ts`[^skills], `src/init.ts`[^init], `src/guide.ts`[^guide], and the README:

- **Three skills ship, one constant each in `src/skills.ts`:**
  - **`okf-record`** is the trust workflow around a record: start it with `okf new`, re-stamp it with `okf touch --draft` after every edit apart from a change to `tags` alone, keep it `status: draft`, write `tags` by the shared rules in `src/tag-rules.ts`[^tag-rules], which `okf guide` prints too, and leave sign-off to `okf verify`.
    - Its tag audit finds records with too few or too many tags, proposes every new list in one table, and writes only the lists the person approves, without re-stamping them (see [How okf new and okf touch stamp generated](new-and-touch.md)).
  - **`okf-review`** reads `okf status --format json` and `okf diff`, and summarizes for the person what changed in meaning in each record since their last sign-off, and what to check; it writes nothing.
  - **`okf-architecture`** creates, updates, or audits a `type: Architecture` record written from the code it lists in `sources`, from a fixed outline, with every claim footnoted to a source. Each version of the record names the commit it was written from, and an update rewrites only the sections whose cited sources changed since that commit; an audit reports one verdict per claim and edits nothing.
- **The record skill narrows to what okf-tools owns, and points at upstream's `okf-generate` skill for what goes in a record.** okf-generate, which OKF v0.3 ships, already covers sources, footnotes, types, links, and index and log files, so restating it would drift.
  - **Rejected:** a record skill that restates the content rules.
  - Where the two differ, okf-record wins in a repo that uses okf-tools. **okf-generate records a `human:<id>` verification once the person confirms the content; okf-tools never writes `verified`**, and neither does any of its skills: the person signs off with `okf verify`, or an agent runs `okf verify --yes` only when asked, naming the records.
  - okf-generate's examples write `tags` as a one-line list; okf-record says to write a block list, per [How a record's tags are laid out](tags-layout.md).
  - okf-record also says to cite in `sources` each repo file a record was written from, since that's what lets `okf check`'s source rules warn when the code moves after a sign-off (issue #133). The record rules in `src/guide.ts`[^guide] say it too, so a repo that reads `okf guide` or the agent block without the skill learns it (issue #135).
- **No skill writes a timestamp or tells an agent how to type one.** A new record comes from `okf new` and an edited one is re-stamped by `okf touch`, per [How okf new and okf touch stamp generated](new-and-touch.md).
- **`okf init` writes each skill to `.claude/skills/<name>/SKILL.md`, whole,** where Claude Code finds a repo's skills, and `--check` fails when one is missing or out of date.
  - Each file carries a marker line after its frontmatter, so a refresh rewrites only a file an earlier `okf init` wrote. A file there without the marker is someone's own skill, and is refused, writing nothing.
  - **Rejected:** a marked block inside the file, as `AGENTS.md` has, since a skill is okf-tools' text from end to end, and a repo that wants to change one copies it under another name.
  - A copy that differs only in CRLF line breaks counts as current, so a Windows checkout doesn't fail `--check`.
  - **There's no flag to skip the skills,** so a repo whose `.claude` is linked from outside it, or holds its own skill under an okf name, can't run `okf init` until it moves that aside. **Rejected for now:** a `--no-skills` flag, revisited when a repo asks for one.
  - The guide lists each skill and when to load it, from the same constants.
- **No plugin packaging, for now.** Upstream ships its skills with Claude and Codex plugin manifests, installed from its repo. A plugin installed from git would float apart from the version in the repo's lockfile, while `okf init` writes the skills that match the installed commands.
  - **Rejected for now:** Claude and Codex plugin manifests in the package, and an `.agents/skills` copy for other agents; either is revisited when someone asks for an agent other than Claude Code.

## Why

- The CLI owns the clock and the sign-off because a skill is only instructions; okf-tools' own commands refuse what a skill might get wrong.
- Pointing at okf-generate keeps one source for OKF's content rules, which upstream maintains, and leaves okf-tools' skills about what it alone adds.
- Writing the skills from the installed version, with a `--check` for CI, keeps them in step with the commands they name, as the agent block does.

## Links

- [Issue #51](https://github.com/jjloneman/okf-tools/issues/51), and its comment of 2026-11-25 comparing it with OKF v0.3
- [Issue #65](https://github.com/jjloneman/okf-tools/issues/65), which added the block-list tags to its plan
- [Issue #66](https://github.com/jjloneman/okf-tools/issues/66), which added the tag rules and the tag audit
- [Upstream's okf-generate skill](https://github.com/open-knowledge-format/open-knowledge-format/tree/527e81aff55992be21507e97004286789126f88c/skills/okf-generate)
- [What `okf init` writes, and how it keeps the agent block current](init.md)
- [What `okf guide` prints, and where the agent rules are written](guide.md)
- [Who verifies a record](who-verifies.md)

[^skills]: `src/skills.ts`, the skills `okf init` installs.

[^init]: `src/init.ts`, the `okf init` command.

[^guide]: `src/guide.ts`, the `okf guide` text and record rules.

[^tag-rules]: `src/tag-rules.ts`, how an agent chooses a record's tags.
