---
type: Decision
title: How okf-check.yml posts drafts as review comments
description: "With `review-comments: true`, the reusable workflow posts each draft record's `T001` on a same-repo pull request as a file-level review comment, through `okf check --review-file` and `okf review-comments` over `@octokit/core`; a hidden marker naming the record, the code and its blob finds each comment again, the owner resolves it to acknowledge the draft, the comments job takes the calling job's `contents: write` and `pull-requests: write`, and anything it can't post falls back to annotations."
tags:
  - ci
  - dependencies
  - github-actions
  - okf-check
  - okf-review-comments
  - pull-requests
  - rulesets
  - verification
sources:
  - id: okf-check-yml
    resource: ../../.github/workflows/okf-check.yml
    title: .github/workflows/okf-check.yml, the reusable workflow
  - id: ci-yml
    resource: ../../.github/workflows/ci.yml
    title: .github/workflows/ci.yml, which calls it on this repo's records
  - id: check
    resource: ../../src/check.ts
    title: src/check.ts, the okf check command
  - id: review-comments
    resource: ../../src/review-comments.ts
    title: src/review-comments.ts, the okf review-comments command
  - id: review-plan
    resource: ../../src/review-plan.ts
    title: src/review-plan.ts, what a run posts, edits, or resolves
  - id: github-client
    resource: ../../src/github-client.ts
    title: src/github-client.ts, the GitHub calls
  - id: ruleset
    resource: ../../.github/rulesets/main.json
    title: .github/rulesets/main.json, which protects main
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-27T04:37:50Z }
verified: { by: human:jjloneman, at: 2026-11-27T02:33:04Z }
---

# How okf-check.yml posts drafts as review comments

A notice on a pull request can't be replied to, resolved or deferred, so the owner had no way to say that a draft would merge unverified, or why. #146 asked for a draft's finding to be a review comment instead, which the owner resolves to acknowledge it.

## Decision

As of 2026-11-27, from `.github/workflows/okf-check.yml`[^okf-check-yml]:

- **An opt-in input, `review-comments`, off by default**, so a caller that doesn't set it sees no change.
- **Only on a `pull_request` from the same repo:** a fork's token can't write, so there, on any other event, and for a comment GitHub refuses, each draft stays an annotation.
  - So does a draft the pull request doesn't change, such as a record in scope under `--changed` for citing a changed file, since GitHub takes a comment only on a file in the diff.
  - When the threads can't be read, such as when the calling job grants no `pull-requests` access, every draft is an annotation.
- **Only `T001` becomes a comment**, the one finding that's about whether a record may merge as it is.
  - Every other finding stays an annotation, and an error such as `T006` or `T008` still fails the check job, so resolving a thread can't wave it through.
  - With `review-comments` on, the check job runs `okf check --review-file`, which writes the drafts as JSON and leaves them out of the annotations, and prints every finding as a line as before[^check].
- **A file-level comment, not a line comment**, so it never needs a line inside the diff, and never moves with one.
- **A hidden marker, `<!-- okf-check: <path> <code> <blob> -->`, finds a comment again**, with the record's git blob at the pull request's head, so a run tells a changed record from an acknowledged one by its text, not its line, and a change to the record on the base branch, which the merge checkout holds, asks for no new acknowledgment:
  - a thread for the same blob is kept as it is, resolved or not, its text edited only when the wording changed;
  - an open thread for an older blob is edited to the new one;
  - when every thread for the record is resolved, a changed record gets a new comment, so a resolved thread stays resolved until the record changes again;
  - every other open thread, as when the record was signed off, is resolved, with its marker's blob set to `0`, so if the record comes back as it was, a resolution the owner never made can't stand for theirs;
  - only a marker on a comment by `github-actions` counts, so no one else's comment can stand in for one.
- **A comment is laid out to be scanned**, as the owner asked in review on PR #147[^review-plan]:
  - a bold heading with an emoji for the severity, the code as code, and the rule, such as **📝 `T001` draft** · info;
  - the finding's first clause as a sentence, and each clause after it, up to the last, as a bullet, splitting the message where `okf check` joins its clauses with `; `;
  - times, actors, the `generated` and `verified` fields, and `okf` commands set as code;
  - a bold **What to do:** with two steps: **Sign it off**, from the finding's last clause, and **Resolve this thread**.
  - Since a run edits a comment whose wording changed, a new layout reaches every open and resolved thread on the next run, and a resolved one stays resolved.
