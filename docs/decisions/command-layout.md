---
type: Decision
title: How okf-tools lays out its commands
description: One `okf` binary takes the command as its first argument, starting with `okf verify`; `okf-verify` stays as an alias that runs `okf verify` and prints under its own name.
tags:
  - aliases
  - cli
  - commands
  - exit-codes
  - help
  - okf-verify
  - output
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T19:12:05Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:19Z }
---

# How okf-tools lays out its commands

The package is named okf-tools, but shipped one binary, `okf-verify`. Every planned tool needs a home, and a binary per tool would crowd a consumer's `node_modules/.bin` and leave no place to list them all.

## Decision

As of 2026-11-25, from `package.json`, `src/okf-bin.ts`, `src/bin.ts`, `src/cli.ts`, `src/options.ts`, and `src/output.ts`:

- **One binary, `okf`, takes the command as its first argument.** `verify` is the first command; each new tool is another.
  - **Rejected:** a binary per tool (`okf-verify`, `okf-lint`, …), which has no command that lists them and grows `.bin` with every tool.
- **Options follow the command.** `okf` reads only its first argument: `--help` or `-h` prints the command list and `--version` prints the installed version and the OKF version it follows (issue #59), both exiting `0`; no command, one it doesn't know, or any other flag in its place prints why and the command list and exits `1`.
  - **Rejected:** flags shared across commands before the command (`okf --by <actor> verify`), which no command needs yet.
- **`okf-verify` stays as an alias.** `okf-verify <args>` runs exactly as `okf verify <args>`, with the same flags, selection rules, and exit codes, so no consumer's script or agent instruction breaks.
  - The library's `run` takes the same choice as its `program`, `okf` or `okf-verify`, and runs as `okf-verify` when it's left out, so an in-process caller from before `okf` existed works as it did.
  - Removing the alias is a breaking change, and needs a changeset of its own that says so.
- **Each name prints under its own prefix.** Output lines start with `[okf]` under `okf`, and `[okf-verify]` under the alias, and each usage text names the command as it was called (`okf verify` or `okf-verify`), so a log shows which one ran.
  - **Rejected:** `[okf-verify]` under both names, which would name a command the person never typed.

## Why

- A single entry point is the usual shape for a package of tools (`git`, `npm`, `pnpm`), and gives a place for `okf --help` to list them.
- Keeping the alias makes the new binary an addition, not a breaking change.
- Matching the prefix to the name typed keeps output traceable to the command that produced it, the reason the prefix exists.

## Links

- [Issue #41](https://github.com/jjloneman/okf-tools/issues/41)
- [Who verifies a record](who-verifies.md)
- [What `--yes` verifies, and how it exits](yes-selection.md)
