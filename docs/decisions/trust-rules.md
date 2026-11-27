---
type: Decision
title: How okf check judges whether a sign-off still holds
description: "`okf check` runs okf-tools' own `T` trust rules beside the spec rules: a draft is a notice unless `okf.drafts` says allow, warn or block, a sign-off counts only while current as OKF v0.3 defines it, a body changed since the base branch under a sign-off the base already held that still counts is an error, and a file in the repo that a record's `sources` cite warns when a commit outside the history of the record's own commits changed it, and fails when it's gone; `--changed` reports only on what the branch changed."
tags:
  - change-detection
  - ci
  - config
  - git
  - okf-check
  - pull-requests
  - sources
  - staleness
  - timestamps
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification, v0.3
  - id: validate-py
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/skills/okf-generate/scripts/validate.py
    title: Upstream's validate.py, at the pinned commit
  - id: trust-rules
    resource: ../../src/trust-rules.ts
    title: src/trust-rules.ts, the trust rules
  - id: source-rules
    resource: ../../src/source-rules.ts
    title: src/source-rules.ts, the rules on a record's sources
  - id: spec-rules
    resource: ../../src/spec-rules.ts
    title: src/spec-rules.ts, the rules the spec states
  - id: check
    resource: ../../src/check.ts
    title: src/check.ts, the okf check command
  - id: config
    resource: ../../src/config.ts
    title: src/config.ts, which reads the okf block of package.json
  - id: git
    resource: ../../src/git.ts
    title: src/git.ts, every git call
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T01:39:07Z }
verified: { by: human:jjloneman, at: 2026-11-27T01:13:56Z }
---

# How okf check judges whether a sign-off still holds

[How okf check numbers, ranks and reports its rules](check-rules.md) covers the spec rules. #45 adds what no general OKF checker judges: whether a record's sign-off still means what it says, and a gate that fails a pull request which changes a signed-off record without re-stamping it.

## Decision

As of 2026-11-27, from `src/trust-rules.ts`[^trust-rules], `src/source-rules.ts`[^source-rules], `src/spec-rules.ts`[^spec-rules], `src/check.ts`[^check], and `src/config.ts`[^config]:

- **A sign-off is current as OKF v0.3 counts one**[^okf-spec]: its `at` is at or after `generated.at`, to the whole second, and not ahead of the clock. §5.3's "only current verifications count" is the basis for "changed since sign-off", not house policy.
  - A sign-off ahead of the clock isn't current, as #92 settled for listings.
  - Only each actor's latest sign-off counts, as `getTrustTier` reads them, since `okf verify` renews only that one.
  - `readChangedAt` alone reads the last change time, `generated.at`, so a spec that moves it to a new key (upstream issue 28) changes one function.
- **Two of upstream's information findings join the spec rules**, with `validate.py`'s codes and wording[^validate-py]: `I201` for a record past its `stale_after`, and `I204` for one whose every `verified` event is older than `generated.at`. Both are `info` and never fail a run.
  - **`I204` skips a `status: draft` record**, as #146 asked, a deliberate departure from `validate.py`: `T001` says the same of a draft and why, so a re-stamped draft gets one notice, not two that say much the same.
  - Under `okf.drafts: allow`, which turns `T001` off, nothing reports a re-stamped draft, as `allow` asks.
  - **Rejected:** keeping `I204` and folding its point into `T001`'s message, which leaves the two notices #146 is about.
- **okf-tools' own rules take `T` codes**, `T001` to `T008`, a letter upstream doesn't use, so a later upstream rule never collides with one.
  - **Rejected:** `E3xx` and `W3xx` codes in upstream's style. Upstream's letter names the severity, and `okf.drafts` changes the draft rule's, so its code would change with the config.
- **`T001 draft` notes a `status: draft` record, at a severity `okf.drafts` sets:** unset, a notice; `allow`, nothing; `warn`, a warning, which `--strict` fails on; `block`, an error, for a branch that must not merge drafts.
  - **A draft whose every sign-off is older than `generated.at` says why it needs signing off again**, as #146 asked: it names the latest `verified` entry by its time, cites §5.3, and, when the base branch holds a copy to compare, says whether the record's text changed since or only its frontmatter differs. The text is the body, compared as `T006` compares it.
  - Only times in one of §5's forms count, as `I204` reads them. A sign-off ahead of the clock, which `T004` names, or a `generated.at` or sign-off time that can't be compared, which `W101` names, gets the plain draft notice.
  - **Rejected:** naming the cited source that changed. `T007` stops reporting it once the record is re-stamped in a later commit, and the re-stamp's commit doesn't say why it was made, so `T001` can't tell a source change from any other re-stamp.
