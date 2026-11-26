---
type: Decision
title: What `--yes` verifies, and how it exits
description: "`--yes` needs an explicit selection, `--changed` or record paths, never both and never neither; it skips records already verified and committed, and exits `0` worked, `1` failed, `2` nothing to verify."
tags:
  - agents
  - case-sensitivity
  - exit-codes
  - okf-verify
  - paths
  - safety
  - selection
  - verification
sources:
  - id: non-interactive
    resource: ../../src/non-interactive.ts
    title: src/non-interactive.ts, the --yes verify mode
  - id: exit-codes
    resource: ../../src/exit-codes.ts
    title: src/exit-codes.ts, the exit codes
  - id: working-directory
    resource: ../../src/working-directory.ts
    title: src/working-directory.ts, which resolves the working directory
  - id: repo
    resource: ../../src/repo.ts
    title: src/repo.ts, the file-system work on records
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-26T22:13:02Z }
verified: { by: human:jjloneman, at: 2026-11-26T20:51:19Z }
---

# What `--yes` verifies, and how it exits

The non-interactive mode has no prompt to confirm a choice, so the command line has to make the choice explicit.

## Decision

As of 2026-11-12, from `src/options.ts`, `src/non-interactive.ts`[^non-interactive], and `src/exit-codes.ts`[^exit-codes], and as of 2026-11-25, `src/working-directory.ts`[^working-directory] and `src/repo.ts`[^repo]:

