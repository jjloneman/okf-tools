# 🤖 AGENTS.md

Conventions for any AI agent (or human) working in this repo. Read top to bottom before editing.

## 🎯 Purpose of this repo

`@jjloneman/okf-tools` is a small, public npm package of tools for [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundles. Today it ships `okf-verify`, which signs records off (see [README.md](README.md)).

- **Interactive by default.** Without `--yes`, it prompts in a terminal and refuses to start without one.
- **`--yes` runs without prompts**, but only against an explicit selection: `--changed`, or named record paths. `--yes` alone is a usage error.
- **Verification is the person's call.** An agent runs `--yes` only when the person has asked it to verify those records, naming the files rather than passing `--changed` unless they asked for all of them. Never verify a record as a side effect of drafting or editing it.
- **It never pushes and never passes `--no-verify`** to git, in either mode.

## 🗂️ Project layout

- `src/` — the package, one concern per file, each with its `*.test.ts` beside it.
  - `bin.ts` — the `okf-verify` entry: reads the process, calls `run`, sets the exit code.
  - `cli.ts` — `run`: parses the arguments, resolves the repo, config, and bundles, then dispatches to a mode. It never throws.
  - `options.ts` — the flags, the usage text, and which combinations are valid.
  - `config.ts` — reads the `okf` block of `package.json` and merges the flags over it.
  - `interactive.ts` and `non-interactive.ts` — the two modes.
  - `records.ts` — pure record logic: the candidate type, the commit message, the edits.
  - `repo.ts` — every git and file-system call, relative to the repo root.
  - `okf-frontmatter.ts` — pure functions that read and edit a record's frontmatter, exported from `index.ts`; `lines.ts` is its total line reader.
  - `output.ts` — the `[okf-verify]`-prefixed output lines; `exit-codes.ts` and `run-context.ts` are shared types.
- `scripts/changelog.ts` — the changesets changelog formatter, tested and covered like `src/` but never published.
- `test/repo.ts` — scratch git repos and fabricated records for the tests, imported as `#test/repo`.
- `.changeset/` — pending changesets (see [Versioning & releases](#-versioning--releases)).
- `.github/workflows/` — `ci.yml` and `release.yml`; `.github/actions/setup/` is the shared pnpm + Node + install prelude; `.github/rulesets/main.json` protects `main`.
- `eslint-rules/` — the local `no-dotted-jsdoc-param` rule, loaded by `eslint.config.ts`.
- `dist/` — build output (gitignored), the only directory published.

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
- **Issues and PRs** are assigned to `jjloneman` and labeled with a type (`✨ feature`, `🐞 bug`, `📦 dependencies`); spell the emoji-prefixed labels exactly.
- **PRs are squash-merged**, so the PR title becomes the commit on `main`.
- **`main` is protected** by [.github/rulesets/main.json](.github/rulesets/main.json): changes land through a squash-merged PR, unresolved review threads block the merge, every CI job must pass, and there are no force pushes or deletion. After editing the file, reapply it with `gh api --method PUT repos/jjloneman/okf-tools/rulesets/<id> --input .github/rulesets/main.json`.
- **AI-written text on GitHub opens with a disclaimer banner**: `> **🤖 Disclaimer**: This description was generated with AI. (**Model**: _<model name and version>_)`, with "comment" in place of "description" for a comment.

## 🧪 Testing

- `pnpm test` runs the suite; `pnpm test:coverage` adds the gate: **100%** statements, branches, functions, and lines across `src/` and `scripts/`.
- A branch nothing can reach is dead code to delete, not a line to exempt; no coverage-ignore comments.
- Tests that need git run it for real, in a scratch repo from `#test/repo`; only a machine state no test machine has (no git binary) is mocked.
- The prompts are tested with `@clack/prompts` mocked; everything after the prompts runs for real.
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
- Every action is pinned to an exact `vX.Y.Z`, and every job declares its own `permissions`.
- **Every job is a required check** in [.github/rulesets/main.json](.github/rulesets/main.json), by its display name. Renaming a job or changing the test matrix means updating `required_status_checks` there and reapplying the ruleset, or every PR waits on a check that never reports.

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

## 🛑 Deleting things

- Confirm with the owner before deleting anything the current task didn't create: files, branches, issues, remote state.
