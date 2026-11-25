# ✅ okf-tools

Tools for [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md) (OKF) bundles, run as `okf <command>`. Today that's `okf verify`, which signs records off; `okf diff`, which shows what changed since a sign-off; `okf init`, which writes a repo's config and keeps a block of agent instructions current; and `okf status`, which reports where every record stands. `okf-verify` is the alias for `okf verify`, and prints its lines under its own name.

It follows OKF v0.2 as of commit [`0b87c52`](https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md) (2026-08-21) of the spec's home, `open-knowledge-format/open-knowledge-format`, and every spec link in this repo points to that commit.

## 📖 Table of contents

- [🎯 Why](#-why)
- [📦 Install](#-install)
- [🚀 Usage](#-usage)
  - [🧰 Setting up](#-setting-up)
  - [🖐️ Interactive](#️-interactive)
  - [🤖 Non-interactive](#-non-interactive)
  - [🏳️ Flags](#️-flags)
  - [🔍 Diff](#-diff)
- [📋 Status](#-status)
  - [🧾 JSON](#-json)
- [🧭 Agents](#-agents)
- [🏷️ Writing tags](#️-writing-tags)
- [📚 Library](#-library)
- [🛠️ Development](#️-development)
- [📄 License](#-license)

## 🎯 Why

An agent can draft OKF records, but whether a record is settled is the owner's call.

- **OKF v0.2 reads a record with no `status` as `stable`**, so a repo that keeps drafts apart writes `status: draft` on everything an agent produces.
- **The owner moves a record to `stable`** once they've reviewed it.

`okf verify` makes that sign-off one step:

- it sets `status: draft` to `stable` (any other status is left alone);
- it adds or renews the signer's `verified` entry with the current UTC time, writing a new entry in the record's own style (see [Install](#-install));
- it commits just those files, never pushing and never skipping hooks, and writes nothing when git would refuse that commit, such as mid-merge or for an ignored file;
- it reads frontmatter with a YAML parser but edits only the characters it changes, never a YAML round-trip, so nothing else in a record is reformatted;
- it refuses a record whose frontmatter isn't valid YAML, rather than guess where its fields end, and one whose block is almost right, such as one with no closing `---` or blanks around a fence, rather than take it for no frontmatter;
- it refuses a record that isn't valid UTF-8, as the OKF spec requires, rather than rewrite the bytes it can't read;
- it refuses a record or bundle reached through a symlink, since git commits the link, not the file it points to;
- it edits only the layouts below, and refuses any other with a reason, for a hand edit.

The layouts it edits:

- `status`, when it's `draft`: one value on one line, quoted or not (any other status is left as written, in any form);
- `verified`: absent; empty or null (`~`, `null`); one `{ by, at }` entry, inline, or a block mapping when it's the signer's; an inline list on one line; or a `-` list;
- every entry's `by`, and the signer's own `at`: one value on one line, quoted or not, empty (`at:`), or absent (a bare key with no colon, `{ by: x, at }`, is refused).

It refuses an anchor, alias, or tag on any of these, a value spread over several lines, a quoted or `?` key for `status` or `verified`, a `verified` holding a single value, and someone else's entry written as a block mapping when it's the whole `verified` value (in a `-` list it's fine). It also refuses, anywhere in the frontmatter, a carriage return that doesn't end a line, an alias whose anchor isn't set before it, and two keys that mean the same. A record it would refuse is reported when the records are listed, so it never stops the others from being written. Every other field may take any form YAML allows, and comments are fine anywhere.

## 📦 Install

```sh
pnpm add -D @jjloneman/okf-tools
```

Then configure it in `package.json`:

```json
{
  "scripts": {
    "okf:verify": "okf verify"
  },
  "okf": {
    "bundles": ["docs/decisions", "docs/references"],
    "verifiedBy": "human:jjloneman"
  }
}
```

- **`okf.bundles`** lists the bundle directories, relative to the repo root. Records are the `.md` files at any depth inside each, other than `index.md` and `log.md` at every level, which [OKF reserves](https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md#31-reserved-filenames). A bundle inside another counts each record once; a folder git ignores or that holds only ignored files, `.git`, a folder holding another clone, and a symlink to a folder are never read.
- **`okf.verifiedBy`** is the OKF actor each `verified` entry names.
- **`okf.exclude`** (optional) lists globs, relative to the repo root, of Markdown in a bundle that isn't a record, such as `["**/README.md", "docs/decisions/drafts"]`. A glob that matches a folder excludes everything in it, `*` matches dot files too, and a glob can't start with `!` (other than an extglob such as `!(drafts)`) or `/`, or end with `/`.
- **`okf.style`** is how a new `verified` entry is laid out, and is optional:
  - `match`, the default, writes it as the record writes `generated`: a block when `generated` is a block mapping, else inline;
  - `inline` always writes `{ by, at }` on one line;
  - `block` always writes `by` and `at` on lines of their own.

`okf init --bundle docs/decisions --by human:jjloneman` writes `okf.bundles` and `okf.verifiedBy` for you (see [Setting up](#-setting-up)). Both can be given on the command line instead (`--bundle`, `--by`); there is no default for either. `okf.exclude` and `okf.style` have no flag, and `okf.exclude` applies to `--bundle` too.

A block entry goes in a `-` list, even when it's the only one, since a bare block mapping can't take a second signer's entry (see the layouts above):

```yaml
verified:
  - by: human:jjloneman
    at: 2026-10-02T13:30:00Z
```

- **An inline list keeps inline entries**, whatever the style, since it can't hold a block one.
- **The new `at` is quoted as `generated.at` is**, else as the first other entry's `at`, so a record that quotes its timestamps keeps quoting them.
- **An existing entry keeps its layout**; only its `at` changes.

Node 22 or later, and git, are required.

## 🚀 Usage

- `okf --help` lists the commands, and `okf verify --help` prints the flags below; `okf diff --help` prints [its own](#-diff), and `okf status --help` prints the ones in [Status](#-status).
- `okf` with no command, or one it doesn't know, prints the command list and exits `1`.
- Options follow the command: `okf verify --yes --changed`, not `okf --yes verify --changed`.
- `okf-verify <args>` runs as `okf verify <args>` does, with the same exit codes.

### 🧰 Setting up

```sh
# Write the config and the agent block
pnpm exec okf init --bundle docs/decisions --by human:jjloneman

# Refresh the block after an upgrade; the config is kept
pnpm exec okf init

# In CI: fail when the block is missing or out of date
pnpm exec okf init --check
```

- **It writes the `okf` block of `package.json`.** `--bundle` replaces `okf.bundles`, relative to where you run it, and stored from the repo root; `--by` sets `okf.verifiedBy`. Every other key, and the rest of the file, is kept.
  - The bundles must already exist: it doesn't create folders or records.
  - With no `--bundle`, the configured bundles are kept, and it fails when there are none.
  - An actor is optional, since `okf verify --by` can name one instead.
- **It writes the agent rules to `AGENTS.md`**, between `<!-- okf:start -->` and `<!-- okf:end -->` lines, creating the file when there's none (see [Agents](#-agents) for the text).
  - A file with no block gets it at the end; a file with one gets it refreshed in place; nothing outside the markers changes.
  - `--copilot` writes it to `.github/copilot-instructions.md` too, and a file that already holds the block is always refreshed.
  - A marker missing its pair, repeated, or out of order is refused, and nothing is written.
- **`--check` writes nothing**, and exits `1` when a block is missing or out of date, or its markers are malformed.
- It never commits: review what it wrote, then commit it.
- Exit codes: `0` worked or up to date, `1` failed or out of date.

### 🖐️ Interactive

```sh
pnpm okf:verify
```

- Lists the records changed on the branch (against the remote's default branch, or `main`) plus uncommitted ones, with a choice to widen to every record.
- You pick records, review what changed in each since your last sign-off (see [Diff](#-diff)), review the files and commit message, and confirm.
- It needs a terminal on both stdin and stdout, and refuses to start without one.

### 🤖 Non-interactive

```sh
# The records you name, relative to where you run it
pnpm okf:verify --yes docs/decisions/package-promise.md

# Every changed record that still needs a sign-off
pnpm okf:verify --yes --changed
```

- `--yes` alone is a usage error: it needs `--changed` or record paths, so nothing is ever verified by accident.
- A named record that's already verified, and unchanged since, is skipped, unless that sign-off isn't committed yet, as after a hook rejected the commit: then the same command commits it as it is.
- "Where you run it" is the folder you call `pnpm` from, when that's in the package's repo. With `pnpm --dir <package>` or `npm --prefix <package>` from another repo or no repo, paths resolve from the package root instead.
- A record whose `generated.at` is ahead of the clock, as a wrong time zone writes it, fails the run until its time is fixed.
- A sign-off whose `verified.at` is ahead of the clock counts as changed, so the record is offered again, and signing it renews that entry with the real time.
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

### 🔍 Diff

```sh
pnpm exec okf diff docs/decisions/package-promise.md
```

- Prints what changed in each record you name since the signer last signed it off: the diff from the commit that set their `verified.at`, in a record not generated again after it, to the file on disk, uncommitted changes included.
  - That commit may be the one that added the record, as when `okf verify` commits a new record or a branch with a signed record is squash-merged.
  - A merge, or a branch's commits interleaved with it by date, don't hide it, and neither does git's `log.follow` or `log.showSignature`.
- When no commit shows what was signed, it says so and prints the whole record: a sign-off made by hand and not committed, or one committed in a record generated again after it, such as a sign-off restored by hand after a regeneration. A shallow clone that cuts off the sign-off's history counts too.
- Control characters in a record print as escapes, such as `\x1b`, so a record can't redraw the lines you're reviewing.
- A record the signer never signed off is printed whole, too.
- It changes nothing. `--bundle` and `--by` work as they do for `okf verify`, and `--by` picks whose sign-off to diff from.
- Every line is prefixed `[okf]`, like the rest of its output.
- The interactive `okf verify` shows the same, for each record you pick, before you confirm.
- Exit codes: `0` worked, `1` failed.

## 📋 Status

```sh
pnpm okf status
```

`okf status` lists every record's trust state in one read-only command, so you, or an agent about to change the behavior a record describes, needn't open each file to check its `verified`.

- **Each record is listed under the first group that fits it**, in this order:
  - **Changed since sign-off:** signed off, then regenerated since (its `generated.at` is later), so the sign-off no longer holds, whatever its `status`; a sign-off ahead of the clock, or one whose time can't be read, counts too;
  - **Draft:** `status: draft`, with no sign-off it has changed since;
  - **Never signed off:** no `verified` entry from the signer, and not a draft;
  - **Stale:** signed off and unchanged, but past its [`stale_after`](https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md#55-lifecycle-stale_after), the instant OKF says it goes stale;
  - **Settled:** signed off, unchanged, and not stale.
- **The signer is `okf.verifiedBy`**, or `--by`, as for `okf verify`: another actor's sign-off doesn't count.
- **It writes nothing**, and exits `0` whatever it finds: it reports, it doesn't judge. Only a usage error, a config it can't use, a named path that isn't a record, or a bundle it can't list exits `1`.
- **It reports a record `okf verify` would refuse to edit**, such as one in a layout the edits don't take, or one generated ahead of the clock, since reading it is enough.
- **A file it can't read as a record** is listed under Skipped, with why: one that can't be read, is reached through a symlink, has a near-miss frontmatter block, or isn't valid YAML.

| Flag                | Does                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `<record>...`       | List only these records, relative to where you run it.           |
| `--bundle <dir>`    | A bundle to scan, relative to where you run it; repeat for more. |
| `--by <actor>`      | Whose sign-off counts, overriding `okf.verifiedBy`.              |
| `--changed`         | Only records changed since their sign-off.                       |
| `--draft`           | Only records with `status: draft`, changed or not.               |
| `--stale`           | Only records past their `stale_after`, in any group.             |
| `--format <format>` | `text`, the default, or `json`.                                  |
| `--help`, `-h`      | Print the usage.                                                 |

- **Filters add up:** `--changed --stale` lists the records that match either.
- **`okf status --changed` is not `okf verify --changed`:** status means changed since the sign-off, and verify means changed on the branch.

### 🧾 JSON

`okf status --format json` prints one JSON document to stdout, with no `[okf]` prefix, for a program or an agent to read:

```json
{
  "records": [
    {
      "generatedAt": "2026-10-05T09:00:00Z",
      "group": "changed",
      "isStale": false,
      "path": "docs/decisions/package-promise.md",
      "staleAfter": null,
      "state": "changed",
      "status": "draft",
      "title": "What every export promises",
      "type": "Decision",
      "verifiedAt": "2026-10-02T13:30:00Z"
    }
  ],
  "schemaVersion": 1,
  "skipped": [{ "path": "docs/decisions/broken.md", "reason": "…" }],
  "verifiedBy": "human:jjloneman"
}
```

- **`records`** holds the records listed, after any filters, in the order the bundles list them; `path` is from the repo root.
- **`group`** is one of `changed`, `draft`, `unverified` (never signed off), `stale`, or `settled`.
- **`state`** is where the record stands with the signer's sign-off: `changed`, `unverified`, or `verified`, as `getRecordState` judges it, except that a `verified.at` ahead of the clock counts as `changed`, as it does for `okf verify`.
- **`isStale`** is whether the record is past its `staleAfter`, whatever its group.
- **`status`** is the `status` as written, even one OKF doesn't define; `null` means none, which OKF reads as `stable`. Every other field the record doesn't have is `null` too.
- **`skipped`** lists the files it couldn't read, and is never filtered, since their state can't be known.
- **The shape is public API.** A change to it bumps `schemaVersion`, and ships as a breaking change; a program should check it. Its TypeScript type is exported as `StatusReport`.

## 🧭 Agents

Much OKF authoring now happens in a chat with a coding agent, and the non-interactive mode exists for that:

- the owner edits a record with the agent until it meets their bar;
- then asks the agent to verify it, which it does with `--yes`.

`okf init` writes these rules into `AGENTS.md`, between its markers, and refreshes them when run again:

```md
<!-- Written by `okf init` from @jjloneman/okf-tools. Run it again to refresh this block, and keep the repo's own rules outside it. -->

## OKF records

The Markdown files in the bundles that `okf.bundles` lists in `package.json` are [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/0b87c52c6ef999286c745e19998fdfcd03d5dbee/SPEC.md) v0.2 records.

- **Write a new record as `status: draft`**, and name yourself in `generated` as `<producer>/<version>`, such as `claude-code/2.1.316`, with the UTC time you wrote it.
- **When you edit a record, re-stamp `generated`** (`by` and `at`), and set a `stable` one back to `status: draft`, keeping its `verified` entry, so it shows as changed until it's signed off again.
- **Never add or change a `verified` entry yourself.** Signing a record off is the person's call.
- **Verify only when the person asks you to**, with `okf verify --yes <record>...`, naming the files they approved.
  - Pass `--changed` instead only when they asked for every changed record.
  - Never verify a record as a side effect of drafting or editing it.
- **Write `tags` as a block list**, one `- tag` per line, sorted, in kebab-case.
  - Give each record 5 to 10 specific tags, reusing the bundle's existing tags where one fits.
```

The agent signs as the person (the configured `okf.verifiedBy`), since the approval is theirs. A repo that wants a stricter rule can say so in its own agent instructions, outside the block.

## 🏷️ Writing tags

Write a record's `tags` as a block list, one tag per line:

```yaml
tags:
  - ai-models
  - claude-code
  - git
```

- **Prettier rewraps a long one-line list.** At its default width of 80, `tags: [a, b, c, …]` past 80 characters becomes one bracket and one tag per line, so a one-line list caps a record at about 7 short tags.
- **A block list holds at any length**, with no Prettier config in the bundle, and adding a tag is a one-line diff.
- **Any valid layout still works**: okf-tools reads flow and block lists alike.

The full reasoning is in [How a record's tags are laid out](docs/decisions/tags-layout.md).

## 📚 Library

The frontmatter functions are exported too, for tools of your own:

```ts
import {
  findEditProblem,
  findFrontmatterProblem,
  getRecordState,
  readRecordSummary,
  verifyRecord,
} from "@jjloneman/okf-tools";
```

- `verifyRecord` takes an optional `style`, one of `ENTRY_STYLES` (`match`, `inline`, `block`), as `okf.style` describes, `match` when not given.
- `verifyRecord` takes the sign-off's `at` as RFC 3339 profiles ISO 8601: a date, `T`, a time to the minute or finer, and a zone, such as `2026-10-02T13:30:00Z` or `2026-10-02T15:30+02:00`. It refuses any other, so every sign-off it writes can be dated.
- A refusal has a `kind` to switch on, one of `REFUSAL_KINDS` (`invalidParams`, `invalidYaml`, `noFrontmatter`, `unsupportedLayout`), beside its `reason` in words.
- `readRecordSummary` reads what it can even of frontmatter that isn't valid YAML; `findFrontmatterProblem` says when it isn't, or when a block is almost right, and `findEditProblem` says why `verifyRecord` would refuse a record.
- A summary's `status` is a status OKF defines, or `undefined`; `writtenStatus` is the status as written, `undefined` when there's none (or it's empty or null).
- `getRecordState` needs only a summary's `generatedAt` and `verifiedAt` (`RecordTimes`), and never reads the clock: a `generated.at` ahead of it is judged like any other.

- A summary's `staleAfter` is the record's `stale_after` as written, or `undefined`.
- `StatusReport`, with `StatusRecord`, `StatusGroup`, and `StatusSkipped`, types what `okf status --format json` prints.

`run` is the CLI itself, for calling it in-process; it never throws and resolves to the exit code. Its `program` is `okf` or `okf-verify`, which takes the command as the first argument or not, and runs as `okf-verify` when left out.

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

This repo dogfoods the tool: its design decisions are an OKF bundle in [docs/decisions/](docs/decisions/index.md), signed off with `pnpm okf:verify`.

See [AGENTS.md](AGENTS.md) for the conventions.

## 📄 License

[MIT](LICENSE)
