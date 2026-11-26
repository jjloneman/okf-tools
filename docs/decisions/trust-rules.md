---
type: Decision
title: How okf check judges whether a sign-off still holds
description: "`okf check` runs okf-tools' own `T` trust rules beside the spec rules: a draft is a notice unless `okf.drafts` says allow, warn or block, a sign-off counts only while current as OKF v0.3 defines it, a body changed since the base branch under a sign-off the base already held that still counts is an error, and a file in the repo that a record's `sources` cite warns when it changed after the record was written or signed off, and fails when it's gone; `--changed` reports only on what the branch changed."
tags:
  - change-detection
  - checks
  - ci
  - cli
  - config
  - git
  - sources
  - staleness
  - status
  - timestamps
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification, v0.3
  - id: validate-py
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/skills/okf-generate/scripts/validate.py
    title: Upstream's validate.py, at the pinned commit
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T01:03:37Z }
---

# How okf check judges whether a sign-off still holds

[How okf check numbers, ranks and reports its rules](check-rules.md) covers the spec rules. #45 adds what no general OKF checker judges: whether a record's sign-off still means what it says, and a gate that fails a pull request which changes a signed-off record without re-stamping it.

## Decision

As of 2026-11-26, from `src/trust-rules.ts`, `src/source-rules.ts`, `src/spec-rules.ts`, `src/check.ts`, and `src/config.ts`:

- **A sign-off is current as OKF v0.3 counts one**[^okf-spec]: its `at` is at or after `generated.at`, to the whole second, and not ahead of the clock. §5.3's "only current verifications count" is the basis for "changed since sign-off", not house policy.
  - A sign-off ahead of the clock isn't current, as #92 settled for listings.
  - Only each actor's latest sign-off counts, as `getTrustTier` reads them, since `okf verify` renews only that one.
  - `readChangedAt` alone reads the last change time, `generated.at`, so a spec that moves it to a new key (upstream issue 28) changes one function.
- **Two of upstream's information findings join the spec rules**, with `validate.py`'s codes and wording[^validate-py]: `I201` for a record past its `stale_after`, and `I204` for one whose every `verified` event is older than `generated.at`. Both are `info` and never fail a run.
- **okf-tools' own rules take `T` codes**, `T001` to `T006`, a letter upstream doesn't use, so a later upstream rule never collides with one.
  - **Rejected:** `E3xx` and `W3xx` codes in upstream's style. Upstream's letter names the severity, and `okf.drafts` changes the draft rule's, so its code would change with the config.
- **`T001 draft` notes a `status: draft` record, at a severity `okf.drafts` sets:** unset, a notice; `allow`, nothing; `warn`, a warning, which `--strict` fails on; `block`, an error, for a branch that must not merge drafts.
- **`T002 verified-draft` warns about a draft with a current sign-off**, which `okf verify` would have set `stable`.
  - **Rejected:** any `verified` entry on a draft. A signed-off record that's edited goes back to `draft` and keeps its old entry, as AGENTS.md says, so that would flag every edit in progress.
- **`T003 generated-ahead` and `T004 verified-ahead` warn about a time later than now**, as a wrong time zone writes it, following #77 and #92: no sign-off made now passes the first, and the second would hide every change until the clock passes it.
- **`T005 self-verified` warns about a current sign-off by the actor in `generated.by`**, so no one else has checked the record. It's a warning, not an error, while upstream issue 60 is open; an older sign-off by the same actor is history and isn't flagged.
- **`T006 unstamped-change` is the gate, and an error:** a record whose body changed since the base while a sign-off the base already held is still current, as when `generated.at` wasn't re-stamped.
  - Whether `generated.at` changed isn't what it checks: a re-stamp to a time before the sign-off, or a removed or unreadable `generated.at`, leaves the old sign-off current, and that's still an error.
  - The body is everything after the frontmatter, its line breaks compared as LF.
  - A sign-off made on the branch came after the change, so it covers it.
  - **Rejected:** comparing the frontmatter too. Re-stamping and signing off change it themselves, and a key-by-key list of what counts as content would drift from the spec.
