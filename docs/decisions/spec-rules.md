---
type: Decision
title: Who owns the spec rules `okf check` runs
description: okf-tools builds the spec rules into `okf check` itself, on the frontmatter reader `okf verify` uses; a trial of okfit, okf-lint and okf-kit on a fabricated bundle rejected adopting any of them, and adopting one is revisited if v0.3 grows the spec rules well past what okf-tools reads.
tags:
  - checks
  - frontmatter
  - landscape
  - node
  - okf-check
  - spec
  - upstream
  - validation
  - yaml
sources:
  - id: okfit
    resource: https://www.npmjs.com/package/@okfit/cli/v/0.16.7
    title: "@okfit/cli 0.16.7 on npm"
  - id: okf-lint
    resource: https://www.npmjs.com/package/@thisismydesign/okf-lint/v/0.2.0
    title: "@thisismydesign/okf-lint 0.2.0 on npm"
  - id: okf-kit
    resource: https://www.npmjs.com/package/okf-kit/v/0.22.0
    title: okf-kit 0.22.0 on npm
  - id: spec-rules
    resource: ../../src/spec-rules.ts
    title: src/spec-rules.ts, the rules the spec states
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-25T21:48:46Z }
---

# Who owns the spec rules `okf check` runs

`okf check` (#44) runs the rules the OKF spec states, such as a present `type` and an offset on every timestamp, beside okf-tools' own trust and house rules. Several npm packages already check a bundle against the spec, so #40 tried three of them before #44 was built.

## Decision

As of 2026-11-25, from the trial in #40:

- **okf-tools builds the spec rules into `okf check` itself**[^spec-rules], on the engine #44 adds and the frontmatter reader `okf verify` already uses.
  - **Rejected:** calling okf-lint[^okf-lint] as a library inside `okf check`. It has a `lint()` export and per-rule severities, but it reads YAML with the default schema rather than okf-tools' failsafe one, so `check` and `verify` could disagree about a record; it has one maintainer and no stated plan for v0.3.
  - **Rejected:** recommending okf-kit[^okf-kit] beside `okf check`. It's a command with no library export, so users would run two tools, one per bundle; it assumes v0.1 unless a bundle declares `okf_version`, and it misjudges a repo with several bundles when run from the root.
  - **Rejected:** okfit[^okfit]. It needs Node 24.11 and 77 packages, errors on two cases #44 keeps as warnings, and its `sync` and `verify` overlap okf-tools' own sign-off.
- **The trial added two rules to #44:**
  - each `index.md` line links to a record that exists, which okf-lint and okf-kit caught and okfit missed;
  - a key the spec doesn't define, such as the `integrity` key okfit writes, passes without a finding, so a repo can use both tools.
- **None of the three is a dependency**, at run time or in development.

## Why

- `check`, `verify` and `status` should agree about a record, and that holds only with one reader and one set of severities.
- The spec rules are about six checks over a reader okf-tools already has, so building them costs less than wrapping another tool's output and overriding its severities.
- The tools disagree with each other: okf-lint warns on every relative link and okf-kit on every `/` link, and only okfit errors on a date-only `stale_after` or an unknown `status`.
- okf-tools pins the spec and moves the pin in a PR of its own (see [Which OKF spec okf-tools follows](spec-pin.md)); spec rules it owns move with the pin, not with another maintainer's releases.

## What the trial found

As of 2026-11-25, on one fabricated git repo with two bundles, every file hashed before and after each run:

- **All three caught the core cases**: no frontmatter, frontmatter that doesn't parse, a missing or empty `type`, a `log.md` heading that isn't `YYYY-MM-DD`, and a `generated.at` with no offset.
- **None reported records missing from `index.md`**, and none takes a list of bundles the way `okf.bundles` does.
- **Spec versions:**
  - okfit 0.16.7 targets v0.2, and its core library moved to v0.3 in 0.18.0;
  - okf-lint and okf-kit target v0.1 and v0.2.
- **Writes:**
  - okf-lint and okf-kit wrote nothing, and neither did okfit's `validate` or `lint`;
  - okfit's `sync` re-stamped `generated.at` on a signed-off record, added a non-spec `integrity` key, rewrote `index.md` without the records whose frontmatter was broken, and deleted a `log.md` section under a malformed heading;
  - okfit's `verify` appends to `verified` like `okf verify` and adds a content digest under `integrity.verified`; its `validate` and `lint` warn, as `verified-drift`, on every record signed without one.

## Consequences

- #44 builds the spec rules, the engine, and the two rules above, with a fixture for each.
- When the pin moves to v0.3, the spec rules change in the same PR.
- **Revisit** if v0.3 grows the spec rules well past what okf-tools reads, such as `sources` and computations, and okf-lint or another tool keeps up with it.

## Links

- [#40](https://github.com/jjloneman/okf-tools/issues/40) — the trial, with its findings table.
- [#44](https://github.com/jjloneman/okf-tools/issues/44) — the engine and the spec rules.

[^okfit]: The okfit command line, the version tried; MIT, one maintainer, 57 releases from 2026-09-04 to 2026-11-25.

[^okf-lint]: An opinionated OKF linter with a programmatic API, the version tried; MIT, one maintainer, released 2026-10-31.

[^okf-kit]: A command that checks OKF v0.1 and v0.2 bundles, part of a larger project, the version tried; MIT.

[^spec-rules]: `src/spec-rules.ts`, the rules the spec states.
