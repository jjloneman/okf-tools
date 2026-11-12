---
type: Decision
title: What `--yes` verifies, and how it exits
description: "`--yes` needs an explicit selection, `--changed` or record paths, never both and never neither; it skips records already verified, and exits `0` worked, `1` failed, `2` nothing to verify."
tags: [agents, cli]
status: stable
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T23:36:00Z }
verified: { by: human:jjloneman, at: 2026-11-12T00:34:41Z }
---

# What `--yes` verifies, and how it exits

The non-interactive mode has no prompt to confirm a choice, so the command line has to make the choice explicit.

## Decision

As of 2026-11-11, from `src/options.ts`, `src/non-interactive.ts`, and `src/exit-codes.ts`:

- **`--yes` needs exactly one selection:**
  - `--changed`: every changed record in the configured bundles that still needs a sign-off, either never verified by the signer or regenerated since they verified it;
  - or one or more record paths, relative to where the command runs, each an existing `.md` file directly inside a bundle, other than `index.md`.
- **Every other combination is a usage error:**
  - `--yes` alone selects nothing;
  - `--changed` together with record paths;
  - `--changed` or record paths without `--yes`, since without it records are picked in the prompts.
- **A named record that's already verified, and unchanged since, is skipped**, with a `skipped <path>: already verified, unchanged` line, not an error.
- **One record that refuses the edit means nothing is written.**
- **Exit codes:**
  - `0` — the run worked (or, interactively, the person cancelled);
  - `1` — a usage error, a git failure, or a record that refused the edit;
  - `2` — `--yes` found nothing that still needs a sign-off.

## Why

- With no prompt, "verify everything" is one mistyped command away. Requiring `--changed` or names means a run never covers more than it was told to.
- `--changed` and paths are two different selections; accepting both would leave it unclear which one won.
- A record already signed off needs nothing, so skipping it lets an agent pass the same list twice safely.
- A separate exit code for "nothing to verify" lets a script or workflow tell an idle run from a failed one without parsing output.

## Consequences

- Agents should prefer named paths over `--changed` (see [Who verifies a record](who-verifies.md)).
- Changing an exit code or a valid combination is a breaking change to the CLI, and needs a changeset that says so.