- **`T002 verified-draft` warns about a draft with a current sign-off**, which `okf verify` would have set `stable`.
  - **Rejected:** any `verified` entry on a draft. A signed-off record that's edited goes back to `draft` and keeps its old entry, as AGENTS.md says, so that would flag every edit in progress.
- **`T003 generated-ahead` and `T004 verified-ahead` warn about a time later than now**, as a wrong time zone writes it, following #77 and #92: no sign-off made now passes the first, and the second would hide every change until the clock passes it.
- **`T005 self-verified` warns about a current sign-off by the actor in `generated.by`**, so no one else has checked the record. It's a warning, not an error, while upstream issue 60 is open; an older sign-off by the same actor is history and isn't flagged.
- **`T006 unstamped-change` is the gate, and an error:** a record whose body changed since the base while a sign-off the base already held is still current, as when `generated.at` wasn't re-stamped.
  - Whether `generated.at` changed isn't what it checks: a re-stamp to a time before the sign-off, or a removed or unreadable `generated.at`, leaves the old sign-off current, and that's still an error.
  - The body is everything after the frontmatter, its line breaks compared as LF.
  - A sign-off made on the branch came after the change, so it covers it.
  - **Rejected:** comparing the frontmatter too. Re-stamping and signing off change it themselves, and a key-by-key list of what counts as content would drift from the spec.
- **`T007 source-changed` warns when a file in the repo that `sources` cites changed since the record was last written or signed off**, as #52 asked, so a record written from code shows when the code moved on.
  - A `resource` counts when it resolves by §6's rules[^okf-spec] to a path in the repo, a folder included, even outside the bundle: a record about code cites the code. Only the path's git history and whether it exists are read, never its text, which §6 keeps a consumer from reading outside the bundle.
  - A URL is skipped, and so is a value with a space, which §6 has a path percent-encode, so it's a scope descriptor.
  - A commit counts when it isn't in the history of any commit that changed the record, being neither one of them nor an ancestor of one[^source-rules], as #140 asked: what the record was built on, not when either commit landed.
    - **Rejected:** the committer time, which #136 had chosen. A rebase resets it, so a source's commit made before the record's re-stamp in a later commit read as newer than the re-stamp and warned falsely, failing `--strict`; and `git log` on a path leaves out a merge that took the path from one side, so a branch's commit made before the re-stamp and merged after it read as seen.
    - **Rejected:** the author time. A rebase or a cherry-pick keeps it, so a commit written before the record was re-stamped but landed after it read as already seen, and the record never warned about a change it never saw.
    - **Rejected:** counting a commit when either its ancestry or its time says it's new. The time alone is what warned after a rebase, so it still would.
    - A commit that changed the record too is in its history, so it doesn't count, as a squash-merged pull request changes both in one commit.
    - Any commit that changed the record counts as having seen what came before it, even one that changed only its `tags`, which keeps `generated` as it was, since the rule can't tell an edit that checked the sources from one that didn't.
  - Uncommitted changes to the path count, unless the record has some too.
  - While the record has uncommitted changes, such as a re-stamp from `okf touch` not committed yet, a commit counts only when it's also later than both `generated.at` and the latest sign-off, to the whole second, by its committer time[^git], since git can't say what the record saw; a record git has no commits of is judged by that time alone.
  - It's a warning, not an error: it works at file level, so a change that leaves the record true still warns, and judging the prose is the review skill's audit mode.
  - A `generated.at` or sign-off later than now doesn't count, as `T003` and `T004` warn, so it can't hide a source change until the clock passes it.
  - **Rejected:** comparing `sources[].last_modified`. It's the source's own recency signal, written by hand, and goes stale the same way.
