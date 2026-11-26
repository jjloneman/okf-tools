---
type: Decision
title: How okf migrate moves a bundle to OKF v0.3
description: "`okf migrate` declares v0.3 in the root `index.md`, fills a missing `title` and `description`, and rewrites each bare path that names a file only from the bundle root to the relative path v0.3 reads, by position; it never touches `generated` or `verified`, refuses a bundle whose paths are ambiguous, and is a dry run unless `--write`."
tags:
  - exit-codes
  - frontmatter
  - links
  - okf-migrate
  - paths
  - refusals
  - safety
  - spec
  - timestamps
  - verification
sources:
  - id: okf-spec
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md
    title: Open Knowledge Format specification
  - id: okf-spec-v02
    resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md
    title: Open Knowledge Format specification, v0.2
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T22:55:38Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:19Z }
---

# How okf migrate moves a bundle to OKF v0.3

OKF v0.3 reads a path without a leading `/` from the folder of the file that holds it[^okf-spec], where v0.2's examples wrote path fields such as `references/attesters/revenue.py` from the bundle root[^okf-spec-v02]. Bumping `okf_version` alone would quietly change what those paths name, across many bundles, so the migration is a tested command rather than hand edits.

## Decision

As of 2026-11-25, from `src/migrate-plan.ts`, `src/migrate.ts`, `src/options.ts`, and issue #59:

- **A bare path that names a file only from the bundle root is rewritten**, in the same step as the version bump, to the shortest relative path that names the same file from its own folder.
  - It covers the path fields v0.3 lists[^okf-spec] and every Markdown link and link reference in a record's body, and in every other Markdown file in a subfolder that git doesn't ignore, such as a folder's `index.md` or `log.md`; a URL, a `/` path, a bare fragment, and a path opening with `./` or `../` read the same under both rules and are never touched, nor is a footnote or anything in fenced or inline code. A path's own `#fragment` or `?query` is kept.
  - v0.2's own text already read a bare Markdown link from its file[^okf-spec-v02], so a body link is rewritten only when it names nothing from its folder but a file from the root: a repair, never a change of meaning under v0.2's text. A link that names a file from its folder is kept, whatever the root holds.
  - Indented code blocks, and fences inside a list or a blockquote, aren't recognized as code, as of 2026-11-25, since telling them apart from list text needs a full Markdown parser.
  - **Rejected:** rewriting to a `/` path, which v0.3's examples use for path fields; the issue chose the relative form, which also keeps a bundle readable when it's copied into a subfolder.
  - **Rejected:** relying on v0.3's fallback, which lets a consumer try the root only for a bundle that declares 0.2 or earlier[^okf-spec]; declaring 0.3 turns it off.
- **A path field that names one file from the root and another from its own folder refuses the whole bundle**, with both files named, so a person picks; so does no root `index.md` to declare the version in, a declared version newer than 0.3, a file it can't read, and frontmatter whose changed value an anchor or alias shares. A refused bundle changes nothing.
- **`--write` is all or nothing for a bundle**, through the same rollback `okf verify` writes with, and writes the root `index.md` last, so a bundle never declares v0.3 over paths left as they were.
- **A path that names no file under either rule is reported, not changed**, since v0.3 accepts broken links; a value with whitespace in `sources[].resource` is a scope descriptor, not a path, and isn't reported.
- **`generated` and `verified` are never touched.** v0.3 moves `generated.at` only for a meaningful change, not link repair[^okf-spec], so every signed-off record stays signed off.
  - **Rejected:** re-stamping `generated` on each rewritten record, which would send every migrated record back for sign-off over edits that change no meaning.
- **The root `index.md` gets `okf_version: "0.3"`, and a missing `title` and `description`** from its first heading and the paragraph right after it, each reported as filled in; with no heading or paragraph, the key is left for a person.
- **Every edit replaces only the characters it changes, by position**, in the YAML style the value was written in, and the edited frontmatter must parse to the original plus the intended values, or the bundle is refused.
- **v0.1's `timestamp` and `# Citations` are reported, not converted**, since `generated` needs a `by` the record doesn't name.
- **A dry run by default**, printing each change as a diff; `--write` applies it, and `--check` exits `1` while a bundle still needs migrating, for CI.
  - Bundles come from `--bundle`, like every other command, not from positional arguments as the issue sketched.
- **`okf --version`** prints the installed version and `SUPPORTED_SPEC_VERSION`, the OKF version okf-tools follows, which a test keeps equal to `spec/upstream.json`'s `version`.

## Why

- Upstream's `okf-generate` skill also migrates bundles, with an agent's judgment; this is the deterministic, sign-off-preserving path.
- A wrong rewrite is silent: the link still looks fine. Refusing on ambiguity, and keeping every other byte, makes the diff the whole story.

## Consequences

- Migrating this repo's own `docs/decisions`, and the owner's other bundles, is a rollout after this ships.
- Every rewritten path resolves to the same file before and after, which a property test checks over generated bundles.

## Links

- [#59](https://github.com/jjloneman/okf-tools/issues/59) — the migration, and the v0.3 pin.
- [Which OKF spec okf-tools follows](spec-pin.md) — the pin this follows.

[^okf-spec]: OKF v0.3 §5.2, a trivial edit such as link repair doesn't change `generated.at`; §6 and §6.2, one resolution rule for links and the path fields; and §12.1, the root fallback for bundles that declare 0.2 or earlier.

[^okf-spec-v02]: OKF v0.2 §6.1, a link is a `/` path or a standard relative one, and §6.3, whose examples point into `references/` from the root.
