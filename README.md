# ✅ okf-tools

Tools for [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) (OKF) bundles. Today that's one command, `okf-verify`, which signs records off.

## 📖 Table of contents

- [🎯 Why](#-why)
- [📦 Install](#-install)
- [🚀 Usage](#-usage)
  - [🖐️ Interactive](#️-interactive)
  - [🤖 Non-interactive](#-non-interactive)
  - [🏳️ Flags](#️-flags)
- [🧭 Agents](#-agents)
- [📚 Library](#-library)
- [🛠️ Development](#️-development)
- [📄 License](#-license)

## 🎯 Why

An agent can draft OKF records, but whether a record is settled is the owner's call.

- **OKF v0.2 reads a record with no `status` as `stable`**, so a repo that keeps drafts apart writes `status: draft` on everything an agent produces.
- **The owner moves a record to `stable`** once they've reviewed it.

`okf-verify` makes that sign-off one step:

- it sets `status: draft` to `stable` (any other status is left alone);
- it adds or renews the signer's `verified` entry with the current UTC time;
- it commits just those files, never pushing and never skipping hooks;
- it edits by targeted line replacements, never a YAML round-trip, so nothing else in a record is reformatted.

## 📦 Install

```sh
pnpm add -D @jjloneman/okf-tools
```

Then configure it in `package.json`:

```json
{
  "scripts": {
    "okf:verify": "okf-verify"
  },
  "okf": {
    "bundles": ["docs/decisions", "docs/references"],
    "verifiedBy": "human:jjloneman"
  }
}
```

- **`okf.bundles`** lists the bundle directories, relative to the repo root. Records are the `.md` files directly inside each, other than `index.md`.
- **`okf.verifiedBy`** is the OKF actor each `verified` entry names.

Both can be given on the command line instead (`--bundle`, `--by`); there is no default for either.

Node 22 or later, and git, are required.

## 🚀 Usage

### 🖐️ Interactive

```sh
pnpm okf:verify
```

- Lists the records changed on the branch (against the remote's default branch, or `main`) plus uncommitted ones, with a choice to widen to every record.
- You pick records, review the files and commit message, and confirm.
- It needs a terminal on both stdin and stdout, and refuses to start without one.

### 🤖 Non-interactive

```sh
# The records you name, relative to where you run it
pnpm okf:verify --yes docs/decisions/package-promise.md

# Every changed record that still needs a sign-off
pnpm okf:verify --yes --changed
```

- `--yes` alone is a usage error: it needs `--changed` or record paths, so nothing is ever verified by accident.
- A named record that's already verified, and unchanged since, is skipped.
- Exit codes: `0` worked, `1` failed, `2` nothing needed verifying.

### 🏳️ Flags

| Flag             | Does                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `--bundle <dir>` | A bundle to scan, relative to where you run it; repeat for more. |
| `--by <actor>`   | Who signs off, overriding `okf.verifiedBy`.                      |
| `--yes`, `-y`    | Run with no prompts; needs `--changed` or record paths.          |
| `--changed`      | With `--yes`: every changed record still needing a sign-off.     |
| `--no-commit`    | Edit the files, but leave committing to you.                     |
| `--help`, `-h`   | Print the usage.                                                 |

## 🧭 Agents

Much OKF authoring now happens in a chat with a coding agent, and the non-interactive mode exists for that:

- the owner edits a record with the agent until it meets their bar;
- then asks the agent to verify it, which it does with `--yes`.

What the agent should do:

- **Don't verify a record unless the person asks you to.** Drafting, editing, and regenerating a record never imply a sign-off.
- **Name the files** the person approved, rather than passing `--changed`, unless they asked for every changed record.
- **Sign as the person** (the configured `okf.verifiedBy`), since the approval is theirs.

A repo that wants a stricter rule can say so in its own agent instructions.

## 📚 Library

The frontmatter functions are exported too, for tools of your own:

```ts
import {
  getRecordState,
  readRecordSummary,
  verifyRecord,
} from "@jjloneman/okf-tools";
```

`run` is the CLI itself, for calling it in-process; it never throws and resolves to the exit code.

## 🛠️ Development

| Script                   | Does                                                    |
| ------------------------ | ------------------------------------------------------- |
| `pnpm check`             | Lint with fixes, format, then typecheck.                |
| `pnpm test`              | Run the tests.                                          |
| `pnpm test:coverage`     | Run them with the 100% coverage gate.                   |
| `pnpm lint:package`      | Build, then run publint and Are the Types Wrong.        |
| `pnpm okf:verify`        | Run the CLI from source.                                |
| `pnpm changeset`         | Add a changeset for the next release.                   |
| `pnpm changeset --empty` | Add an empty changeset, for a PR that releases nothing. |

See [AGENTS.md](AGENTS.md) for the conventions.

## 📄 License

[MIT](LICENSE)