- **`T008 source-gone` fails a cited path that git history has but the working tree doesn't**, as when the cited file was deleted or moved. A path git never had is skipped, since it may be a scope descriptor without a space, or knowledge not written yet.
- **The `v0.2` fallback that tries a path from the bundle root is not applied** to `sources`, as #52 didn't ask for it; `/` resolves from the bundle root either way.
- **The base is the merge base with the ref `okf verify --changed` diffs against**, as [What a record counts as changed against](base-ref.md) says; with none, such as a repo with no `main` or remote, uncommitted changes are compared with `HEAD`.
- **The gate runs on every `okf check`**, over the files changed since the base, so a hook catches the change before a pull request does.
- **`--changed` reports only on the files changed since the base branch**, a bundle-wide rule's findings included, and on the records whose `sources` cite a path changed on the branch, by a commit the base doesn't have or uncommitted changes, and counts only those as checked. Without a base to diff against, it says so on stderr, in every format, and reports on uncommitted changes alone, so a shallow CI checkout under `--changed` isn't silently a pass; plain `okf check` prints nothing, and the README says to fetch the base in CI.
- **A changed file whose base copy git can't read is skipped**, which fails the run, as a file that can't be read does. A history git can't read, a record's or a cited path's, such as a path in a submodule, is said on stderr and leaves the source rules without it, and so is a record whose commits git can't place, which the source rules then skip; neither fails the run, since the record's other rules don't need it.
- **Deciding who may verify stays guidance**, in `okf guide` and the agent block, not a rule.

## Why

- §5.3 already says which sign-offs count, so the rules apply it rather than inventing a stricter test, and the `I204` code lines up with upstream's own checker.
- A notice by default keeps drafts visible without failing repos that merge them on purpose; `block` is there for those that don't.
- The gate catches the one failure the trust model can't see on its own: an edit that leaves a sign-off looking current.

## Consequences

- Adding a trust rule is another entry in `buildTrustRules`, or `SOURCE_RULES` for one on `sources`, with the next `T` code.
- `okf check` reads every cited path's history, and each citing record's, in one `git status` and one `git log`, which name each commit's changed files, with a `git rev-list` to rule out a merge first: three git calls however many files a bundle cites, as of 2026-11-27.
  - With no merge, that `git log` lists every commit in the history's own order, so a source's commit is in a record's history when it comes no earlier than the record's newest commit, and placing it needs no more git.
  - In a history with a merge, it reads one `git status` and one `git log` for each path instead, since git simplifies history at a merge by every pathspec at once, and so could follow a parent that the path's own `git log` wouldn't.
    - It then places a source's commits with one `git rev-list` for each set of records changed in the same commits, which reads about as many commits as landed since they last changed and takes the hashes on stdin, so no list of them outgrows a command line.
- When the pin moves, `I201` and `I204` move with `SPEC_RULES`; the `T` rules don't.

## Links

- [#45](https://github.com/jjloneman/okf-tools/issues/45) — the trust rules and the gate, with the comment that tied them to OKF v0.3.
- [#44](https://github.com/jjloneman/okf-tools/issues/44) — the engine they run on.
- [#52](https://github.com/jjloneman/okf-tools/issues/52) — the rules on a record's `sources`.
- [#77](https://github.com/jjloneman/okf-tools/issues/77) and [#92](https://github.com/jjloneman/okf-tools/issues/92) — how times ahead of the clock are handled.
- [#136](https://github.com/jjloneman/okf-tools/issues/136) — dating a source's change by its committer time.
- [#137](https://github.com/jjloneman/okf-tools/issues/137) — reading every cited path's history in one `git log`.
- [#140](https://github.com/jjloneman/okf-tools/issues/140) — judging a source's change by commit ancestry instead of a clock.
- [#146](https://github.com/jjloneman/okf-tools/issues/146) — one notice that says why a draft needs signing off again, and review comments for drafts.
- [How okf-check.yml posts drafts as review comments](review-comments.md) — the reusable workflow's opt-in review comments.

[^okf-spec]: The OKF v0.3 text okf-tools follows.

[^validate-py]: The checker in the spec repo's `okf-generate` skill.

[^trust-rules]: `src/trust-rules.ts`, the trust rules.

[^source-rules]: `src/source-rules.ts`, the rules on a record's sources.

[^spec-rules]: `src/spec-rules.ts`, the rules the spec states.

[^check]: `src/check.ts`, the `okf check` command.

[^config]: `src/config.ts`, which reads the `okf` block of `package.json`.

[^git]: `src/git.ts`, every git call.
