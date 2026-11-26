# 🤖 AGENTS.md

Conventions for any AI agent (or human) working in this repo. Read top to bottom before editing.

## 🎯 Purpose of this repo

`@jjloneman/okf-tools` is a small, public npm package of tools for [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) bundles. It ships one binary, `okf`, whose first argument names a command: `okf verify`, which signs records off, with `okf-verify` kept as its alias; `okf diff`, which shows what changed since a sign-off; `okf init`, which writes the config, a block of agent rules, and the okf skills; `okf status`, which reports where every record stands and writes nothing; `okf guide`, which prints the guidance for agents from the installed version; `okf index`, which syncs each `index.md` from its records' frontmatter; `okf tags`, which lists every tag with its record count; `okf new` and `okf touch`, which scaffold a draft record and re-stamp an edited one's `generated`, both from the clock; `okf deprecate`, which retires records as `status: deprecated`, naming the record that replaces them; `okf migrate`, which moves a v0.1 or v0.2 bundle to v0.3; and `okf check`, which reports problems against the spec's rules and whether each sign-off still holds, and writes nothing (see [README.md](README.md)).

- **Interactive by default.** Without `--yes`, it prompts in a terminal and refuses to start without one.
- **`--yes` runs without prompts**, but only against an explicit selection: `--changed`, or named record paths. `--yes` alone is a usage error.
- **Verification is the person's call.** An agent runs `--yes` only when the person has asked it to verify those records, naming the files rather than passing `--changed` unless they asked for all of them. Never verify a record as a side effect of drafting or editing it.
- **It never pushes and never passes `--no-verify`** to git, in either mode.
- **Spec links are permalinks to commit `527e81a` of `open-knowledge-format/open-knowledge-format`**, the v0.3 text okf-tools follows, which the README names. Never link the spec by branch, since it has moved homes twice; a new pin changes every link at once.

## 🗂️ Project layout