- **`--yes` needs exactly one selection:**
  - `--changed`: every changed record in the configured bundles that still needs a sign-off, either never verified by the signer or regenerated since they verified it;
    - as of 2026-11-25, "since" is judged against the signer's latest readable `at` among their entries, comparing whole seconds, since a sign-off is stamped to the second;
    - a `generated.at` that can't be read can't be judged, so the record counts as unchanged once signed;
    - as of 2026-11-25, a `generated.at` ahead of the clock, such as one written in the wrong time zone, is judged like any other, and the record is refused when it's listed instead (issue #77);
    - as of 2026-11-25, a latest sign-off whose `verified.at` is ahead of the clock counts as changed when the record is listed, whatever its `generated.at`, so the record is offered again and a fresh sign-off renews that entry with the real time (issue #92);
      - **Rejected:** refusing the record until its `verified.at` is fixed by hand, like a `generated.at` ahead of the clock, since a fresh sign-off already fixes it;
  - or one or more record paths, relative to where the command runs, each an existing `.md` file directly inside a bundle, other than `index.md`.
    - As of 2026-11-25, other than `log.md` too, the other file name OKF reserves (issue #31).
    - As of 2026-11-25, at any depth inside a bundle, other than `index.md` and `log.md` at every level, and other than a path `okf.exclude` matches, which is refused as excluded (issue #42; see [Which files in a bundle are records](bundle-contents.md)).
    - Under pnpm or npm, that's the folder the script was called from (`INIT_CWD`) only when it's in the package's repo; otherwise, as with `pnpm --dir <package>` from another repo, it's the package root.
    - As of 2026-11-25, a record path and a configured bundle may take any spelling the disk resolves to the same file, such as another case on macOS: each is kept as given when git's index holds that spelling, and otherwise spelled as the disk spells it, since git compares paths byte for byte and, after a rename only in case, follows the index (issue #30).
      - As of 2026-11-25, name by name, folders first: a name git's index doesn't hold as given takes the spelling of an index entry in the same folder that differs from it only in case or Unicode form, when the disk resolves both to the same file, so a record or bundle folder renamed only in case on disk without `git mv` is spelled as git knows it, the interactive checklist lists such a record as changed, and a new record in such a folder is in its bundle (issue #100).
        - The disk decides, not the case: the index's spelling is taken only when the disk resolves it to the same file without listing it as a name of its own, so on a case-sensitive disk two names that differ only in case stay two paths, even when one is a hard link to the other.
      - As of 2026-11-25, `git status` matches a pathspec byte for byte and prints a file it doesn't track as the disk spells it, so `--changed` and the checklist's changed scope ask it for each bundle as the disk spells it too, and spell each path it prints name by name as above, so a record git doesn't know yet in a bundle folder, or a folder in one, renamed only in case on disk is found (issue #105).
      - The folder the command runs from is resolved through symlinks and into the disk's spelling when it isn't already inside the repo as git spells its root, so running from a link to the repo works; one already inside is kept as given, so a record path through a link inside the repo is still refused.
      - An absolute record path or `--bundle` is still read as given, so one that reaches the repo through a symlink above it counts as outside the repo.
      - Names from the disk and names git prints are compared by their Unicode NFC form, since git on macOS composes the names it prints while the disk keeps the form a file was created with; on a disk that tells the forms apart, two names that differ only in form count as one.
      - A record path through a symlink inside the repo is still refused, as [How okf-verify writes and commits records](writes.md) says.
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
  - As of 2026-11-25, so does one whose frontmatter block is a near miss, such as one with no closing `---`, blanks around a fence, a blank line before the opening one, or a `...` close, with a line naming what's wrong with the fence (issue #31).
    - A file whose first non-blank line starts with `---`, indented or not, a Markdown rule included, counts as one; any other file with no block still isn't a record.
  - As of 2026-11-25, so does one whose `generated.at` is ahead of the clock, with `generated.at is ahead of the clock; fix its time zone`, signed off before or not (issue #77).
    - **Rejected:** counting it as unchanged once signed, as issue #32 did, since a record regenerated after an older sign-off then read as verified until the clock passed its `generated.at`, which a typo such as `2099` puts off for good.
- **Exit codes:**
  - `0` — the run worked (or, interactively, the person cancelled);
  - `1` — a usage error, a git failure, a selected record that can't be read, has a near-miss frontmatter block, isn't valid YAML, or was generated ahead of the clock, or a record that refused the edit;
  - `2` — `--yes` found nothing that still needs a sign-off.

## Why

- With no prompt, "verify everything" is one mistyped command away. Requiring `--changed` or names means a run never covers more than it was told to.
- `--changed` and paths are two different selections; accepting both would leave it unclear which one won.
- A record already signed off needs nothing, so skipping it lets an agent pass the same list twice safely.
- A sign-off left on disk by a commit a hook rejected would otherwise be skipped by every re-run, so a fix to the hook could never finish it (issue #29).
- A changed record that's skipped because it can't be read or parsed would look signed off once the run succeeds, so the run fails instead (issue #8).
  - A near-miss block was taken for no frontmatter, so a draft with a typo in a fence read as "Nothing to verify" (issue #31).
- git compares paths byte for byte, so a bundle configured in another case found no changed records, a record named in another case was edited and then failed to commit, a decomposed file name never counted as changed, and a folder reached through a symlink put every record outside the repo (issue #30).
  - **Rejected:** comparing paths case-insensitively, since a case-sensitive disk can hold two records that differ only in case; the disk, and git's index, decide which spellings name one file.
- `pnpm --dir` and `npm --prefix` set `INIT_CWD` to the caller's folder, so trusting it anywhere let `--yes --changed` read another repo's config and sign its drafts (issue #26).
- Every sign-off must clear the record it signs; otherwise a run asks for a sign-off no sign-off can satisfy (issue #32).
  - OKF reads `verified` as how recently a record was reviewed, so the latest entry counts, not the first.
  - A `generated.at` with milliseconds, signed in the same second, would read as later than the sign-off.
- A `generated.at` ahead of the clock is later than any sign-off made now, so signing it can't clear it, and treating it as unchanged hides a real regeneration; refusing it until the time is fixed does neither (issue #77).
  - Refusing it in the listing, not in `getRecordState`, keeps the state independent of the clock for library callers.
- A `verified.at` ahead of the clock is later than every regeneration until the clock passes it, so it would hide them all; unlike a future `generated.at`, signing the record now clears it, since the edit renews the signer's latest entry (issue #92).
  - The listing judges it, like a future `generated.at`, so `getRecordState` still never reads the clock.
  - So a run that commits never takes such a sign-off on disk for an uncommitted one, since the record needs a fresh sign-off first, and one held in `HEAD` counts as needing a sign-off, so a renewal a hook rejected is committed by the re-run.
- A separate exit code for "nothing to verify" lets a script or workflow tell an idle run from a failed one without parsing output.

## Consequences

- Agents should prefer named paths over `--changed` (see [Who verifies a record](who-verifies.md)).
- Changing an exit code or a valid combination is a breaking change to the CLI, and needs a changeset that says so.

[^non-interactive]: `src/non-interactive.ts`, the `--yes` verify mode.

[^exit-codes]: `src/exit-codes.ts`, the exit codes.

[^working-directory]: `src/working-directory.ts`, which resolves the working directory.

[^repo]: `src/repo.ts`, the file-system work on records.
