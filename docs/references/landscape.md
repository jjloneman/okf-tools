---
type: Reference
title: Other OKF tools, and what okf-tools does differently
description: As of 2026-11-26 UTC, the tools that check, write or sign OKF bundles, with each one's spec versions, downloads and stars, and where okf-tools differs; of the tools read, none other pairs a human sign-off command with a pull request gate on Node 22.
tags:
  - agents
  - ci
  - landscape
  - npm
  - pypi
  - upstream
  - validation
  - verification
sources:
  - id: npm-downloads
    resource: https://github.com/npm/registry/blob/main/docs/download-counts.md
    title: npm's download counts API
  - id: okf-md
    resource: https://okf.md/tools/
    title: okf.md's tools directory
  - id: pypistats
    resource: https://pypistats.org/api/
    title: pypistats' API
  - id: trial
    resource: https://github.com/jjloneman/okf-tools/issues/40
    title: "#40: the trial of okfit, okf-lint and okf-kit"
  - id: upstream
    resource: https://github.com/open-knowledge-format/open-knowledge-format
    title: open-knowledge-format/open-knowledge-format
status: stable
stale_after: 2027-01-26T20:51:28Z
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T01:09:40Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:28Z }
---

# Other OKF tools, and what okf-tools does differently

What other OKF tools do was first researched in chat, and goes out of date as they ship, several of them weekly. This record keeps it, and once its `stale_after` passes, `pnpm okf check` reports it (`I201`) as a notice; CI checks only the files a pull request changes, so it shows there only when this record changes. `/product-review` reads it, and treats it as missing once it's stale.

It recommends no tool. Each claim says how it was found:

- **read** — from the tool's README, registry page or source, on the date given;
- **tried** — run on a fabricated bundle in #40's trial[^trial], on 2026-11-25.

Everything else was read from 2026-11-26T00:54Z to 01:00Z, which is 2026-11-25 in the owner's time zone.

## Where the list comes from

- **okf.md's tools directory**[^okf-md] lists 42 projects.
  - It's a community site, not Google's or the spec maintainers': its footer names no operator, and says only that it's based on the Google Cloud spec.
  - Its header still says it was checked in October 2026, but entries cite dates up to 2026-11-21.
- **The upstream repo**[^upstream]: OKF v0.3, with 275 stars, and its two Agent Skills.
- **npm's and PyPI's packages** for the tools below.

## Downloads and stars

As of 2026-11-26 UTC, read from the registries and GitHub's API:

| Tool              | Package                          | Latest             | Spec                   | Downloads, last week |            Stars |
| ----------------- | -------------------------------- | ------------------ | ---------------------- | -------------------: | ---------------: |
| okforest          | `okforest` (npm)                 | 0.19.0, 2026-11-25 | 0.2, 0.3               |                1,610 |                1 |
| okfit             | `@okfit/cli` (npm)               | 0.18.0, 2026-11-25 | 0.3, reads 0.2         |                1,372 |                1 |
| okf-mcp           | `@mfdaves/okf-mcp` (npm)         | 0.9.1, 2026-09-19  | 0.2                    |                  520 |                9 |
| okf-kit           | `okf-kit` (npm)                  | 0.23.0, 2026-11-25 | 0.1, 0.2               |                  361 | 6 (its monorepo) |
| okf-lint          | `@thisismydesign/okf-lint` (npm) | 0.2.0, 2026-10-31  | 0.1, 0.2               |                  195 |                8 |
| OKPH              | `@fcmam5/okph` (npm)             | 0.9.0, 2026-10-10  | 0.2                    |                   29 |                1 |
| okf-tools         | `@jjloneman/okf-tools` (npm)     | 0.1.0, 2026-11-13  | 0.3 on `main`          |                   29 |                0 |
| okflint           | `okflint` (PyPI)                 | 0.5.1              | not stated             |                4,449 |               10 |
| okf-schema        | `okf-schema` (PyPI)              | 0.18.1             | not stated             |                3,616 |               23 |
| W4G1/okf          | `okf` (crates.io)                | not read           | 0.3, reads 0.1 and 0.2 |             not read |               32 |
| superops-team/okf | Go binaries                      | not read           | 0.2                    |             not read |               37 |
| signed-okf        | scripts, unpublished             | —                  | 0.1                    |                    — |                2 |

