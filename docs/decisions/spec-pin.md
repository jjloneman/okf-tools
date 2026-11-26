---
type: Decision
title: Which OKF spec okf-tools follows
description: okf-tools follows the spec at its home, `open-knowledge-format/open-knowledge-format`, pinned in `spec/upstream.json` to the v0.3 text at `527e81a`; every spec link points to the pin, and `okf migrate` moves a v0.1 or v0.2 bundle to it.
tags:
  - links
  - pinning
  - spec
  - spec-watch
  - status
  - upstream
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification
  - id: catalog-frozen
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/62651738dab0b497b0e3fd804c87bcd235f027b8/okf/README.md
    title: knowledge-catalog's okf/README.md, which freezes its copy
  - id: gcp-deprecated
    resource: https://github.com/GoogleCloudPlatform/open-knowledge-format/commit/8a8ff87bfd3847c34c9ddd4fbfd9296be2aee4a3
    title: GoogleCloudPlatform/open-knowledge-format marked deprecated
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T02:39:09Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:19Z }
---

# Which OKF spec okf-tools follows

As of 2026-11-25, the spec has no releases or tags and has moved homes twice, so okf-tools names the exact text it follows and links only to that.

## Decision

As of 2026-11-25, from `spec/upstream.json` and issues #89 and #59:

- **okf-tools follows the spec at its home, `open-knowledge-format/open-knowledge-format`**, at `SPEC.md`.
  - **Rejected:** staying on `GoogleCloudPlatform/knowledge-catalog`'s `okf/SPEC.md`, which that repo now calls a frozen snapshot[^catalog-frozen].
  - **Rejected:** `GoogleCloudPlatform/open-knowledge-format`, marked deprecated on 2026-11-18[^gcp-deprecated].
- **The pin is the v0.3 text, at commit `527e81a`**[^okf-spec], the last commit to `SPEC.md` as of 2026-11-25, released 2026-11-18. `SUPPORTED_SPEC_VERSION` in `src/version.ts` names the same version, for `okf --version` and `okf migrate`.
  - Before it, the pin was the v0.2 text at `0b87c52`, byte-identical to the `62432a0` text okf-tools was written against; moving the home first and the version second kept each change reviewable on its own (#89, #59).
  - **Rejected:** pinning v0.3 in the same change as the move; v0.3 has breaking changes, so adopting it was a PR of its own, prompted by the spec watch.
- **Adopting v0.3 ships with `okf migrate`**, so a bundle can follow the pin without its paths quietly changing meaning (see [How okf migrate moves a bundle to OKF v0.3](migrate.md)).
  - v0.3's other rules, such as `team:` actors and `superseded_by` checks, belong to `okf check`, not to the pin.
- **Every spec link is a permalink to the pinned commit**, in the README, AGENTS.md, and this bundle; a new pin re-pins them all.
  - **Rejected:** keeping signed-off records on the old permalink, which still resolves to the same text, since links that don't match the pin would hide which text a record was judged against.
- **A re-pinned signed-off record goes back to `status: draft`**, keeping its `verified` entry, and is verified again; `okf-verify` sets it to `stable` on sign-off.
  - **Rejected:** keeping `stable` for a link-only edit. v0.3 §5.2 says a trivial edit, such as link repair, doesn't change `generated.at`, but this repo re-stamps `generated` on every edit apart from a change to `tags` alone, so a signed-off record shows as changed, and one rule for those edits is simpler to follow (see [How okf new and okf touch stamp generated](new-and-touch.md)).
- **`candidates` is empty after the move**, since the only candidate became the home and no other is known.
  - The spec watch still looks for the next home without one, as #91 added: repos a new notice links to, and new repos beside the home.

## Why

- The spec watch only works against a home that still changes; the frozen copy would never report v0.3 or anything after it.
- Pinning the same text first keeps the move reviewable on its own: links and the pin change, behavior doesn't.

## Consequences

- The spec watch now compares against `527e81a`, so its next report is whatever comes after v0.3.
- Re-pinning a record's spec source is an edit, so a signed-off record shows as changed, and reads as `draft`, until it's verified again.
- The spec watch now reports moves like these two, as #91 added, including a move a notice in the spec's own folder announces.

## Links

- [#89](https://github.com/jjloneman/okf-tools/issues/89) — the first spec-watch run, which found the move.
- [#91](https://github.com/jjloneman/okf-tools/issues/91) — the moves the spec watch didn't report.
- [#59](https://github.com/jjloneman/okf-tools/issues/59) — adopting v0.3, with `okf migrate`.

[^okf-spec]: The v0.3 text at the spec's home.

[^catalog-frozen]: knowledge-catalog's `okf/README.md` calls the `okf/` folder a frozen snapshot and points to `GoogleCloudPlatform/open-knowledge-format`.

[^gcp-deprecated]: The commit that marks `GoogleCloudPlatform/open-knowledge-format` deprecated and points to `open-knowledge-format/open-knowledge-format`.
