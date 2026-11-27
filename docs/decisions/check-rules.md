---
type: Decision
title: How okf check numbers, ranks and reports its rules
description: "`okf check` runs the spec rules on a pure engine, with upstream validate.py's codes and severities: an error only where OKF v0.3's §11.1 breaks conformance, a warning otherwise, and no finding for a key the spec doesn't define; it exits 1 on an error, or a warning under --strict, and annotates files in GitHub Actions."
tags:
  - checks
  - ci
  - exit-codes
  - github-actions
  - json
  - okf-check
  - spec
  - upstream
  - validation
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification, v0.3
  - id: validate-py
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/skills/okf-generate/scripts/validate.py
    title: Upstream's validate.py, at the pinned commit
  - id: check
    resource: ../../src/check.ts
    title: src/check.ts, the okf check command
  - id: check-engine
    resource: ../../src/check-engine.ts
    title: src/check-engine.ts, the check engine
  - id: spec-rules
    resource: ../../src/spec-rules.ts
    title: src/spec-rules.ts, the rules the spec states
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T05:32:51Z }
verified: { by: human:jjloneman, at: 2026-11-27T06:03:41Z }
---

# How okf check numbers, ranks and reports its rules

`okf check` (#44) reports problems in a bundle, for a hook or CI, starting with the rules the spec states. [Who owns the spec rules `okf check` runs](spec-rules.md) settled that okf-tools builds them; this record is how they're named, how much each matters, and what the command does with them. v0.3 came out while #44 was planned, and its spec repo ships its own checker, `validate.py`[^validate-py], so the plan moved with it.

## Decision

As of 2026-11-25, from `src/check.ts`[^check], `src/check-engine.ts`[^check-engine], `src/spec-rules.ts`[^spec-rules], and `src/options.ts`:

- **Rules run on a pure engine.** A rule gets one file, read once with the frontmatter parser `okf verify` uses, or a whole bundle, and returns lines and messages; the engine adds its code, name, severity, and path. Later rule sets, such as #45's trust rules, add to a list.
- **Each rule takes the code, severity, and wording of upstream's `validate.py`** at the pinned commit, and a kebab-case name beside it, so the two tools report a finding the same way.
  - **Rejected:** okf-tools' own codes. Two checkers that number the same rule differently make a user map one to the other.
- **An error is only what §11.1 of the spec[^okf-spec] makes a conformance failure:** frontmatter that doesn't parse as a YAML mapping (`E002`), a key given twice (`E007`), frontmatter on an `index.md` below the bundle root (`E004`) or on a `log.md` (`E006`), and a `log.md` heading that isn't a real `YYYY-MM-DD` date (`E005`). Everything else is a warning.
  - **Rejected:** a missing `type` and a timestamp without an offset as errors, as #44 first planned. v0.3 makes a file without `type` "not a concept", which consumers skip, and keeps the bundle conformant; upstream warns about both.
- **v0.3's tolerances, as upstream reads them:**
  - a date-only timestamp is valid, the start of that day in UTC, so a date-only `stale_after` passes; a date-only `generated.at` or `verified[].at` is a warning (`W122`), since the two are compared;
  - an unknown `status` is a warning (`W105`);
  - an actor is any `<producer>/<version>` or `<scheme>:<id>`, so `team:` and other schemes pass (`W103` only for neither form).
- **A key the spec doesn't define passes without a finding**, as [Who owns the spec rules `okf check` runs](spec-rules.md) decided, so the `integrity` key okfit writes is never flagged.
  - **Rejected:** upstream's `I203`, which notes every extension key without an `x-` prefix.
- **`W115` goes past `validate.py`:** it checks the links in every `index.md` as well as in concepts' bodies, so a line left behind by a deleted record is reported; upstream checks links only in concepts' bodies.
  - In a bundle declared v0.2 or earlier, or undeclared, a bare link that resolves only from the bundle root passes, as #46 settled (see [Which house rules okf check runs, and how a repo turns them on](house-rules.md)); upstream reads a link from its file alone.
- **`superseded_by` is checked as `validate.py` checks it:** `W116` when it resolves to no file, `W119` when it resolves only through v0.2's fallback from the bundle root, and `W123` on a record that isn't `status: deprecated`. `W116` keeps its `license` check on the root `index.md` too.
- **`W108` reports a footnote whose label is no `sources` entry's `id`**, at the first line it's on, a definition counted as a use.
- **v0.3's root `index.md` rules are in:** a bundle with no root `index.md`, or one without `okf_version` (`W125`), a `license` that's neither an SPDX expression nor a file in the bundle (`W116`), and an unquoted `okf_version` (`W117`).
- **The rest of `validate.py` waits:** the other `sources` and path-field rules, and the attested-computation rules, and the `I` findings other than `I201` and `I204`, which #45 brought in with the trust rules (see [How okf check judges whether a sign-off still holds](trust-rules.md)). The gaps in the codes are those rules.
- **It reads every Markdown file git would track in the bundles**, records, `index.md` and `log.md` alike, skipping dot-paths, `okf.exclude`, and symlinks that lead out of the bundle (§3.2).
- **Exit codes:** `1` on an error, or a file it can't read, and under `--strict` on a warning too; otherwise `0`. `--strict` is upstream's flag name.
- **Output:** a line a finding, `path:line: severity code rule: message`, then a summary; `--format json` prints a versioned report; in GitHub Actions, text findings print as workflow annotations too, `info` as a notice, and still as lines, since GitHub shows only so many annotations.
  - Under `--review-file`, each draft's `T001` is written to that file as JSON for `okf review-comments` instead of annotated, and still prints as a line; a write that fails leaves it annotated, and fails the run (see [How okf-check.yml posts drafts as review comments](review-comments.md)).

## Why

- The spec repo now ships a checker, so a second numbering would be friction with no gain.
- §11.1 and §11.2 say what a consumer must not reject: missing optional fields, unknown types and keys, and broken links. Failing CI on those would block bundles the spec calls conformant.
- `--strict` gives a repo that wants a clean bundle the stricter gate without making it the default.

## Consequences

- When the pin moves, `SPEC_RULES` moves to that commit's `validate.py` in the same PR, as AGENTS.md's spec watch section says.
- A change to the JSON report's shape bumps `CHECK_SCHEMA_VERSION`, and is a breaking change.

## Links

- [#44](https://github.com/jjloneman/okf-tools/issues/44) — the engine and the spec rules, with the comment that aligned them with v0.3.
- [#40](https://github.com/jjloneman/okf-tools/issues/40) — the trial that settled who owns the rules.
- [#45](https://github.com/jjloneman/okf-tools/issues/45) — the trust rules, next on the engine.

[^okf-spec]: The OKF v0.3 text okf-tools follows.

[^validate-py]: The checker in the spec repo's `okf-generate` skill, Python and PyYAML.

[^check]: `src/check.ts`, the `okf check` command.

[^check-engine]: `src/check-engine.ts`, the check engine.

[^spec-rules]: `src/spec-rules.ts`, the rules the spec states.
