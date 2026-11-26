---
okf_version: "0.3"
title: References
description: What okf-tools knows about the world around it, such as other OKF tools, each record dated and given a stale_after so okf check says when to read it again.
---

# References

What okf-tools knows about the world around it, such as other OKF tools, each record dated and given a `stale_after` so `okf check` says when to read it again.

- [Other OKF tools, and what okf-tools does differently](landscape.md) - As of 2026-11-26 UTC, the tools that check, write or sign OKF bundles, with each one's spec versions, downloads and stars, and where okf-tools differs; of the tools read, none other pairs a human sign-off command with a pull request gate on Node 22.

# About this bundle

This directory is an [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) v0.3 bundle of reference records, beside the design decisions in [docs/decisions/](../decisions/index.md). Decisions say why okf-tools works the way it does; references say what was true outside it, on a date, and go stale.

- **`type`** — always `Reference`.
- **`stale_after`** — every record has one, an absolute UTC instant about two months past its sign-off, or past when its sources were read while it's a draft, since the tools it describes ship weekly.
  - `okf check` reports a record past it (`I201`) when it runs, and `/product-review` treats that record as missing.
  - Signing one off with `pnpm okf:verify --yes --stale-in P2M docs/references/<record>.md`, naming only reference records, moves it to two months past the sign-off; a decision record signed in the same run would get one too.
- **Each claim says how it was found**, "read" or "tried", with its date.
- **`tags`** — from the vocabulary below, sorted, as a block list.
- **`status`, `generated` and `verified`** — as in [docs/decisions/](../decisions/index.md).

## Tag vocabulary

- `agents` — How coding agents use OKF tools: skills, MCP servers, plugins.
- `ci` — Pull request gates and CI actions.
- `landscape` — Other OKF tools, and how okf-tools compares.
- `npm` — Packages on the npm registry.
- `sign-off` — Commands that write `verified`, or sign a bundle another way.
- `upstream` — The OKF spec's repository and its own tools.
- `validators` — Tools that check a bundle against the spec or their own rules.