- **The message's own text can't mention anyone or open an HTML comment**, so a record's `verified.by` can't ping someone or forge a marker; a section such as §5.3 links to the pinned spec.
- **The comments job declares no `permissions`, so it takes the calling job's**, which must grant `contents: write` and `pull-requests: write`, and the workflow drops its workflow-wide `permissions: {}`.
  - `pull-requests: write` posts and edits comments; resolving a thread also needs `contents: write`, as GitHub refused it with "Resource not accessible by integration" without it on PR #147, as of 2026-11-27.
  - The comments job runs the pull request's own okf, as the check job does, so the write access reaches the pull request's code. A same-repo author can already push to the repo, and a fork never gets here; the job installs with `--ignore-scripts`, so no dependency's install script runs with the token.
  - **Rejected:** asking for these in the workflow. A called job that asks for more than its caller grants fails the whole run before it starts, even when its `if` is false, so every caller that doesn't grant it would break.
  - The check job still declares `contents: read` alone.
  - **Rejected:** a second reusable workflow. The issue asked for an input, and a second call would run `okf check` twice.
- **One comments run at a time for each pull request**, by a `concurrency` group, so two runs never both post the same draft.
- **The check job keeps its name, `🩺 OKF check`**, so no caller's required check moves; the comments job is a new one, `💬 OKF review comments`, which falls back to annotations rather than failing, so it needn't be required.
- **Comments are posted by `okf review-comments`**, okf-tools' own command, tested like the rest of the package[^review-comments], as the owner asked in review on PR #147.
  - The workflow runs against the caller's checkout, so it can't load a script from this repo; the command reaches it as okf does, from the repo's own lockfile or `okf-version`, and the comments job installs it the same way the check job does.
  - It calls GitHub through `@octokit/core`[^github-client], GitHub's own client, with the job's token, and reads the record's blob at the head from the pull request's file list.
    - Octokit types each REST call by its endpoint, from GitHub's own API description, and handles the auth header and a GitHub Enterprise URL; GraphQL answers aren't typed, so the client narrows each field it reads.
    - The cost: as of 2026-11-27, installing it adds about 6.3 MB to every repo that installs okf-tools, 5.1 MB of it `@octokit/openapi-types`, which holds only types and never loads, for one command that runs only in CI. The owner judged that worth it in review on PR #147.
    - **Rejected:** a hand-written client over `fetch`, which the first move out of the workflow used, with no new dependency; the owner asked in review on PR #147 whether a GitHub package could replace it, since it made the file long.
    - **Rejected:** the `gh` CLI, which GitHub's runners have; okf would depend on it being installed, its tests would fake a binary, and its answers would be untyped all the same.
  - The command is three files: the pure plan[^review-plan], the client, and the command that reads its inputs and runs them.
  - A run whose pull request's head has moved on since its push annotates its drafts instead, since its blob would be read from a commit its check never saw; the newer push's run posts them.
  - A marker whose path isn't valid percent-encoding is skipped, as no run of its own wrote it, and an answer without the pull request's threads falls back to annotations, rather than reading as none and posting every draft again.
  - **Rejected:** inline `actions/github-script` steps, which the first version used. The owner asked in review on PR #147 for them to be extracted: code in a workflow's YAML isn't linted, typechecked, or tested, so it sits outside the 100% coverage gate every other line of the repo meets, and a reviewer reads it without tests beside it.
  - That holds for every workflow in this repo, as AGENTS.md's CI section says: a `run` step holds only calls and the plumbing between them, and logic goes in a tested command or script.
  - **Rejected:** checking out okf-tools at the workflow's own commit to run a script file, which needs a SHA GitHub doesn't clearly expose to a called workflow, and leaves the script untested.
- **This repo opts in**[^ci-yml], with a ruleset[^ruleset] that already blocks a merge while a thread is unresolved, so a draft merges only once the owner has resolved its thread.

## Why

- Resolving a thread is GitHub's own way to say a point was seen and settled, and a ruleset can require it, so it needs no new button or app.
- Keying a comment by the record's blob ties the acknowledgment to the text that was acknowledged.

## Consequences

- A caller needs a version of okf-tools with `okf check --review-file` and `okf review-comments` before it turns `review-comments` on.
- This repo's own pull requests run the workflow first, as `ci.yml`'s `okf` job calls it from the same commit.
- A spec pin moves the spec link in `src/review-plan.ts` with every other spec link.

## Links

- [#146](https://github.com/jjloneman/okf-tools/issues/146) — review comments the owner can resolve.
- [How okf check judges whether a sign-off still holds](trust-rules.md) — what `T001` says.

[^okf-check-yml]: `.github/workflows/okf-check.yml`, the reusable workflow.

[^check]: `src/check.ts`, the `okf check` command.

[^review-comments]: `src/review-comments.ts`, the `okf review-comments` command.

[^review-plan]: `src/review-plan.ts`, what a run posts, edits, or resolves.

[^github-client]: `src/github-client.ts`, the GitHub calls.

[^ci-yml]: `.github/workflows/ci.yml`, which calls it on this repo's records.

[^ruleset]: `.github/rulesets/main.json`, which protects `main`.
