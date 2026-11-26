---
type: Decision
title: How okf status reports a bundle's trust state
description: "`okf status` lists every record under the first group that fits, changed, draft, never signed off, stale, or settled, judged against the signer's sign-off; it writes nothing, exits `0` whatever it finds, and prints a versioned JSON shape for programs."
tags:
  - agents
  - api
  - exit-codes
  - json
  - okf-status
  - staleness
  - status
  - trust-tiers
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification
  - id: status
    resource: ../../src/status.ts
    title: src/status.ts, the okf status command
  - id: repo
    resource: ../../src/repo.ts
    title: src/repo.ts, the file-system work on records
  - id: frontmatter-read
    resource: ../../src/frontmatter/read.ts
    title: src/frontmatter/read.ts, the record state and trust tier reads
  - id: frontmatter-types
    resource: ../../src/frontmatter/types.ts
    title: src/frontmatter/types.ts, the public types and constants
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-26T22:59:21Z }
---

# How okf status reports a bundle's trust state

Repos tell agents to check a record's `verified` before changing the behavior it describes, which meant opening each file. `okf status` reports every record's trust state in one read-only command.

## Decision

As of 2026-11-25, from `src/status.ts`[^status], `src/options.ts`, `src/cli.ts`, `src/repo.ts`[^repo], `src/frontmatter/read.ts`[^frontmatter-read], and `src/frontmatter/types.ts`[^frontmatter-types]:

- **Each record is listed under one group, the first that fits**, in this order:
  - `changed`: signed off, then regenerated since, whatever its `status`; a sign-off ahead of the clock counts, as it does for `okf verify`;
  - `draft`: `status: draft`, with no sign-off it has changed since;
  - `unverified`, worded "Never signed off by `<signer>`": no entry from the signer, and not a draft;
  - `stale`: signed off and unchanged, but past its `stale_after`;
  - `settled`: signed off, unchanged, and not stale.
  - `changed` comes first, since a sign-off that no longer holds is the one an agent could mistake for agreement; a draft regenerated after its sign-off is both, and lists there.
  - **Rejected:** listing a record under every group it fits, which repeats it, and a separate flag per fact in the text, which buries the one that matters.
- **The JSON keeps every fact beside the group**: `state`, `status`, `isStale`, and the times, so a program needn't rely on the order.
- **Each JSON record also carries `tier`, OKF v0.3's trust tier by its own names**, `unverified`, `machine-confirmed`, or `human-reviewed`, so a tool that reads v0.3's tiers, such as upstream's `okf-consume` skill, needn't translate okf-tools' states[^okf-spec].
  - It follows v0.3's rule: only `verified` events at or after `generated.at` count, from any actor, not only the signer; one from a `human:<id>` actor makes it `human-reviewed`, and others only, `team:` included, `machine-confirmed`.
  - Each actor's latest event counts, as the signer's does for `state`, so the two agree about the signer's own entry whenever each of its events has an `at`.
  - Where v0.3 leaves it open, it judges as `state` does, through the same check: times compare to the whole second, an `at` that can't be read or is ahead of the clock doesn't count, and a missing or unreadable `generated.at` lets every event count.
  - It sits beside `state` and the groups, which stay okf-tools' own, and the text output doesn't show it.
  - **Rejected:** renaming okf-tools' states to v0.3's tiers, since `state` answers a different question: whether the signer's sign-off still holds.
  - It landed before `okf status` was first released, so `schemaVersion` stays `1`: no program has read a shape without it.
- **Filters match those facts, not the group, and add up**: `--draft` is `status: draft`, `--changed` is changed since the sign-off, and `--stale` is past `stale_after`, so `--stale` finds a stale draft too; two filters list records matching either.
- **The signer is `okf.verifiedBy` or `--by`**, as for `okf verify`, and has no default; another actor's entry doesn't count.
  - **Rejected:** counting any actor's sign-off, which would call a record settled that the person never agreed to.
- **`stale_after` is stale from that instant on**, compared to the millisecond so never early, as the spec's `now >= stale_after` says[^okf-spec]; one that can't be read as a time isn't stale.
- **It writes nothing, and exits `0` whatever it finds.** A usage error, a config it can't use, a named path that isn't a record in the bundles, or a bundle it can't list exits `1`.
  - **Rejected:** a non-zero exit when records need attention, which would make a report a gate; a check command is its own issue.
- **It reads records read-only**: a layout the edits refuse, or a `generated.at` ahead of the clock, which `okf verify` refuses, is still reported, since reading it is enough. A file it can't read as a record, from a near-miss block, invalid YAML, a symlink, or bytes it can't read, is listed under Skipped with why, and never filtered out.
- **`--format json` prints one document to stdout with no `[okf]` prefix**, through `output.data`, since a prefix would stop it parsing.
  - Its keys are always present, `null` for what the record doesn't have; `status` is as written, even one OKF doesn't define.
  - **The shape is public API**: it carries `schemaVersion`, now `1`, and a change to it bumps that number and ships as a breaking change. `StatusReport` types it in the library.
- **`status` runs only under `okf`**; the `okf-verify` alias stays `okf verify` alone.

## Why

- A read-only report is safe for an agent to run unasked, unlike `verify`, so it can be the first step before any change to a signed-off behavior.
- One group per record keeps the text short enough to read, and the JSON keeps the detail for anything that needs it.
- Exiting `0` keeps the command a report, and leaves judging to a check command built for it.

## Links

- [Issue #43](https://github.com/jjloneman/okf-tools/issues/43)
- [Issue #115](https://github.com/jjloneman/okf-tools/issues/115), which added `tier`
- [How okf-tools lays out its commands](command-layout.md)
- [Who verifies a record](who-verifies.md)
- [Which actors can sign a record](actor.md)

[^okf-spec]: OKF v0.3: §5.5, `stale_after`, an absolute instant, stale when `now >= stale_after`; §5.3, Trust tiers; and §7, which gives only the `human:` scheme the human-reviewed tier.

[^status]: `src/status.ts`, the `okf status` command.

[^repo]: `src/repo.ts`, the file-system work on records.

[^frontmatter-read]: `src/frontmatter/read.ts`, the record state and trust tier reads.

[^frontmatter-types]: `src/frontmatter/types.ts`, the public types and constants.