- **`T007 source-changed` warns when a file in the repo that `sources` cites changed after the record was last written or signed off**, as #52 asked, so a record written from code shows when the code moved on.
  - A `resource` counts when it resolves by §6's rules[^okf-spec] to a path in the repo, a folder included, even outside the bundle: a record about code cites the code. Only the path's git history and whether it exists are read, never its text, which §6 keeps a consumer from reading outside the bundle.
  - A URL is skipped, and so is a value with a space, which §6 has a path percent-encode, so it's a scope descriptor.
  - A change is a commit to the path, or uncommitted changes to it, later than both `generated.at` and the latest sign-off, to the whole second, by the commit's author time.
    - **Rejected:** the committer time. A rebase, a cherry-pick, or an amend resets it to now, so every source commit on a rebased branch would read as newer than the record.
  - A commit that changed the record too doesn't count, since the record kept up with it, as a squash-merged pull request does; nor do uncommitted changes while the record has some too.
  - It's a warning, not an error: it works at file level, so a change that leaves the record true still warns, and judging the prose is the review skill's audit mode.
  - A `generated.at` or sign-off later than now doesn't count, as `T003` and `T004` warn, so it can't hide a source change until the clock passes it.
  - **Rejected:** comparing `sources[].last_modified`. It's the source's own recency signal, written by hand, and goes stale the same way.
- **`T008 source-gone` fails a cited path that git history has but the working tree doesn't**, as when the cited file was deleted or moved. A path git never had is skipped, since it may be a scope descriptor without a space, or knowledge not written yet.
- **The `v0.2` fallback that tries a path from the bundle root is not applied** to `sources`, as #52 didn't ask for it; `/` resolves from the bundle root either way.
- **The base is the merge base with the ref `okf verify --changed` diffs against**, as [What a record counts as changed against](base-ref.md) says; with none, such as a repo with no `main` or remote, uncommitted changes are compared with `HEAD`.
- **The gate runs on every `okf check`**, over the files changed since the base, so a hook catches the change before a pull request does.
- **`--changed` reports only on the files changed since the base branch**, a bundle-wide rule's findings included, and on the records whose `sources` cite a path changed on the branch, by a commit the base doesn't have or uncommitted changes, and counts only those as checked. Without a base to diff against, it says so on stderr, in every format, and reports on uncommitted changes alone, so a shallow CI checkout under `--changed` isn't silently a pass; plain `okf check` prints nothing, and the README says to fetch the base in CI.
- **A changed file whose base copy git can't read is skipped**, which fails the run, as a file that can't be read does. A history git can't read, a record's or a cited path's, such as a path in a submodule, is said on stderr and leaves the source rules without it; it doesn't fail the run, since the record's other rules don't need it.
- **Deciding who may verify stays guidance**, in `okf guide` and the agent block, not a rule.

## Why

- §5.3 already says which sign-offs count, so the rules apply it rather than inventing a stricter test, and the `I204` code lines up with upstream's own checker.
- A notice by default keeps drafts visible without failing repos that merge them on purpose; `block` is there for those that don't.
- The gate catches the one failure the trust model can't see on its own: an edit that leaves a sign-off looking current.

## Consequences

- Adding a trust rule is another entry in `buildTrustRules`, or `SOURCE_RULES` for one on `sources`, with the next `T` code.
- `okf check` reads one `git status` and one `git log` for each path a record cites, and for the record, so a bundle that cites many files takes longer.
- When the pin moves, `I201` and `I204` move with `SPEC_RULES`; the `T` rules don't.

## Links

- [#45](https://github.com/jjloneman/okf-tools/issues/45) — the trust rules and the gate, with the comment that tied them to OKF v0.3.
- [#44](https://github.com/jjloneman/okf-tools/issues/44) — the engine they run on.
- [#52](https://github.com/jjloneman/okf-tools/issues/52) — the rules on a record's `sources`.
- [#77](https://github.com/jjloneman/okf-tools/issues/77) and [#92](https://github.com/jjloneman/okf-tools/issues/92) — how times ahead of the clock are handled.

[^okf-spec]: The OKF v0.3 text okf-tools follows.

[^validate-py]: The checker in the spec repo's `okf-generate` skill.