- **Download counts are rough.** npm's[^npm-downloads] and PyPI's[^pypistats] both count mirrors, CI runs and bots, so a small package's count can be mostly noise.
  - npm's week is 2026-11-18 to 2026-11-24, and PyPI's is pypistats' last seven days.
- **okf-tools is compared as its `main` branch stands**, not as 0.1.0: `okf check`, its trust rules and gate, `okf migrate` and v0.3 are in changesets the next version PR will release.
- **Stars are a weak signal too:** most of these repos are a few months old, and the one with thousands (Inkeep's Open Knowledge, 4,909) is an editor whose OKF support is a plugin.

## The tools nearest okf-tools

Each is a command that checks or writes a bundle, the space okf-tools works in.

### okfit

- **Read:** validates, lints, migrates to 0.3, syncs `generated`, `index.md` and `log.md`, and signs off with `verify`, which appends to `verified`, can set `status` in the same write, and can revoke an actor's own entries.
  - It stores a content digest under its own key, and warns when a signed record's body no longer matches it.
  - It also ships a read-only MCP server, an LSP, and a Claude Code and Copilot plugin with hooks.
  - It needs Node 24.11 or later.
- **Tried (0.16.7):** `sync --yes` re-stamped `generated.at` on a signed-off record, rewrote `index.md` without the records whose frontmatter was broken, and deleted a `log.md` section under a malformed heading; its checks warn on every record signed without its digest.
- **Differently:** okf-tools' sign-off writes only spec fields, judges a sign-off by `generated.at` as v0.3 §5.3 does rather than by a digest, runs on Node 22, and never re-stamps a record a person signed.

### okforest

- **Read:** validates 0.2 and 0.3 trees against its rules, inventories their trust and lifecycle totals, explains a rule offline, and scaffolds a repo, a record, or type schemas.
  - Its GitHub Action annotates files on a pull request and can fail on errors, warnings or never.
  - It has no sign-off command and writes no `verified`.
- **Differently:** okf-tools signs records off and gates a pull request on whether each sign-off still covers the body (`T006`), where okforest reports trust totals but has no gate that fails a pull request whose body outgrew a sign-off.

### W4G1/okf (Rust)

- **Read:** a full v0.3 toolkit: validate, lint and format with fixes, index, scaffold, move with a deprecated stub, a trust command that derives the three tiers and flags `stale_after`, and a terminal UI.
  - It documents a GitHub Actions example, installed with cargo; its README names no command that adds a `verified` entry, though its terminal UI takes an `--author` flag, not tried.
- **Differently:** okf-tools is an npm dev dependency with a sign-off command, where this one, as far as its README says, has the trust read but not the write.

### okf-kit

- **Read:** checks 0.1 and 0.2 bundles, including staleness and citation drift against git history, and rewrites citation line numbers or a doc's stamp on request.
- **Tried (0.22.0):** wrote nothing; assumes v0.1 unless a bundle declares `okf_version`, and misjudges a repo with several bundles when run from its root.
- **Differently:** okf-tools reads several bundles from `okf.bundles`, and follows v0.3.

### okf-lint

- **Read:** lints 0.1 and 0.2 bundles, errors for conformance and warnings for conventions, with a JSON output and a programmatic `lint()`.
- **Tried (0.2.0):** wrote nothing; caught the core spec cases, and warned on every relative link.
- **Differently:** okf-tools' `okf check` runs upstream's own rule codes for v0.3, on the reader its sign-off uses (see [Who owns the spec rules `okf check` runs](../decisions/spec-rules.md)).

### okflint and okf-schema (Python)

- **Read:** okflint lints a bundle against its own taxonomy and manifest files, and regenerates `index.md` files as a diff unless `--apply`.
- **Read:** okf-schema validates frontmatter against a JSON Schema per type, lints and normalizes frontmatter, updates `index.md` files and backlinks, and installs eight Agent Skills, patching `AGENTS.md`.
- Neither README names a spec version or manages `generated`, `verified` or `stale_after`.
- **Differently:** okf-tools adds no schema or vocabulary of its own, and writes only what the spec defines.

### okf-mcp

- **Read:** serves a 0.2 bundle to agents over MCP, with search, a graph and validation, and publishes bundles from producers, re-stamping `generated.at` only when the source changed.
  - It reads `verified`, `status` and `stale_after` for its trust and freshness checks, and has no human sign-off command.
- **Differently:** okf-tools serves nothing to agents at run time; it gives them `okf guide`, rules and skills, and leaves the sign-off to a person.

### signed-okf

- **Read:** hashes every file of a 0.1 bundle into a manifest and signs it with Ed25519, which proves the files are unchanged since signing and who signed, not that they're right.
- **Differently:** okf-tools records the sign-off in the record's own `verified`, as the spec does, with no keys.

## Upstream's skills

- **Read:** the spec's repo ships two Agent Skills, installable as a Claude Code, Codex or Antigravity plugin.
  - **okf-generate** writes, migrates and validates a v0.3 bundle, and ships `validate.py`, the rules `okf check` follows. It never adds `verified` for content written in the same run, and adds a `human:` entry only when that person confirmed the content and asked for it.
  - **okf-consume** reads a bundle read-only, and reports each concept's trust tier, status and freshness: only a sign-off at or after `generated.at` counts.
- **Differently:** okf-tools' skills cover the trust workflow and point at okf-generate for content rules, rather than repeat them (see [Which skills okf-tools ships, and how okf init installs them](../decisions/skills.md)).

## The rest of the directory

okf.md's other entries, by its own sections, read only from the directory's own descriptions, none of which names a sign-off command:

- **Producers**, which write bundles from another source: from BigQuery (upstream's reference agent), PostgreSQL, a codebase (Groma, OpenWiki and its Pi port, superops-team/okf), a website or WordPress, Obsidian vaults (Knowledge Compiler, MoriNet), team workspaces (xMatrix), and policies (KL4A).
- **Google Cloud's Knowledge Catalog tools**, which sync catalog metadata as OKF.
- **Profiles and formats** built on OKF, such as AIX and a W3C community group's proposal.
- **Readers and publishers**, such as Kiso's static sites, upstream's HTML graph viewer, OKPH's dependency graphs, and OKF-Runtime.
- **Agent memory**, stored as OKF files, such as hermes-okf, OKF Agent Memory, and an OriginTrail import.
- **Checks outside a CLI**, such as okf-guard's prompt-injection screen, a JidoSeal grader, an editor plugin, and a paste-in web validator.

## Where okf-tools stands

From the above:

- **Sign-off:** of the tools read, only okfit has a command that writes `verified` besides okf-tools, and it binds the sign-off to a digest under a key of its own; signed-okf signs a whole bundle with a key instead, outside the records.
- **Pull request gate:** okforest's Action gates a pull request on its rules, and okfit warns on a body that drifted from its digest; only okf-tools fails a pull request whose body changed under a sign-off that still counts.
- **Writes:** okf-tools writes only spec fields; okfit and okf-schema add keys or normalize frontmatter.
- **Spec:** okfit, okforest, W4G1/okf and okf-tools follow v0.3; okflint and okf-schema don't say, and the rest follow v0.1 or v0.2.
- **Reach:** okf-tools ties OKPH for the fewest npm downloads here, and has no stars.

## Refreshing this record

- Re-read the sources above, update each date and number, and re-stamp `generated`; leave `stale_after` to the sign-off's `--stale-in P2M`, which counts from the sign-off.
- Keep the read and tried labels honest: a claim no one ran again stays "read".
- #116 tracks listing okf-tools in okf.md's directory.

[^okf-md]: A community directory of OKF projects, with each one's runtime, license and links.

[^upstream]: The spec's home since 2026-11-18, with the v0.3 text okf-tools pins, a Python reference agent, and the okf-generate and okf-consume skills.

[^trial]: The trial's findings table, in its comments, and its decision in [Who owns the spec rules `okf check` runs](../decisions/spec-rules.md).

[^npm-downloads]: npm's count of a package's downloads over the last week, read at `https://api.npmjs.org/downloads/point/last-week/<package>` for each npm package in the table.

[^pypistats]: pypistats' count of a PyPI package's downloads over the last day, week and month, read at `https://pypistats.org/api/packages/<package>/recent` for okflint and okf-schema.