- `src/` — the package, one concern per file, each with its `*.test.ts` beside it.
  - `okf-bin.ts` and `bin.ts` — the `okf` and `okf-verify` entries, each calling `start` in `start.ts`, which reads the process, calls `run`, and sets the exit code.
  - `cli.ts` — `run`: reads `okf`'s command (`okf-verify` goes straight to `verify`), parses that command's arguments, resolves the repo, config, and bundles, then dispatches to `okf check`, `okf deprecate`, `okf diff`, `okf guide`, `okf index`, `okf init`, `okf migrate`, `okf new`, `okf status`, `okf tags`, `okf touch`, or a verify mode, or prints `okf --version`. `okf check`, `okf deprecate`, `okf index`, `okf migrate`, `okf new`, `okf tags`, and `okf touch` need no signer, so they resolve only the repo, config, and bundles, as a `BundleContext`. It never throws.
  - `guide.ts` — `okf guide`, and the text it prints: the record rules, `RECORD_RULES` and `RECORDS_INTRO`, which the agent block is built from, each command with when an agent may run it, and each skill from `skills.ts`. A new command adds its line there; a test fails until it does.
  - `init.ts` — `okf init`: plans the `okf` block of `package.json`, the agent block in each instruction file, and each skill's `.claude/skills/<name>/SKILL.md`, then writes them all, or with `--check` only reports. It never throws.
  - `skills.ts` — `SKILLS`, the text of the okf-architecture, okf-record, and okf-review Agent Skills `okf init` installs, and `judgeSkill`, which says whether an installed copy is current, stale, missing, or someone else's, by its marker line. A skill never writes `verified` or a timestamp, and the record skill points at upstream's okf-generate for content rules (see [Which skills okf-tools ships](docs/decisions/skills.md)).
  - `package-json.ts` — `writeOkfMember`: replaces only the `okf` member of a `package.json` by position, keeping every other byte.
  - `agent-block.ts` — the agent block's text, `AGENT_BLOCK`, built from `guide.ts`'s rules, which the README's Agents section quotes word for word (a test checks it), and the pure logic that finds the markers and rewrites only what's between them; `findMarkedBlock` finds any pair of marker lines, for the tag index too.
  - `options.ts` — `okf`'s commands, the verify, check, deprecate, diff, guide, index, init, status and tags flags, the usage text for each, and which combinations are valid.
  - `config.ts` — reads the `okf` block of `package.json` and merges the flags over it.
  - `interactive.ts` and `non-interactive.ts` — the two verify modes.
  - `diff.ts` — `okf diff`; `sign-off-diff.ts` finds what changed in a record since its signer's last sign-off, for it and for the interactive mode.
  - `status.ts` — `okf status`: loads the records read-only, groups and filters them, and prints the text or the JSON report, whose `StatusReport` type `index.ts` exports. A change to the JSON's shape bumps `STATUS_SCHEMA_VERSION` and is a breaking change.
  - `index-command.ts` — `okf index`: loads the records read-only, finds each record's nearest `index.md` in the bundles, and syncs each index, or with `--check` only reports; `index-sync.ts` is the pure rewrite of one index's record lines and its tag index between `<!-- tag-index:start -->` and `<!-- tag-index:end -->`.
  - `new-record.ts` — `okf new`: resolves a path nothing is at yet, plans the record's text and its index's synced text with `index-command.ts`'s `planIndexWithRecord`, then writes the record, never over anything, and the index, removing the record again if the index write fails.
  - `touch.ts` — `okf touch`: re-stamps each named record with `frontmatter/touch.ts`, all or nothing, and commits nothing.
  - `deprecate.ts` — `okf deprecate`: resolves `--superseded-by` to a path from the bundle root, then deprecates each named record with `frontmatter/deprecate.ts`, all or nothing, and commits nothing.
  - `migrate.ts` — `okf migrate`: loads the records read-only, with every other Markdown file in a subfolder that git doesn't ignore, plans each bundle, and prints the plan as diffs, writes it under `--write` through `writeRecords`, root `index.md` last, or under `--check` only fails while one is needed; `migrate-plan.ts` is the pure plan for one bundle: the root `index.md`'s version, title and description, and each bare path that names a file only from the bundle root, rewritten by position to the relative path v0.3 reads.
  - `markdown.ts` — a body's lines, where it starts, and its code masked by position, shared by `index-sync.ts` and `migrate-plan.ts`.
  - `version.ts` — `SUPPORTED_SPEC_VERSION`, the OKF version okf-tools follows, which matches `spec/upstream.json`'s `version` (a test checks it), and the installed version `okf --version` prints.
  - `check.ts` — `okf check`: lists every Markdown file in the bundles git would track, reads each once into `check-engine.ts`'s `CheckedFile`, each changed one also as the branch's merge base holds it, runs `spec-rules.ts`'s and `trust-rules.ts`'s rules, under `--changed` reporting only on the changed files, and prints the text, the JSON report, whose `CheckReport` type `index.ts` exports, or GitHub Actions annotations. A change to the JSON's shape bumps `CHECK_SCHEMA_VERSION` and is a breaking change.
    - `check-engine.ts` — the engine: a rule is pure apart from the clock, which `I201` and the trust rules read, checks one file or a whole bundle, and returns lines and messages; `buildCheckReport` runs every rule and adds the code, name, severity, and path. A new rule set is a list of `CheckRule`s, with no change to the engine.
    - `spec-rules.ts` — `SPEC_RULES`, the rules the spec states, with the codes, severities, and wording of upstream's `validate.py` at the pinned commit. A new pin re-reads that file and moves these rules in the same PR.
    - `trust-rules.ts` — `buildTrustRules`, okf-tools' own `T` rules on whether a sign-off still holds, the draft rule's severity set by `okf.drafts`, and the gate that fails a body changed since the base under an old sign-off. `readChangedAt` alone reads a record's last change time, so a spec that moves it changes one function.
  - `tags.ts` — `okf tags`: counts each tag across the records, read-only, and prints the text or the JSON report, whose `TagsReport` type `index.ts` exports. A change to the JSON's shape bumps `TAGS_SCHEMA_VERSION` and is a breaking change.
  - `records.ts` — pure record logic: the candidate type, the commit message, the edits, and `stale_after` from `--stale-in`.
  - `git.ts` — every git call, relative to the repo root.
  - `repo.ts` — the file-system work on records: resolving bundles and paths, finding the deepest bundle that owns a path, listing changed records, loading candidates (read-only for `status`, `index`, and `tags`, which skip the edits' refusals), reading and writing records.
  - `frontmatter/` — pure functions, apart from the clock `read.ts` reads, that read and edit a record's frontmatter, exported from `index.ts`. It reads with the `yaml` package's failsafe schema, aliases resolved, and slices the frontmatter out by position, so line endings are never rewritten.
    - `types.ts` — the public types and constants (`EntryStyle`, `RecordStatus`, `RefusalKind`, `Timestamp`, `TrustTier`, `Verification`, `VerifyRecordParams`, `ENTRY_STYLES`, `RECORD_STATUSES`, `REFUSAL_KINDS`, `TRUST_TIERS`). It imports nothing, so the published declarations never import the `yaml` package's types.
    - `shared.ts` — the types, constants, and helpers the others share: parsing, splitting, positions, and the small node readers. It imports only from `types.ts`.
    - `read.ts` — `readRecordSummary`, which also reads `description` and `tags` for `okf index` and `okf tags`, `getRecordState`, `getTrustTier`, `isCurrentVerification`, `isGeneratedAhead`, `isVerifiedAhead`, `isStale`, `readLatestByActor`, and `findFrontmatterProblem`; reading accepts any valid YAML. The state compares whole seconds and never reads the clock; `getTrustTier`, `isCurrentVerification`, `isStale`, `isGeneratedAhead`, and `isVerifiedAhead` do: `getTrustTier` and `isStale` for `status.ts` to report OKF v0.3's trust tier from every actor's `verified` events and to judge `stale_after`, `isCurrentVerification` for it and `okf check`'s trust rules to judge a sign-off current, the others for `repo.ts` to refuse a record generated ahead of it when it's listed, and to list one signed off ahead of it as changed, and for `apply.ts` to judge a sign-off ahead of it in `HEAD`.
    - `meaning.ts` — before any edit, `findAmbiguity` refuses a frontmatter whose meaning is ambiguous (an unresolved alias, two keys that mean the same); after it, `checkMeaning` refuses any result that isn't valid YAML or doesn't parse to the original plus the intended changes.
    - `layout.ts` — the allowlist (`readEditableLayout`), which refuses any `status` or `verified` layout outside the README's list.
    - `edit.ts` — `verifyRecord`: edits replace only the characters they change, at the positions the parser reports, all planned against one parse and applied from the end of the text. A new entry takes the layout `readEntryForm` picks from the `style` and the record's `generated`. A lone CR, and an `at` `isWritableTimestamp` refuses, are refused here, each refusal with a `kind`. `findEditProblem` runs the same refusals when records are listed, so `repo.ts` reports a refused record before anyone chooses it.
    - `touch.ts` — `touchRecord`: re-stamps `generated.by` and `generated.at` with `edit.ts`'s `applyEdits` and `writeScalar`, under `verifyRecord`'s refusals, and checks the result means only that, and `status: draft` when asked.
    - `scaffold.ts` — `scaffoldRecord`: a new draft record's frontmatter, with no body.
    - `fields.ts` — `writeFields`: overwrites or adds top-level fields that each hold one value, such as `stale_after`, under `verifyRecord`'s refusals, and checks the result means only that.
    - `deprecate.ts` — `deprecateRecord`: `touchRecord`, then `status: deprecated` and `superseded_by` with `writeFields`.
  - `output.ts` — the output lines, prefixed `[okf]`, or `[okf-verify]` under the alias, and the unprefixed `data` for JSON and the guide, carried on the `RunContext`, plus `toTerminalLine`, which makes a record's own text safe as one line; `exit-codes.ts`, `outcome.ts`, and `run-context.ts` are shared types.
- `scripts/changelog.ts` — the changesets changelog formatter, tested and covered like `src/` but never published.
- `scripts/spec-watch/` — the spec watch that `spec-watch.yml` runs (see [Spec watch](#-spec-watch)), covered like `src/` and never published; `bin.ts` is its entry.
- `spec/upstream.json` — the pin: the upstream spec okf-tools supports.
- `docs/decisions/` — the repo's own OKF bundle of design decisions (see [Design decisions](#-design-decisions)).
- `docs/references/` — the repo's OKF v0.3 bundle of dated reference records, such as the landscape of other OKF tools, each with a `stale_after` (see [References](#-references)).
- `test/repo.ts` — scratch git repos, fabricated records, and the shared `VERIFIED_BY` for the tests, imported as `#test/repo`.
- `test/spec-watch.ts` — a fake `fetch` that answers for GitHub and ntfy, and a fabricated upstream, for the spec watch's tests, imported as `#test/spec-watch`.
- `.changeset/` — pending changesets (see [Versioning & releases](#-versioning--releases)).
- `.github/workflows/` — `ci.yml`, `okf-check.yml`, `release.yml`, `spec-watch.yml`, and `product-review-reminder.yml`; `.github/actions/setup/` is the shared pnpm + Node + install prelude; `.github/rulesets/main.json` protects `main`.
- `.claude/skills/product-review/` — the product review skill (see [Product review](#-product-review)).
- `eslint-rules/` — the local `no-dotted-jsdoc-param` rule, loaded by `eslint.config.ts`.
- `dist/` — build output (gitignored), the only directory published; `CHANGELOG.md` is published beside it.

## 🎨 Code style

- **Strict TypeScript**: no `any`; exported functions declare their return type (`isolatedDeclarations` enforces it); `type` over `interface`; `import type` for type-only imports.
- **A `catch` binding is `unknown`**: narrow it with `instanceof` and `typeof`, never cast it (`readGitFailure`, `describeError`).
- **Results, not exceptions**: a step that can fail returns `{ isOk: true, … } | { isOk: false, reason }`, and only `run` turns a reason into output and an exit code.
- **Function parameters**: one positional parameter is fine; with two or more, take a single object with sorted keys.
- **Named functions are `function` declarations**; arrows are for callbacks and closures.
- **Lexicographic ordering** of everything perfectionist's `recommended-alphabetical` preset sorts; module constants are `SCREAMING_SNAKE_CASE`; boolean names read as questions, opening with an auxiliary verb (`are`, `can`, `did`, `does`, `has`, `have`, `is`, `should`, `was`, `were`, `will`): `isYes`, `shouldCommit`, `areAllVerified`.
- **Every output line starts with `[okf]`**, or `[okf-verify]` under the alias, outside the prompts and text printed to be read as it is, such as `okf status --format json` or `okf guide`, which goes through `output.data`; a git call sets `stdio` explicitly, so its stderr never prints over the prompts.
- **Dates go through luxon.**
- **Comments say only _why_.** A comment of three lines or more is a block comment: a lead sentence, then `-` bullets.
- **TSDoc every export**, and give every property of a named type its own doc comment with one `@example`.
- **American English** in all prose.

## ✍️ Commit conventions

[Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) with a gitmoji after the colon: `<type>(scope): <gitmoji> <subject>`, imperative and lowercase, with a `-` bullet body when needed.

| Type       | Gitmoji | Use for                            |
| ---------- | ------- | ---------------------------------- |
| `build`    | 🔨      | build system / typecheck infra     |
| `chore`    | 🧹 / ⬆️ | housekeeping, dependency bumps     |
| `ci`       | 🤖      | CI / workflow changes              |
| `config`   | 🔧      | tooling config (eslint, vitest, …) |
| `docs`     | 📝      | documentation                      |
| `feat`     | ✨      | new feature                        |
| `fix`      | 🔧      | bug fix                            |
| `refactor` | 🏗️      | refactor                           |
| `test`     | 🧪      | tests                              |

- **Branches**: `feature/`, `bugfix/`, or `release/`, then `gh-<n>-` for the issue, then a kebab-case slug (`feature/gh-1-extract-okf-verify`).
- **Stale branches**: `pnpm prune-branches` lists the local branches whose remote branch is gone, and deletes nothing; `pnpm prune-branches:force` deletes them all, unpushed commits included, so read the list first, and an agent runs it only with the owner's confirmation (see [Deleting things](#-deleting-things)).
- **Issues and PRs** are assigned to `jjloneman` and labeled with a type (`✨ feature`, `🐞 bug`, `📦 dependencies`, or `💡 idea` for a product review's ideas); spell the emoji-prefixed labels exactly.
- **PRs are squash-merged**, so the PR title becomes the commit on `main`.
- **`main` is protected** by [.github/rulesets/main.json](.github/rulesets/main.json): changes land through a squash-merged PR, unresolved review threads block the merge, every CI job must pass, and there are no force pushes or deletion. After editing the file, reapply it with `gh api --method PUT repos/jjloneman/okf-tools/rulesets/<id> --input .github/rulesets/main.json`.
- **AI-written text on GitHub opens with a disclaimer banner**: `> **🤖 Disclaimer**: This description was generated with AI. (**Model**: _<model name and version>_)`, with "comment" in place of "description" for a comment.

## 🧪 Testing

- `pnpm test` runs the suite; `pnpm test:coverage` adds the gate: **100%** statements, branches, functions, and lines across `src/` and `scripts/`.
- A branch nothing can reach is dead code to delete, not a line to exempt; no coverage-ignore comments.
- `src/frontmatter/edit.property.test.ts` property-tests the edits with `fast-check` over generated layouts, with a fixed seed and run count. A failure prints its `seed` and `path`; put both in `RUN_OPTIONS` to replay it. To hunt for new failures, run it locally with a higher `numRuns` and no `seed`, and add each counterexample as an example test with its fix.
- Tests that need git run it for real, in a scratch repo from `#test/repo`: `const { repo } = useTestRepo()` at the top of the file gives each test a fresh one; only a machine state no test machine has (no git binary) is mocked.
- The prompts are tested with `@clack/prompts` mocked; everything after the prompts runs for real.
  - `src/bin.terminal.test.ts` is the exception: it runs `okf-verify` in a pseudo-terminal through `python3`, for the keys a mock can't reach, such as Ctrl-D closing readline.
- **Test data is fabricated.** Never copy a real repo's records into a test.
- Shape: `describe("<unit>")` → `test("<scenario>")`, with `// Given` / `// When` / `// Then` comments, each followed by a hyphen and what that phase holds; table tests name rows with `$description`.

## ✅ Pre-commit checks

- Run `pnpm check` before committing; it rewrites files, so read the diff after.
- `pnpm install` points `core.hooksPath` at `.githooks/`: `pre-commit` lints and formats the staged files, and `pre-push` typechecks the project.
- Don't bypass the hooks (`--no-verify`) without the owner's approval.

## 🤖 CI

- `ci.yml` runs on every PR and push to `main`: lint and format check, typecheck, tests on Node 22 and 26 (coverage on 26), `pnpm lint:package`, and `okf check --strict` on the decision records.
- On a PR it also runs `pnpm changeset status --since=origin/main`, which fails when the PR adds no changeset.
  - It skips the version PR (`changeset-release/main`), which only consumes changesets.
- **`okf-check.yml` is a reusable workflow** that other repos call, pinned by commit SHA, to run `okf check` on their bundles (see the README's "In GitHub Actions").
  - It runs against the caller's checkout, so it never uses `./.github/actions/setup`, which would name a file in the caller's repo.
  - `ci.yml`'s `okf` job calls it from this commit, so a change to it runs here first.
  - Its job's name is part of every caller's status check, `<caller's job> / 🩺 OKF check`, so renaming it breaks their required checks: treat it as a breaking change.
- `release.yml` runs on every push to `main` (see below).
- `spec-watch.yml` runs daily and on demand, never on a PR (see [Spec watch](#-spec-watch)).
- `product-review-reminder.yml` runs weekly and on demand, never on a PR (see [Product review](#-product-review)).
- Every action is pinned to an exact `vX.Y.Z`, and every job declares its own `permissions`.
- **Every `ci.yml` job is a required check** in [.github/rulesets/main.json](.github/rulesets/main.json), by its display name; `spec-watch.yml` never runs on a PR, and neither does `product-review-reminder.yml`, so neither is one. Renaming a job or changing the test matrix means updating `required_status_checks` there and reapplying the ruleset, or every PR waits on a check that never reports.

## 🔭 Spec watch

The OKF spec has no releases or tags, so `spec-watch.yml` checks it daily against the pin in `spec/upstream.json`: the watched `repo`, the spec's `path`, the `sha` of the last commit to it that okf-tools follows, its `version`, and the `candidates` that may become its next home.

- **It reports:**
  - new commits to the spec, a changed `**Version …**` line, and a `(draft)` suffix gained or lost;
  - the spec's file going missing, and the repo archived, renamed or gone;
  - new lines that may announce a deprecation or a move, in the root README, the README in the spec's own folder, or the spec;
  - each repo such a line's paragraph links to that holds a spec with a version line, following each one's own README notices in turn, up to ten repos a run; a repo GitHub won't serve is skipped, and tried again next run;
  - repos the home's owner created since the pin's commit that hold a spec, from the owner's hundred newest, or any of those when the home is gone or the pin isn't among its last hundred commits;
  - the home's GitHub releases, and its tags that no release is published from;
  - open upstream PRs that touch the spec;
  - candidates that are public, and each one's spec version when it differs from the pin's.
- **It opens one issue per run**, titled with the short SHA of the newest commit to the spec, listing only what no earlier spec-watch issue reported, open or closed. Each issue records its findings' keys in a `<!-- spec-watch: … -->` marker, so keep that line when editing one.
- **It sends an ntfy push** to the topic in the `NTFY_TOPIC` Actions secret; without the secret it sends none. The topic is its only access control, so never echo it or write it in the repo.
- **The PR that closes its issue bumps the pin:** set `sha` and `version` to the commit okf-tools now follows, `SUPPORTED_SPEC_VERSION` in `src/version.ts` with a new version, re-pin every spec link to the same commit (see [Purpose of this repo](#-purpose-of-this-repo)), and move `SPEC_RULES` in `src/spec-rules.ts` to that commit's `skills/okf-generate/scripts/validate.py`. To stop watching a candidate, or to watch the spec's new home, edit `candidates` or `repo` and `path`.
- **When the spec moves homes, move the pin first, to the same text at the new home**, re-pinning every link; adopting a newer version is a PR of its own (see [Which OKF spec okf-tools follows](docs/decisions/spec-pin.md)).
- **Try it without writing anything:** run it from the Actions tab with `dry-run`, or locally with `GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=jjloneman/okf-tools SPEC_WATCH_DRY_RUN=true node scripts/spec-watch/bin.ts`. The `sha` input (`SPEC_WATCH_SHA` locally) compares against an older commit instead of the pin; without `dry-run` that opens a real issue, whose findings later runs count as reported.
- **GitHub disables a scheduled workflow after 60 days without repo activity**, and emails the owner first; re-enable it from the Actions tab.

## 💡 Product review

`/product-review`, the skill in `.claude/skills/product-review/`, reads the README, the decision records, the changelog, this repo's issues, the spec's new issues and PRs, and the landscape record, then opens one issue labeled `💡 idea` with at most three ranked ideas and the ones it dropped.

- **It runs only when the owner types it,** since a run spends the owner's subscription: never from a schedule, a hook, another session, or an agent's own judgment.
- **It builds nothing it suggests.** An idea taken becomes its own issue, planned like any other.
- **`product-review-reminder.yml` says when one is due,** with an ntfy push to the `NTFY_TOPIC` topic (see [Spec watch](#-spec-watch)) every fourth Monday, counted in weeks since the Unix epoch.
  - Run it from the Actions tab to send one now, such as when GitHub skipped a scheduled run; without the secret it sends none.
  - GitHub disables it after 60 days without repo activity, like the spec watch; re-enable it from the Actions tab.
- **A rejected idea gets a one-line reason, and an issue with no idea taken closes as not planned.**
  - A review issue closes once each of its ideas is decided, with one comment giving each idea's outcome: the issue it became, or its one-line reason.
  - It closes as completed when any idea was taken, and as not planned when none was.
  - The next run reads those comments first, so it doesn't offer a rejected idea again.
- **Revisit the four-weekly cadence after three reviews** (see [How product ideas are found and decided](docs/decisions/product-review.md)).

## 🕒 7-day dependency moratorium

No npm dependency may enter the lockfile until it has been published for **at least 7 days**, enforced by `minimumReleaseAge: 10080` in [pnpm-workspace.yaml](pnpm-workspace.yaml).

- Pick the newest version that is at least 7 days old; if the lockfile fails the check, downgrade the entry rather than relaxing the floor.
- The floor doesn't apply to git dependencies, which have no publish date, so don't add one.
- Versions are pinned exactly (`saveExact: true`).
- `@types/node` tracks the `engines.node` floor (22), and TypeScript stays on 6.0 until `typescript-eslint` supports 7.

## 🚀 Versioning & releases

Releases use [changesets](https://github.com/changesets/changesets), and the package follows SemVer, pre-stable (0.x).

- **Every PR adds a changeset**, and CI fails one that doesn't.
  - A PR that changes what ships runs `pnpm changeset`: the bump and the summary it adds to `CHANGELOG.md`. In 0.x, a breaking change is a `minor` and anything else a `patch`.
  - A PR that only touches tooling, tests, or docs runs `pnpm changeset --empty`, which records no release, so it never publishes.
- **Changelog lines are built by [scripts/changelog.ts](scripts/changelog.ts)**, named by `changelog` in `.changeset/config.json`.
  - Each line takes the gitmoji and scope from the subject of the commit that added the changeset, which after a squash merge is the PR title: `- ✨ **okf-verify:** <summary> (<short hash>)`.
  - When that commit can't be read, such as a hash from before a squash, the line is the bare summary.
  - changesets `import()`s the file itself under Node's type stripping, so it uses only erasable syntax (`erasableSyntaxOnly` enforces it) and `.ts` import specifiers.
  - That needs Node 22.18 or later, which `devEngines` in `package.json` enforces for every `pnpm` script. `engines` stays at `>=22`, since the published package runs on any Node 22.
  - A breaking change (`feat(cli)!: …`) gets a `**Breaking:**` tag after the scope.
- **`release.yml`** keeps a rolling `chore(release): 🚀 version packages` PR open while changesets are pending.
  - Its CI run is started by `github-actions[bot]`, so it waits for approval: approve it on the PR before merging, since `main` requires every check.
  - Squash-merging it bumps `package.json` and writes `CHANGELOG.md`.
  - The run on that merge publishes the new version to npm and tags it.
- **Publishing uses npm trusted publishing** (OIDC), so no npm token exists; provenance is signed by the same identity.
  - The first version was published by hand, since trusted publishing can only be set up for a package that already exists.
- **Never hand-run a version bump or `git tag`**; the version PR owns both.
- `CHANGELOG.md` is in `.prettierignore`, since changesets writes it.
- **`files` in `package.json` lists `CHANGELOG.md` beside `dist`**, since npm no longer packs a changelog on its own; check `npm pack --dry-run` lists it.

## 📚 Design decisions

Why the package works the way it does is recorded in [docs/decisions/](docs/decisions/index.md), an [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) bundle, still declared `okf_version: "0.2"`, that this repo signs off with its own `okf-verify` (`okf.bundles` and `okf.verifiedBy` in `package.json`).

- One Markdown file per decision, listed in [docs/decisions/index.md](docs/decisions/index.md), with tags from its vocabulary; after adding, removing or retitling one, run `pnpm okf:index` to rewrite its line.
- **Base a record on the code and the closed threads**, not on memory: re-read the code before stating a flag, an exit code, or a fallback order, and date-stamp facts that can drift ("as of 2026-11-11").
- **An agent writes a record as `status: draft`** and records itself in `generated`, as `<producer>/<version>` (`claude-code/<claude --version>` or `claude-code/<model-id>`); it never adds a `verified` entry on its own.
- **An agent verifies only when the owner asks**, with `pnpm okf:verify --yes <paths>`, naming the files rather than passing `--changed` unless the owner asked for every changed record.
- **Check a record's `verified` before changing the behavior it describes:**
  - any `verified` entry means someone signed it off (usually `human:jjloneman`, the owner) — change the behavior only with the owner's agreement;
  - no `verified` means it is an unreviewed draft;
  - either way, update the record in the same PR as the change, and re-stamp `generated` (`by` and `at`), so a signed-off record shows as changed until it is verified again;
  - set a signed-off record you edit back to `status: draft`, even for a link-only edit, keeping its `verified` entry; `okf-verify` sets it to `stable` again on sign-off.

## 🔖 References

[docs/references/](docs/references/index.md) is a second bundle, declared `okf_version: "0.3"`, of what was true outside okf-tools on a date, such as [the landscape of other OKF tools](docs/references/landscape.md) that `/product-review` reads.

- **Its [index](docs/references/index.md) holds the rules:** every record has a `stale_after`, and marks each claim "read" or "tried", with its date, and recommends no tool.
- **Refreshing one is a PR like any other**, written and signed off like a decision record (see [Design decisions](#-design-decisions)); sign one off with `--stale-in` naming only reference records, since a decision never goes stale.

## 🛑 Deleting things

- Confirm with the owner before deleting anything the current task didn't create: files, branches, issues, remote state.
