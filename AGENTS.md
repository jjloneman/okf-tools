# 🤖 AGENTS.md

Conventions for any AI agent (or human) working in this repo. Read top to bottom before editing.

## 🎯 Purpose of this repo

`@jjloneman/okf-tools` is a small, public npm package of tools for [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/62432a095456147ee71e70ac6e4dc0d2dea3ac30/okf/SPEC.md) bundles. Today it ships `okf-verify`, which signs records off (see [README.md](README.md)).

- **Interactive by default.** Without `--yes`, it prompts in a terminal and refuses to start without one.
- **`--yes` runs without prompts**, but only against an explicit selection: `--changed`, or named record paths. `--yes` alone is a usage error.
- **Verification is the person's call.** An agent runs `--yes` only when the person has asked it to verify those records, naming the files rather than passing `--changed` unless they asked for all of them. Never verify a record as a side effect of drafting or editing it.
- **It never pushes and never passes `--no-verify`** to git, in either mode.
- **Spec links are permalinks to commit `62432a0`**, the v0.2 text okf-tools was written against, which the README names. Never link the spec by branch, since it has moved homes; a new pin changes every link at once.

## 🗂️ Project layout

- `src/` — the package, one concern per file, each with its `*.test.ts` beside it.
  - `bin.ts` — the `okf-verify` entry: reads the process, calls `run`, sets the exit code.
  - `cli.ts` — `run`: parses the arguments, resolves the repo, config, and bundles, then dispatches to a mode. It never throws.
  - `options.ts` — the flags, the usage text, and which combinations are valid.
  - `config.ts` — reads the `okf` block of `package.json` and merges the flags over it.
  - `interactive.ts` and `non-interactive.ts` — the two modes.
  - `records.ts` — pure record logic: the candidate type, the commit message, the edits.
  - `git.ts` — every git call, relative to the repo root.
  - `repo.ts` — the file-system work on records: resolving bundles and paths, loading candidates, reading and writing records.
  - `frontmatter/` — pure functions, apart from the clock `read.ts` reads, that read and edit a record's frontmatter, exported from `index.ts`. It reads with the `yaml` package's failsafe schema, aliases resolved, and slices the frontmatter out by position, so line endings are never rewritten.
    - `types.ts` — the public types and constants (`RecordStatus`, `RefusalKind`, `Timestamp`, `VerifyRecordParams`, `RECORD_STATUSES`, `REFUSAL_KINDS`). It imports nothing, so the published declarations never import the `yaml` package's types.
    - `shared.ts` — the types, constants, and helpers the others share: parsing, splitting, positions, and the small node readers. It imports only from `types.ts`.
    - `read.ts` — `readRecordSummary`, `getRecordState`, `isGeneratedAhead`, and `findFrontmatterProblem`; reading accepts any valid YAML. The state compares whole seconds and reads the clock, since a `generated.at` ahead of it can't be judged.
    - `meaning.ts` — before any edit, `findAmbiguity` refuses a frontmatter whose meaning is ambiguous (an unresolved alias, two keys that mean the same); after it, `checkMeaning` refuses any result that isn't valid YAML or doesn't parse to the original plus the intended changes.
    - `layout.ts` — the allowlist (`readEditableLayout`), which refuses any `status` or `verified` layout outside the README's list.
    - `edit.ts` — `verifyRecord`: edits replace only the characters they change, at the positions the parser reports, all planned against one parse and applied from the end of the text. A lone CR, and an `at` `isWritableTimestamp` refuses, are refused here, each refusal with a `kind`. `findEditProblem` runs the same refusals when records are listed, so `repo.ts` reports a refused record before anyone chooses it.
  - `output.ts` — the `[okf-verify]`-prefixed output lines; `exit-codes.ts`, `outcome.ts`, and `run-context.ts` are shared types.
