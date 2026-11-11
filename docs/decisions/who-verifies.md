---
type: Decision
title: Who verifies a record
description: Verification is the person's call, but not only a terminal prompt may record it; an agent verifies with `--yes` when the person asks, naming the files and signing as the person.
tags: [agents, verification]
sources:
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format specification
status: draft
generated: { by: claude-code/2.1.322, at: 2026-11-11T23:36:00Z }
---

# Who verifies a record

A `verified` entry says a person reviewed a record[^okf-spec]. The question is who may write it: only a person at a terminal prompt, or an agent too.

## Decision

As of 2026-11-11, from `src/bin.ts`, `src/cli.ts`, `src/options.ts`, and the README:

- **Verification is the person's call; how it's recorded is not restricted.**
  - The interactive mode, the default, prompts in a terminal and refuses to start without one on both stdin and stdout.
  - The non-interactive mode (`--yes`) records the same sign-off with no prompts, so an agent or a workflow can run it.
- **What an agent should do** is guidance, not a check the tool enforces. It's in the README's Agents section, the `--help` text, and this repo's AGENTS.md:
  - don't verify a record unless the person asks; drafting, editing, and regenerating a record never imply a sign-off;
  - name the files the person approved, rather than passing `--changed`, unless they asked for every changed record;
  - sign as the person (the configured `okf.verifiedBy`), since the approval is theirs.
- **A repo that wants a stricter rule** says so in its own agent instructions.

## Why

- Much OKF authoring now happens in a chat with a coding agent: the owner edits a record with the agent until it meets their bar, then tells the agent it's verified. Making them leave the chat for a terminal prompt adds a step without adding review.
- safe-fns' original script had no way to skip its prompts, which is what kept `verified` a human act there; this package drops that rule in favor of the guidance above (decided in issue #1, 2026-11).
- `--yes` alone does nothing (see [What `--yes` verifies](yes-selection.md)), so the tool can't verify everything by accident even when an agent runs it.

## Consequences

- An agent that verifies unasked is breaking documented guidance, not working around a guard; the guidance lives where agents read it.
- A later GitHub Actions approval flow can call `okf-verify --yes --by <approver> <paths>` with no new mode.

[^okf-spec]: OKF v0.2's trust tiers derive from the `verified` field: unverified, machine-confirmed, or human-reviewed.
