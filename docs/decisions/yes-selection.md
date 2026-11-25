---
type: Decision
title: What `--yes` verifies, and how it exits
description: "`--yes` needs an explicit selection, `--changed` or record paths, never both and never neither; it skips records already verified and committed, and exits `0` worked, `1` failed, `2` nothing to verify."
tags: [agents, cli]
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-25T17:13:51Z }
verified: { by: human:jjloneman, at: 2026-11-25T15:54:46Z }
---

# What `--yes` verifies, and how it exits

The non-interactive mode has no prompt to confirm a choice, so the command line has to make the choice explicit.

## Decision

As of 2026-11-12, from `src/options.ts`, `src/non-interactive.ts`, and `src/exit-codes.ts`, and as of 2026-11-25, `src/working-directory.ts` and `src/repo.ts`:

- **`--yes` needs exactly one selection:**
  - `--changed`: every changed record in the configured bundles that still needs a sign-off, either never verified by the signer or regenerated since they verified it;
    - as of 2026-11-25, "since" is judged against the signer's latest readable `at` among their entries, comparing whole seconds, since a sign-off is stamped to the second;
    - a `generated.at` that can't be read can't be judged, so the record counts as unchanged once signed;
    - as of 2026-11-25, a `generated.at` ahead of the clock, such as one written in the wrong time zone, is judged like any other, and the record is refused when it's listed instead (issue #77);
  - or one or more record paths, relative to where the command runs, each an existing `.md` file directly inside a bundle, other than `index.md`.
    - Under pnpm or npm, that's the folder the script was called from (`INIT_CWD`) only when it's in the package's repo; otherwise, as with `pnpm --dir <package>` from another repo, it's the package root.
- **Every other combination is a usage error:**
  - `--yes` alone selects nothing;
  - `--changed` together with record paths;
  - `--changed` or record paths without `--yes`, since without it records are picked in the prompts.
- **A named record that's already verified, and unchanged since, is skipped**, with a `skipped <path>: already verified, unchanged` line, not an error.
  - As of 2026-11-25, a record whose sign-off isn't committed yet is committed as it is instead, with a `committing <path>: already verified, not yet committed` line, by a run that commits, whether named or found by `--changed` (issue #29).
  - It counts as not committed when `HEAD` doesn't hold the sign-off that's on disk (it lacks the record, its copy still needs a sign-off, or it holds an older one) and `git status` reports the file; when `HEAD` can't be read, or git won't see the file, such as an ignored one, it's skipped as before.
  - `--no-commit` still skips it.
- **One record that refuses the edit means nothing is written.**
- **A selected record that can't be read, or whose frontmatter isn't valid YAML, fails the run**, with a line naming it and why, whether it was named or found by `--changed`; it's never left out unseen.
  - As of 2026-11-25, so does one whose `generated.at` is ahead of the clock, with `generated.at is ahead of the clock; fix its time zone`, signed off before or not (issue #77).
    - **Rejected:** counting it as unchanged once signed, as issue #32 did, since a record regenerated after an older sign-off then read as verified until the clock passed its `generated.at`, which a typo such as `2099` puts off for good.
- **Exit codes:**
  - `0` — the run worked (or, interactively, the person cancelled);
  - `1` — a usage error, a git failure, a selected record that can't be read, isn't valid YAML, or was generated ahead of the clock, or a record that refused the edit;
  - `2` — `--yes` found nothing that still needs a sign-off.

## Why

- With no prompt, "verify everything" is one mistyped command away. Requiring `--changed` or names means a run never covers more than it was told to.
- `--changed` and paths are two different selections; accepting both would leave it unclear which one won.
- A record already signed off needs nothing, so skipping it lets an agent pass the same list twice safely.
- A sign-off left on disk by a commit a hook rejected would otherwise be skipped by every re-run, so a fix to the hook could never finish it (issue #29).
- A changed record that's skipped because it can't be read or parsed would look signed off once the run succeeds, so the run fails instead (issue #8).
- `pnpm --dir` and `npm --prefix` set `INIT_CWD` to the caller's folder, so trusting it anywhere let `--yes --changed` read another repo's config and sign its drafts (issue #26).
- Every sign-off must clear the record it signs; otherwise a run asks for a sign-off no sign-off can satisfy (issue #32).
  - OKF reads `verified` as how recently a record was reviewed, so the latest entry counts, not the first.
  - A `generated.at` with milliseconds, signed in the same second, would read as later than the sign-off.
- A `generated.at` ahead of the clock is later than any sign-off made now, so signing it can't clear it, and treating it as unchanged hides a real regeneration; refusing it until the time is fixed does neither (issue #77).
  - Refusing it in the listing, not in `getRecordState`, keeps the state independent of the clock for library callers.
- A separate exit code for "nothing to verify" lets a script or workflow tell an idle run from a failed one without parsing output.

## Consequences

- Agents should prefer named paths over `--changed` (see [Who verifies a record](who-verifies.md)).
- Changing an exit code or a valid combination is a breaking change to the CLI, and needs a changeset that says so.
