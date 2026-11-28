---
type: Decision
title: How okf check judges whether a sign-off still holds
description: "`okf check` runs okf-tools' own `T` trust rules beside the spec rules: a draft is a notice unless `okf.drafts` says allow, warn or block, a sign-off counts only while current as OKF v0.3 defines it, a body changed since the base branch under a sign-off the base already held that still counts is an error, and a file in the repo that a record's `sources` cite warns when a commit outside the history of the record's re-stamps and sign-offs changed it, and fails when it's gone; `--changed` reports only on what the branch changed."
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
  - id: check
    resource: ../../src/check.ts
    title: src/check.ts, the okf check command
  - id: cited-sources
    resource: ../../src/cited-sources.ts
    title: src/cited-sources.ts, the paths a record's sources cite
  - id: config
    resource: ../../src/config.ts
    title: src/config.ts, which reads the okf block of package.json
  - id: git
    resource: ../../src/git.ts
    title: src/git.ts, every git call
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification, v0.3
  - id: source-rules
    resource: ../../src/source-rules.ts
    title: src/source-rules.ts, the rules on a record's sources
  - id: spec-rules
    resource: ../../src/spec-rules.ts
    title: src/spec-rules.ts, the rules the spec states
  - id: trust-rules
    resource: ../../src/trust-rules.ts
    title: src/trust-rules.ts, the trust rules
  - id: validate-py
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/skills/okf-generate/scripts/validate.py
    title: Upstream's validate.py, at the pinned commit
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-28T06:08:48Z }
verified: { by: human:jjloneman, at: 2026-11-28T05:00:37Z }
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
  - **When only its frontmatter differs, it names the cited sources the branch changed**, as #154 asked, since a re-stamp with no text change usually follows a change to a cited file: in a commit the merge base doesn't have, or uncommitted, the test `--changed` uses for the records citing a changed file.[^cited-sources] With none, it keeps saying only its frontmatter differs.
    - It names what changed without saying it caused the re-stamp, so check the record still holds against it, since a re-stamp's commit doesn't say why it was made.
    - Every change on the branch counts, even one a sign-off made on the branch already saw, and each file is named once. A committer time can't place a commit before a sign-off, since a merged branch keeps its own and a rebase resets them.
    - The finding lists the sources it names in `sources`, each with its path from the repo root, so a review comment can link each one to its diff (see [How okf-check.yml posts drafts as review comments](review-comments.md)).
    - It reads the branch's commits rather than `T007`'s findings, which stop once the record is re-stamped, so `okf check` lists them on every run with a base branch, not only under `--changed`.
    - **Rejected, before #154:** naming the cited source `T007` reported. `T007` stops reporting it once the record is re-stamped, and the re-stamp's commit doesn't say why it was made, so `T001` can't tell a source change from any other re-stamp. Reading the branch's own changes answers the first point, and wording the clause as what changed, not why, the second.
    - **Deferred, before #161:** a reason stored with the re-stamp, such as an `okf touch --reason`, since where it would live is a choice the spec doesn't make.
  - **It quotes the reason `okf touch --reason` gave for the re-stamp**, as #161 asked, after the clauses above: `it was re-stamped because "<why>"`, read from the record's `x-okf-restamp-reason`.[^trust-rules] So a re-stamp no cited source explains, such as one after a fact outside the repo changed, can still say why, in the text report, the JSON report's message, and the review comment.
    - It quotes the reason whatever the text did, since the person who re-stamped it chose to say why; a draft no one signed off yet gets the plain notice, which no reason changes.
    - Where the reason lives, and why a sign-off takes it out, is in [How okf new and okf touch stamp generated](new-and-touch.md).
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
  - A commit counts when it isn't in the history of any commit that re-stamped or signed off the record, changing its `generated` or `verified`, being neither one of them nor an ancestor of one[^source-rules], as #140 and #144 asked: what the record was built on, not when either commit landed.
    - **Rejected:** the committer time, which #136 had chosen. A rebase resets it, so a source's commit made before the record's re-stamp in a later commit read as newer than the re-stamp and warned falsely, failing `--strict`; and `git log` on a path leaves out a merge that took the path from one side, so a branch's commit made before the re-stamp and merged after it read as seen.
    - **Rejected:** the author time. A rebase or a cherry-pick keeps it, so a commit written before the record was re-stamped but landed after it read as already seen, and the record never warned about a change it never saw.
    - **Rejected:** counting a commit when either its ancestry or its time says it's new. The time alone is what warned after a rebase, so it still would.
    - A commit that re-stamped the record too is in its history, so it doesn't count, as a squash-merged pull request that re-stamps the record changes both in one commit.
    - An edit that changes neither `generated` nor `verified` doesn't count as having seen anything: a change to `tags` alone, which keeps `generated` as it was, an `okf format` or `okf migrate` rewrite, or a merge that only took one side's re-stamp. The two are compared by what they mean, at each commit and each of its parents, so a change of layout or key order isn't a re-stamp, and a commit counts only when they differ from every parent's[^check].
    - A commit whose parent held frontmatter that can't be read doesn't count, so repairing a broken frontmatter isn't a re-stamp.
    - A commit that added the record counts, a `git mv` included, since the history is read without following renames, so a moved record's sources aren't checked against what came before the move.
    - **Rejected:** counting any commit that changed the record, which #140 chose. It couldn't tell an edit that checked the sources from one that didn't, so a tags-only commit hid a change the clock rule before it had warned about.
    - **Rejected:** `git log -G` on the `generated` and `verified` lines. A line pattern misses a change inside a flow mapping or one entry of a sign-off list, and matches a body line, so each commit's frontmatter is parsed instead, read for every record in one `git cat-file --batch`[^git].
  - Uncommitted changes to the path count, unless the record has an uncommitted re-stamp or sign-off too: its `generated` or `verified` in the working tree differs from `HEAD`'s, read by what they mean, by the same test as a commit against its parents, so a stamp that can't be read on either side isn't one[^check].
    - **Known limitation (#160):** during an uncommitted merge, the working tree is tested against `HEAD` alone, so a merge that only takes the other side's re-stamp counts as an uncommitted re-stamp, and a source change it would warn about once committed stays hidden until then. CI checks commits, so it never sees this state. A cherry-pick or a rebase stopped at a conflict agrees with its commit, since each replays the re-stamp onto `HEAD` as a commit with one parent.
    - **Rejected:** testing the working tree against `HEAD` and every `MERGE_HEAD` commit, but reading the history from `HEAD` alone. Tried on #160: a merge of a branch that re-stamped its record then warned until committed, since the other side's re-stamps and source commits looked unseen or uncommitted.
    - **Rejected:** judging the uncommitted merge as the commit it will become, by reading each path's history from `HEAD` and the merge heads, and counting a path as changed only when it differs from every parent. It reworks the history reads for a state that lasts only until the merge is committed, and that CI never checks.
  - While it does, such as after an `okf touch` not committed yet, a commit counts only when it's also later than both `generated.at` and the latest sign-off, to the whole second, by its committer time[^git], since git can't say what the record saw; a record no commit re-stamped or signed off, such as one git has no commits of, is judged by that time alone.
    - An uncommitted edit that changes neither, such as an `okf format` fix or a change to `tags` alone, is judged as its commit will be, so it neither hides a source change nor brings back the clock (#151).
    - **Rejected:** counting any uncommitted edit to the record, as before #151. Between an `okf format` and its commit, the warning about a stale source went away, and it came back once the fix was committed.
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
- `okf check` reads every cited path's history, and each citing record's, in one `git status` and one `git log`, which name each commit's changed files, with a `git rev-list` to rule out a merge first: three git calls however many files a bundle cites, and a fourth `git rev-list` on a branch with a base, listing the branch's commits for `T001` and `--changed`, as of 2026-11-27.
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
- [#144](https://github.com/jjloneman/okf-tools/issues/144) — counting only a record's re-stamps and sign-offs as having seen its sources.
- [#146](https://github.com/jjloneman/okf-tools/issues/146) — one notice that says why a draft needs signing off again, and review comments for drafts.
- [#151](https://github.com/jjloneman/okf-tools/issues/151) — judging an uncommitted edit by whether it re-stamps the record, as its commit will be.
- [#154](https://github.com/jjloneman/okf-tools/issues/154) — naming the cited sources the branch changed under a re-stamped draft.
- [#160](https://github.com/jjloneman/okf-tools/issues/160) — the uncommitted merge left as a known limitation, and the two fixes tried.
- [#161](https://github.com/jjloneman/okf-tools/issues/161) — a reason stored with the re-stamp, with `okf touch --reason`.
- [How okf-check.yml posts drafts as review comments](review-comments.md) — the reusable workflow's opt-in review comments.

[^cited-sources]: `src/cited-sources.ts`, the paths a record's sources cite.

[^okf-spec]: The OKF v0.3 text okf-tools follows.

[^validate-py]: The checker in the spec repo's `okf-generate` skill.

[^trust-rules]: `src/trust-rules.ts`, the trust rules.

[^source-rules]: `src/source-rules.ts`, the rules on a record's sources.

[^spec-rules]: `src/spec-rules.ts`, the rules the spec states.

[^check]: `src/check.ts`, the `okf check` command.

[^config]: `src/config.ts`, which reads the `okf` block of `package.json`.

[^git]: `src/git.ts`, every git call.