- `scripts/changelog.ts` — the changesets changelog formatter, tested and covered like `src/` but never published.
- `scripts/spec-watch/` — the spec watch that `spec-watch.yml` runs (see [Spec watch](#-spec-watch)), covered like `src/` and never published; `bin.ts` is its entry.
- `spec/upstream.json` — the pin: the upstream spec okf-tools supports.
- `docs/decisions/` — the repo's own OKF bundle of design decisions (see [Design decisions](#-design-decisions)).
- `test/repo.ts` — scratch git repos, fabricated records, and the shared `VERIFIED_BY` for the tests, imported as `#test/repo`.
- `test/spec-watch.ts` — a fake `fetch` that answers for GitHub and ntfy, and a fabricated upstream, for the spec watch's tests, imported as `#test/spec-watch`.
- `.changeset/` — pending changesets (see [Versioning & releases](#-versioning--releases)).
- `.github/workflows/` — `ci.yml`, `release.yml`, and `spec-watch.yml`; `.github/actions/setup/` is the shared pnpm + Node + install prelude; `.github/rulesets/main.json` protects `main`.
- `eslint-rules/` — the local `no-dotted-jsdoc-param` rule, loaded by `eslint.config.ts`.
- `dist/` — build output (gitignored), the only directory published; `CHANGELOG.md` is published beside it.

## 🎨 Code style

- **Strict TypeScript**: no `any`; exported functions declare their return type (`isolatedDeclarations` enforces it); `type` over `interface`; `import type` for type-only imports.
- **A `catch` binding is `unknown`**: narrow it with `instanceof` and `typeof`, never cast it (`readGitFailure`, `describeError`).
- **Results, not exceptions**: a step that can fail returns `{ isOk: true, … } | { isOk: false, reason }`, and only `run` turns a reason into output and an exit code.
- **Function parameters**: one positional parameter is fine; with two or more, take a single object with sorted keys.
- **Named functions are `function` declarations**; arrows are for callbacks and closures.
- **Lexicographic ordering** of everything perfectionist's `recommended-alphabetical` preset sorts; module constants are `SCREAMING_SNAKE_CASE`; boolean names read as questions, opening with an auxiliary verb (`are`, `can`, `did`, `does`, `has`, `have`, `is`, `should`, `was`, `were`, `will`): `isYes`, `shouldCommit`, `areAllVerified`.
- **Every output line starts with `[okf-verify]`**, outside the prompts; a git call sets `stdio` explicitly, so its stderr never prints over the prompts.
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
- **Issues and PRs** are assigned to `jjloneman` and labeled with a type (`✨ feature`, `🐞 bug`, `📦 dependencies`); spell the emoji-prefixed labels exactly.
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

- `ci.yml` runs on every PR and push to `main`: lint and format check, typecheck, tests on Node 22 and 26 (coverage on 26), and `pnpm lint:package`.
- On a PR it also runs `pnpm changeset status --since=origin/main`, which fails when the PR adds no changeset.
  - It skips the version PR (`changeset-release/main`), which only consumes changesets.
- `release.yml` runs on every push to `main` (see below).
- `spec-watch.yml` runs daily and on demand, never on a PR (see [Spec watch](#-spec-watch)).
- Every action is pinned to an exact `vX.Y.Z`, and every job declares its own `permissions`.
- **Every `ci.yml` job is a required check** in [.github/rulesets/main.json](.github/rulesets/main.json), by its display name; `spec-watch.yml` never runs on a PR, so it isn't one. Renaming a job or changing the test matrix means updating `required_status_checks` there and reapplying the ruleset, or every PR waits on a check that never reports.

## 🔭 Spec watch

The OKF spec has no releases or tags, so `spec-watch.yml` checks it daily against the pin in `spec/upstream.json`: the watched `repo`, the spec's `path`, the `sha` of the last commit to it that okf-tools follows, its `version`, and the `candidates` that may become its next home.

- **It reports:** new commits to the spec, a changed `**Version …**` line, the spec's file going missing, the repo archived, renamed or gone, new README or spec lines that may announce a deprecation, open upstream PRs that touch the spec, and candidates that are public.
- **It opens one issue per run**, titled with the short SHA of the newest commit to the spec, listing only what no earlier spec-watch issue reported, open or closed. Each issue records its findings' keys in a `<!-- spec-watch: … -->` marker, so keep that line when editing one.
- **It sends an ntfy push** to the topic in the `NTFY_TOPIC` Actions secret; without the secret it sends none. The topic is its only access control, so never echo it or write it in the repo.
- **The PR that closes its issue bumps the pin:** set `sha` and `version` to the commit okf-tools now follows, and re-pin every spec link to the same commit (see [Purpose of this repo](#-purpose-of-this-repo)). To stop watching a candidate, or to watch the spec's new home, edit `candidates` or `repo` and `path`.
- **Try it without writing anything:** run it from the Actions tab with `dry-run`, or locally with `GITHUB_TOKEN=$(gh auth token) GITHUB_REPOSITORY=jjloneman/okf-tools SPEC_WATCH_DRY_RUN=true node scripts/spec-watch/bin.ts`. The `sha` input (`SPEC_WATCH_SHA` locally) compares against an older commit instead of the pin; without `dry-run` that opens a real issue, whose findings later runs count as reported.
- **GitHub disables a scheduled workflow after 60 days without repo activity**, and emails the owner first; re-enable it from the Actions tab.

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

Why the package works the way it does is recorded in [docs/decisions/](docs/decisions/index.md), an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/62432a095456147ee71e70ac6e4dc0d2dea3ac30/okf/SPEC.md) v0.2 bundle that this repo signs off with its own `okf-verify` (`okf.bundles` and `okf.verifiedBy` in `package.json`).

- One Markdown file per decision, listed in [docs/decisions/index.md](docs/decisions/index.md), with tags from its vocabulary.
- **Base a record on the code and the closed threads**, not on memory: re-read the code before stating a flag, an exit code, or a fallback order, and date-stamp facts that can drift ("as of 2026-11-11").
- **An agent writes a record as `status: draft`** and records itself in `generated`, as `<producer>/<version>` (`claude-code/<claude --version>` or `claude-code/<model-id>`); it never adds a `verified` entry on its own.
- **An agent verifies only when the owner asks**, with `pnpm okf:verify --yes <paths>`, naming the files rather than passing `--changed` unless the owner asked for every changed record.
- **Check a record's `verified` before changing the behavior it describes:**
  - any `verified` entry means someone signed it off (usually `human:jjloneman`, the owner) — change the behavior only with the owner's agreement;
  - no `verified` means it is an unreviewed draft;
  - either way, update the record in the same PR as the change, and re-stamp `generated` (`by` and `at`), so a signed-off record shows as changed until it is verified again.

## 🛑 Deleting things

- Confirm with the owner before deleting anything the current task didn't create: files, branches, issues, remote state.
