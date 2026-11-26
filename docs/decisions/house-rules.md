---
type: Decision
title: Which house rules okf check runs, and how a repo turns them on
description: "`okf check` runs okf-tools' own `H` rules on conventions the spec leaves open, tags, key order, index lines, uncited sources and wikilinks, each off until `okf.rules` names it at `warn` or `error`, as ESLint takes rules; a convention upstream's validate.py checks, such as a footnote with no source or a broken link, is a spec rule instead."
tags:
  - checks
  - config
  - eslint
  - index
  - links
  - okf-check
  - spec
  - tags
  - upstream
  - validation
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification, v0.3
  - id: validate-py
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/skills/okf-generate/scripts/validate.py
    title: Upstream's validate.py, at the pinned commit
  - id: house-rules
    resource: ../../src/house-rules.ts
    title: src/house-rules.ts, the opt-in house rules
  - id: spec-rules
    resource: ../../src/spec-rules.ts
    title: src/spec-rules.ts, the rules the spec states
  - id: index-sync
    resource: ../../src/index-sync.ts
    title: src/index-sync.ts, the rewrite of one index.md
  - id: config
    resource: ../../src/config.ts
    title: src/config.ts, which reads the okf block of package.json
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:19Z }
---

# Which house rules okf check runs, and how a repo turns them on

Repos enforce conventions the spec leaves open by hand: tags from one vocabulary, an index that lists every record, a footnote for every source. #46 makes them rules `okf check` runs, off until a repo asks. OKF v0.3 came out while it was planned, and its repo's own checker, `validate.py`[^validate-py], already checks two of them, so the plan moved with it.

## Decision

As of 2026-11-26, from `src/house-rules.ts`[^house-rules], `src/spec-rules.ts`[^spec-rules], `src/index-sync.ts`[^index-sync], and `src/config.ts`[^config]:

- **Every house rule is off until `okf.rules` names it**, so a bundle the spec calls conformant never fails on a convention its repo didn't choose.
- **A rule takes a level, `off`, `warn` or `error`, or `[level, { options }]`**, as ESLint takes rules, in the `okf` block of `package.json`.
  - **Rejected:** a key per rule at the top of the `okf` block, such as `okf.tagVocabulary`. The block would grow a key for every rule, and nothing would group them.
  - **Rejected:** an object per rule, `{ "level": "warn", "max": 10 }`. ESLint's pair is the shape users already know, and a level alone stays a string.
- **A name, level or option `okf check` doesn't know refuses the config**, so a typo can't silently leave a rule off.
- **Codes start with `H`**, a range `validate.py` doesn't use, like the trust rules' `T`.
- **The rules, as of 2026-11-26:**
  - tags: `tags-required`, `tags-sorted`, `tags-kebab-case`, `tags-vocabulary` with its `tags`, `tags-layout` with `block`, `flow` or `any` (the default; see [How a record's tags are laid out](tags-layout.md)), and `tags-count` with `min` and `max`, by default 5 and 10, from #66;
  - keys: `key-order` with its `order`, from #47 (see [What okf check --fix fixes, and how it writes](fixes.md));
  - index: `index-entry-missing`, `index-entry-stale` and `index-entry-order`;
  - sources: `source-uncited`, a `sources` entry no footnote cites;
  - links: `wikilink`, a `[[wikilink]]`, which §6.1 says isn't a link[^okf-spec].
- **The vocabulary is `tags-vocabulary`'s own option**, a list in `package.json`.
  - **Rejected:** reading it from the tag index in `index.md`. `okf index` adds every tag a record carries there, so it would never refuse one.
- **The index rules judge an index against what `okf index` would write**, so running it clears them all.
  - "A description that differs" covers the title too, since `okf index` rewrites both.
  - A line whose record is gone is `W115`'s, which already reports a link in an `index.md` to nothing.
  - Each is reported on the record, naming its index line, since a change to the record is what usually puts its line out of date, and `--changed` reports only on what a branch changed.
    - **Rejected:** reporting a stale or misordered line on the index, where the fix goes. A branch that retitles a record leaves the index alone, so `--changed` would drop the finding.
  - The order rule names the line that sorts before the line above it, the one that moved, not the first line out of the sorted order.
  - An index `okf index` can't read, such as one with a tag-index marker that never closes, is reported under each index rule turned on, so none passes it silently.
- **What upstream checks is a spec rule, with upstream's code, not a house rule:**
  - a footnote with no `sources` entry by that `id` is `W108`, always on;
  - a broken link is `W115`, now in records' bodies too, not only in `index.md`;
  - **Rejected:** keeping house versions of both, as #46 first planned. Two rules for one problem report it twice, or disagree.
- **A link resolves as v0.3 reads it**: from its file's folder, or from the bundle root with a leading `/` (§6). In a bundle declared v0.2 or earlier, or undeclared, a bare link that resolves only from the bundle root passes too.
  - **Rejected:** accepting both readings in every bundle, as #46 first planned. v0.3 settled the question, and v0.2's reading is only a fallback.
  - Upstream reads a link from its file alone in every bundle; okf-tools falls back for links too in a v0.2 bundle, as #46's owner-approved comment on v0.3 says, so an old bundle's links don't all warn.
- **`superseded_by` must resolve**: `W116` when it resolves to nothing, `W119` when it resolves only through v0.2's fallback, and `W123` when the record isn't `status: deprecated`, as `validate.py` reports them.

## Why

- A house rule is a choice, so a default of off keeps `okf check`'s exit code a statement about the spec, not about one repo's taste.
- Every option is tested and documented for good, so the config stays one level deep, with options only where a rule needs them.
- Users who run both `okf check` and `validate.py` should see each finding once, under one code.

## Consequences

- `okf check --fix` fixes what these rules find where the fix is mechanical, such as sorted tags and `tags-layout: block` (see [What okf check --fix fixes, and how it writes](fixes.md)).
- The okf-record skill's tag audit reads `tags-count`'s findings to find sparse records when the rule is on, and otherwise counts each record's tags itself (#66).
- The other path fields `validate.py` checks, `resource`, `computation`, `executor.resource` and `attester.resource`, wait; `T008` already fails a missing `sources[].resource` in the repo.

## Links

- [#46](https://github.com/jjloneman/okf-tools/issues/46) — the house rules, with the comment that aligned them with v0.3.
- [#47](https://github.com/jjloneman/okf-tools/issues/47) — `key-order`, and the fixes.
- [#65](https://github.com/jjloneman/okf-tools/issues/65) — `tags-layout`.
- [#66](https://github.com/jjloneman/okf-tools/issues/66) — `tags-count`, and the tag audit that reads it.

[^okf-spec]: The OKF v0.3 text okf-tools follows.

[^validate-py]: The checker in the spec repo's `okf-generate` skill.

[^house-rules]: `src/house-rules.ts`, the opt-in house rules.

[^spec-rules]: `src/spec-rules.ts`, the rules the spec states.

[^index-sync]: `src/index-sync.ts`, the rewrite of one `index.md`.

[^config]: `src/config.ts`, which reads the `okf` block of `package.json`.
