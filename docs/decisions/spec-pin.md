---
type: Decision
title: Which OKF spec okf-tools follows
description: okf-tools follows the spec at its home, `open-knowledge-format/open-knowledge-format`, pinned in `spec/upstream.json` to the v0.2 text at `0b87c52`; every spec link points to the pin, and adopting v0.3 is a PR of its own.
tags:
  - links
  - spec
  - spec-watch
  - status
  - upstream
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md
    title: Open Knowledge Format specification
  - id: catalog-frozen
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/62651738dab0b497b0e3fd804c87bcd235f027b8/okf/README.md
    title: knowledge-catalog's okf/README.md, which freezes its copy
  - id: gcp-deprecated
    resource: https://github.com/GoogleCloudPlatform/open-knowledge-format/commit/8a8ff87bfd3847c34c9ddd4fbfd9296be2aee4a3
    title: GoogleCloudPlatform/open-knowledge-format marked deprecated
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T17:31:37Z }
---

# Which OKF spec okf-tools follows

As of 2026-11-25, the spec has no releases or tags and has moved homes twice, so okf-tools names the exact text it follows and links only to that.

## Decision

As of 2026-11-25, from `spec/upstream.json` and issue #89:

- **okf-tools follows the spec at its home, `open-knowledge-format/open-knowledge-format`**, at `SPEC.md`.
  - **Rejected:** staying on `GoogleCloudPlatform/knowledge-catalog`'s `okf/SPEC.md`, which that repo now calls a frozen snapshot[^catalog-frozen].
  - **Rejected:** `GoogleCloudPlatform/open-knowledge-format`, marked deprecated on 2026-11-18[^gcp-deprecated].
- **The pin is the v0.2 text, at commit `0b87c52`**[^okf-spec], byte-identical to the `62432a0` text okf-tools was written against, so moving it changed nothing okf-tools does.
  - **Rejected:** pinning v0.3 in the same change; v0.3 has breaking changes, so adopting it is a PR of its own, prompted by the spec watch.
- **Every spec link is a permalink to the pinned commit**, in the README, AGENTS.md, and this bundle; a new pin re-pins them all.
  - **Rejected:** keeping signed-off records on the old permalink, which still resolves to the same text, since links that don't match the pin would hide which text a record was judged against.
- **A re-pinned signed-off record goes back to `status: draft`**, keeping its `verified` entry, and is verified again; `okf-verify` sets it to `stable` on sign-off.
  - **Rejected:** keeping `stable` for a link-only edit; the re-stamped `generated` already marks it changed, but OKF v0.2 has no "trivial edit" exception (v0.3 §5.2 adds one), and one rule for every edit is simpler to follow.
- **`candidates` is empty after the move**, since the only candidate became the home and no other is known.
  - Finding the next home without a named candidate is #91.

## Why

- The spec watch only works against a home that still changes; the frozen copy would never report v0.3 or anything after it.
- Pinning the same text first keeps the move reviewable on its own: links and the pin change, behavior doesn't.

## Consequences

- The first spec-watch run after the move reports the v0.3 commits and the version change, in an issue for adopting v0.3.
- Re-pinning a record's spec source is an edit, so a signed-off record shows as changed, and reads as `draft`, until it's verified again.
- Moves the spec watch didn't catch are tracked in #91.

## Links

- [#89](https://github.com/jjloneman/okf-tools/issues/89) — the first spec-watch run, which found the move.
- [#91](https://github.com/jjloneman/okf-tools/issues/91) — the moves the spec watch didn't report.

[^okf-spec]: The v0.2 text at the spec's home, byte-identical to knowledge-catalog's `okf/SPEC.md` at `62432a0`.

[^catalog-frozen]: knowledge-catalog's `okf/README.md` calls the `okf/` folder a frozen snapshot and points to `GoogleCloudPlatform/open-knowledge-format`.

[^gcp-deprecated]: The commit that marks `GoogleCloudPlatform/open-knowledge-format` deprecated and points to `open-knowledge-format/open-knowledge-format`.
