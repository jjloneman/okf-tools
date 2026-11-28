# ✅ okf-tools

Tools for [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) (OKF) bundles, run as `okf <command>`. Today that's `okf verify`, which signs records off; `okf diff`, which shows what changed since a sign-off; `okf init`, which writes a repo's config and keeps a block of agent instructions and the okf skills current; `okf status`, which reports where every record stands; `okf index`, which keeps each `index.md` in step with its records; `okf tags`, which lists every tag with its record count; `okf migrate`, which moves a v0.1 or v0.2 bundle to v0.3; `okf check`, which reports problems against the spec's rules; and `okf format`, which fixes the ones with one obvious fix. `okf-verify` is the alias for `okf verify`, and prints its lines under its own name.

It follows OKF v0.3 as of commit [`527e81a`](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) (2026-11-18) of the spec's home, `open-knowledge-format/open-knowledge-format`, and every spec link in this repo points to that commit. `okf --version` prints the installed version and the OKF version it follows.

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
- [🗂️ Index](#️-index)
  - [🔖 Tag index](#-tag-index)
- [✏️ New and touch](#️-new-and-touch)
- [🪦 Deprecate](#-deprecate)
- [🚚 Migrate](#-migrate)
- [🩺 Check](#-check)
  - [🤖 In GitHub Actions](#-in-github-actions)
  - [📏 Rules](#-rules)
  - [🔏 Trust rules](#-trust-rules)
  - [🏠 House rules](#-house-rules)
- [🧭 Agents](#-agents)
  - [🧩 Skills](#-skills)
- [🏷️ Writing tags](#️-writing-tags)
  - [🎯 Choosing tags](#-choosing-tags)
  - [🔢 Listing tags](#-listing-tags)
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
- it takes out `x-okf-restamp-reason`, the reason `okf touch --reason` gave for a re-stamp, with its whole line, so an old reason never outlives the review it was written for; it refuses one in a flow mapping, or with an anchor or tag before its key;
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

- **`okf.bundles`** lists the bundle directories, relative to the repo root. Records are the `.md` files at any depth inside each, other than `index.md` and `log.md` at every level, which [OKF reserves](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#31-reserved-filenames). A bundle inside another counts each record once; a folder git ignores or that holds only ignored files, `.git`, a folder holding another clone, and a symlink to a folder are never read.
- **`okf.verifiedBy`** is the OKF actor each `verified` entry names.
- **`okf.exclude`** (optional) lists globs, relative to the repo root, of Markdown in a bundle that isn't a record, such as `["**/README.md", "docs/decisions/drafts"]`. A glob that matches a folder excludes everything in it, `*` matches dot files too, and a glob can't start with `!` (other than an extglob such as `!(drafts)`) or `/`, or end with `/`.
- **`okf.drafts`** (optional) is how `okf check` reports a record still `status: draft`: `allow` says nothing, `warn` makes it a warning, and `block` an error, for a branch that must not merge drafts. Unset, it's a notice.
- **`okf.rules`** (optional) turns on the house rules `okf check` runs, each `off`, `warn` or `error`, or `[level, { options }]` for one that takes options, as ESLint takes them (see [House rules](#-house-rules)). Every one is off until named.
- **`okf.style`** is how a new `verified` entry is laid out, and is optional:
  - `match`, the default, writes it as the record writes `generated`: a block when `generated` is a block mapping, else inline;
  - `inline` always writes `{ by, at }` on one line;
  - `block` always writes `by` and `at` on lines of their own.

`okf init --bundle docs/decisions --by human:jjloneman` writes `okf.bundles` and `okf.verifiedBy` for you (see [Setting up](#-setting-up)). Both can be given on the command line instead (`--bundle`, `--by`); there is no default for either. `okf.drafts`, `okf.exclude`, `okf.rules` and `okf.style` have no flag, and `okf.exclude` applies to `--bundle` too.

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

- `okf --help` lists the commands, and `okf verify --help` prints the flags below; `okf diff --help` prints [its own](#-diff), `okf status --help` prints the ones in [Status](#-status), `okf index --help` the ones in [Index](#️-index), `okf tags --help` the ones in [Listing tags](#-listing-tags), `okf new --help` and `okf touch --help` the ones in [New and touch](#️-new-and-touch), `okf deprecate --help` the ones in [Deprecate](#-deprecate), and `okf migrate --help` the ones in [Migrate](#-migrate).
- `okf --version` prints the installed version and the OKF version it follows, such as `okf-tools 0.1.0 (OKF v0.3)`.
- `okf guide` prints the guidance for agents (see [Agents](#-agents)).
- `okf` with no command, or one it doesn't know, prints the command list and exits `1`.
- Options follow the command: `okf verify --yes --changed`, not `okf --yes verify --changed`.
- `okf-verify <args>` runs as `okf verify <args>` does, with the same exit codes.

### 🧰 Setting up

```sh
# Write the config, the agent block, and the skills
pnpm exec okf init --bundle docs/decisions --by human:jjloneman

# Refresh the block and the skills after an upgrade; the config is kept
pnpm exec okf init

# In CI: fail when the block or a skill is missing or out of date
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
- **It writes the okf skills to `.claude/skills/<name>/SKILL.md`** (see [Skills](#-skills)), whole, rewriting a skill an earlier `okf init` wrote.
  - A `SKILL.md` there that it didn't write is refused, and nothing is written.
- **`--check` writes nothing**, and exits `1` when a block or a skill is missing or out of date, a block's markers are malformed, or a skill there isn't its own.
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
- With `--stale-in <duration>`, each record signed off gets a `stale_after` that long after its sign-off, replacing any it has; `okf status` reports it as stale from then on. Without it, a record's `stale_after` is left as it is.
  - The duration is ISO 8601, such as `P90D` or `P6M`, added in the calendar, so a month from January 31 is February 28.
  - `stale_after` is written in UTC to the second, after `verified`, as OKF v0.3's absolute instant.
- Exit codes: `0` worked, `1` failed, `2` nothing needed verifying.

### 🏳️ Flags

| Flag                    | Does                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `--bundle <dir>`        | A bundle to scan, relative to where you run it; repeat for more.              |
| `--by <actor>`          | Who signs off, overriding `okf.verifiedBy`.                                   |
| `--yes`, `-y`           | Run with no prompts; needs `--changed` or record paths.                       |
| `--changed`             | With `--yes`: every changed record still needing a sign-off.                  |
| `--no-commit`           | Edit the files, but leave committing to you.                                  |
| `--stale-in <duration>` | Set each record's `stale_after` that long after its sign-off, such as `P90D`. |
| `--help`, `-h`          | Print the usage.                                                              |

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
  - **Stale:** signed off and unchanged, but past its [`stale_after`](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md#55-lifecycle-stale_after), the instant OKF says it goes stale;
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
      "tier": "unverified",
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
- **`tier`** is the record's trust tier as OKF v0.3 names and calculates it, so a tool that reads v0.3's tiers needn't translate:
  - it counts each actor's latest `verified` event, not only the signer's, when it's at or after `generated.at`, compared to the second;
  - `human-reviewed` when one of them is from a `human:` actor, `machine-confirmed` when they're all from other actors, `team:` included, and `unverified` when there are none;
  - an event ahead of the clock doesn't count, a missing or unreadable `generated.at` lets every other event count, and otherwise one whose `at` can't be read doesn't, as `state` judges them.
- **`status`** is the `status` as written, even one OKF doesn't define; `null` means none, which OKF reads as `stable`. Every other field the record doesn't have is `null` too.
- **`skipped`** lists the files it couldn't read, and is never filtered, since their state can't be known.
- **The shape is public API.** A change to it bumps `schemaVersion`, and ships as a breaking change; a program should check it. Its TypeScript type is exported as `StatusReport`.

## 🗂️ Index

```sh
# Rewrite each index.md's record lines from the records
pnpm okf index

# In CI: fail when an index is out of date
pnpm okf index --check
```

An `index.md` line repeats its record's title and description, so the two drift apart. `okf index` rewrites those lines from each record's frontmatter.

- **A record line is a top-level list item that opens with a link to a record:** `- [Title](file.md) - description`.
  - The link text becomes the record's `title`, escaped, or its file name when it has none.
  - What follows becomes the `description`, on one line, after the separator the line already uses, such as `-` or `—`.
  - The link's target, and anything indented under the line, are kept.
- **Each run of record lines is sorted by title, ignoring case**, so a grouped index keeps each record under the heading it's already in.
- **A record no line lists is added** to the first run, or under the first heading when the index has none.
  - The index that lists a record is the nearest `index.md` in its folder or a folder above it, inside the bundle.
  - A record another list line already links to, nested, numbered, or in another case, isn't added again.
- **A line linking to a Markdown file in the index's folder that's gone is dropped**, since its record was removed, even from a committed index that no longer lists any record; one with lines indented under it is kept, since those are yours.
- **Everything else is kept as written:** the frontmatter, such as a root index's `okf_version`, headings, prose, fenced code, and list lines that link to anything but a record.
- **It edits only `index.md` files that exist**, and never writes an index's own prose or headings.
- **An index listing a record it can't read is refused**, with why, since its line can't be written; so is a symlinked index.
- **`--check` writes nothing**, and exits `1` when an index is out of date, for CI.

### 🔖 Tag index

Between two marker lines, `okf index` also keeps a list of every tag the index's records carry, each with the records that carry it:

```md
<!-- tag-index:start -->

- `cli` — The command line: flags, selections, and output.
  - [How okf-tools lays out its commands](command-layout.md)
- `json` — Output for programs to read.
  - _No records yet._

<!-- tag-index:end -->
```

- **Tags are sorted, and each one's records by title.**
- **A tag's meaning is kept** from the line already there: write it after the tag and a dash, and later runs leave it.
- **A tag no record carries any longer stays**, with a placeholder line, so the vocabulary never loses a tag unseen; delete its line to drop it.
- **Markers that aren't one start before one end refuse the index**; markers quoted in fenced code don't count.

| Flag             | Does                                                             |
| ---------------- | ---------------------------------------------------------------- |
| `--bundle <dir>` | A bundle to sync, relative to where you run it; repeat for more. |
| `--check`        | Write nothing; exit `1` when an index is out of date.            |
| `--help`, `-h`   | Print the usage.                                                 |

## ✏️ New and touch

```sh
# Start a draft record, listed in its index
pnpm okf new docs/decisions/caching.md --type Decision \
  --by claude-code/2.1.316 --title "How results are cached" \
  --description "One sentence on what was decided." --tag cache --tag cli

# Re-stamp records after editing them, setting stable ones back to draft
pnpm okf touch docs/decisions/caching.md --by claude-code/2.1.316 --draft

# Re-stamp a record whose text still holds, saying why
pnpm okf touch docs/decisions/caching.md --by claude-code/2.1.316 --draft \
  --reason "checked against the new cache API, and nothing it says changed"
```

`generated.at` says when a record last changed, so a time typed by hand, or forgotten, makes a signed-off record look changed, or an edited one look signed off. Both commands take it from the clock instead, and neither has a flag for it.

- **`okf new` writes only the frontmatter**: `type`, then `title`, `description`, and `tags` when given, `status: draft`, and `generated: { by, at }`; you write the body.
  - Tags are written as a block list, sorted, each once.
  - The path must be a record's in a bundle, in a folder that exists, with nothing there yet, not even a symlink.
  - It then syncs the `index.md` that lists the record, as `okf index` does (see [Index](#️-index)); with no index in its folder or above, it writes the record alone.
  - It writes nothing when that index can't be synced, and removes the record again if writing the index fails.
- **`okf touch` re-stamps `generated`**: `by` from `--by` and `at` from the clock, adding either, or `generated` itself after `status`, when it's missing.
  - With `--draft`, a `stable` record goes back to `status: draft`; any other status is kept.
  - With `--reason "<why>"`, it writes `x-okf-restamp-reason: <why>` at the end of the frontmatter, where the `key-order` rule never flags it, in place of any; `okf check` quotes it in the draft's `T001`, for a re-stamp whose text didn't change, which no cited source explains, or any other. Without `--reason`, it takes out any reason an earlier re-stamp wrote, since a reason explains only the stamp it came with, and `okf verify` takes it out on sign-off.
  - It edits in place, as `okf verify` does, keeping every other byte, and refuses a record whose frontmatter it can't edit safely, such as a `generated` that isn't a mapping.
  - It writes nothing when any record refuses.
- **Neither adds or changes `verified`, and neither commits.**
- `--by` must be an actor, such as `claude-code/2.1.316`; it names who wrote the record, not who signs it off.
- Exit codes: `0` worked, `1` failed.

| Flag                   | Does                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `--by <producer>`      | Who wrote or edited the record. Required.                              |
| `--type <type>`        | `okf new`: the record's `type`. Required.                              |
| `--title <title>`      | `okf new`: its `title`.                                                |
| `--description <text>` | `okf new`: its `description`.                                          |
| `--tag <tag>`          | `okf new`: a tag; repeat for more.                                     |
| `--draft`              | `okf touch`: set a `stable` record back to `status: draft`.            |
| `--reason <why>`       | `okf touch`: say why, in one line, as `x-okf-restamp-reason`.          |
| `--bundle <dir>`       | A bundle the records are in, relative to where you run it; repeatable. |
| `--help`, `-h`         | Print the usage.                                                       |

## 🪦 Deprecate

```sh
# Retire a record that another replaces, keeping it for links and history
pnpm okf deprecate docs/decisions/caching.md --by claude-code/2.1.316 \
  --superseded-by docs/decisions/cache-layers.md
```

OKF v0.3 retires a record by keeping the file with `status: deprecated`, and names the record that replaces it, if any, in `superseded_by`, so links and stored paths to the old one still lead somewhere.

- **It sets `status: deprecated`**, whatever the status was, adding `status` at the end of the frontmatter when there's none.
- **`--superseded-by <record>` sets `superseded_by`** to the record that replaces it, written from the bundle root with a leading `/`, which v0.3 reads the same from any folder in the bundle.
  - The replacement must be a record in the same bundle as every record it replaces, and not one of them.
  - Without it, any `superseded_by` is left as it is.
- **It re-stamps `generated`** as `okf touch` does, since a deprecation changes what the record means to its readers: a signed-off record shows as changed until it's signed off again, and signing it off keeps it deprecated.
- It edits in place, keeping every other byte, never adds or changes `verified`, never commits, and writes nothing when any record refuses.
- Exit codes: `0` worked, `1` failed.

| Flag                       | Does                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `--by <producer>`          | Who deprecated the record, an actor. Required.                         |
| `--superseded-by <record>` | The record that replaces it, in the same bundle.                       |
| `--bundle <dir>`           | A bundle the records are in, relative to where you run it; repeatable. |
| `--help`, `-h`             | Print the usage.                                                       |

## 🚚 Migrate

```sh
# Print what moving each bundle to OKF v0.3 would change
pnpm okf migrate

# Apply it
pnpm okf migrate --write

# In CI: fail while a bundle still needs migrating
pnpm okf migrate --check
```

OKF v0.3 reads a path without a leading `/` from the folder of the file that holds it, where v0.2's examples wrote path fields from the bundle root. Bumping `okf_version` alone would quietly change what those paths name, so `okf migrate` rewrites them in the same step.

- **It migrates a bundle that declares `okf_version` 0.1 or 0.2, or none**, which it reads as 0.2; one already on 0.3 is left alone, so a second run plans nothing.
- **In the bundle's root `index.md`, it sets `okf_version: "0.3"`**, and fills in a missing `title` and `description` from the first heading and the paragraph right after it, saying what it filled in.
- **A bare path that names a file only from the bundle root is rewritten** to the relative path that names the same file from its own folder: `references/calc.sql` in `metrics/revenue.md` becomes `../references/calc.sql`.
  - That covers the path fields `resource`, `sources[].resource`, `computation`, `executor.resource`, `attester.resource`, and `superseded_by`, and every Markdown link and link reference in a record's body, and in every other Markdown file in a subfolder that git doesn't ignore, such as a folder's `index.md` or `log.md`.
  - A `#fragment` or `?query` is kept on the rewritten path.
  - A path that is `.` or starts with `/`, `./`, or `../`, a URL, a bare fragment, a footnote, and anything in fenced or inline code are never touched.
  - A link that already names a file from its own folder is kept, even when the root holds a file of the same name, since v0.2 read links from their own folder too.
  - A record at the bundle root reads a bare path the same under both rules, so it never changes.
- **It never touches `generated` or `verified`**, since v0.3 re-stamps `generated.at` only for a change in meaning, so a signed-off record stays signed off.
- **Every other character is kept as written**, quoting and line breaks included; each edit replaces only the path, by position.
- **It reports what needs a person**, as `Check:` lines, without changing it:
  - a bare path that names no file under either rule;
  - an index with no heading or paragraph to fill `title` or `description` from, or with one of them present but empty;
  - a v0.1 `timestamp` or `# Citations` list, which v0.3 no longer reads.
- **It refuses a bundle, as `Blocked:` lines, and changes none of it** when:
  - a path field names one file from the bundle root and another from its own folder;
  - the bundle has no root `index.md` to declare the version in;
  - it declares a version newer than 0.3, or one that isn't `<major>.<minor>`;
  - a record, or a folder's `index.md` or `log.md`, can't be read or is a symlink;
  - its frontmatter uses YAML anchors or aliases where a value would change.
- **`--write` is all or nothing for each bundle**: the root `index.md`, which declares v0.3, is written last, and a failed write restores the files already written.
- **It exits `1`** when a bundle is refused, or under `--check` when one still needs migrating; otherwise `0`.

| Flag             | Does                                                                |
| ---------------- | ------------------------------------------------------------------- |
| `--bundle <dir>` | A bundle to migrate, relative to where you run it; repeat for more. |
| `--write`        | Apply the changes; without it, print them as diffs.                 |
| `--check`        | Write nothing; exit `1` when a bundle still needs migrating.        |
| `--help`, `-h`   | Print the usage.                                                    |

## 🩺 Check

```sh
# Report problems in the bundles against OKF's spec rules
pnpm okf check

# In CI: fail on warnings too
pnpm okf check --strict

# On a pull request: report only what the branch changed
pnpm okf check --changed

# Fix what has one obvious fix, then report the rest
pnpm okf format
```

`okf check` reads every Markdown file in the bundles that git would track, records, `index.md` and `log.md` alike, and reports what breaks the [spec](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md)'s rules, and whether each record's sign-off still holds. It writes nothing unless `--fix` (see [Fixes](#-fixes)).

```text
[okf] docs/decisions/log.md:5: error E005 log-date-heading: a log.md date heading must be YYYY-MM-DD (§9); found "May 1"
[okf] 12 files checked: 1 error, 0 warnings, 0 info.
```

- **Each finding names its file, line, severity, code, and rule.**
  - The codes and severities are those of upstream's own checker, `validate.py` in the spec repo's `okf-generate` skill, so both tools report a finding the same way.
- **An `error` breaks the bundle's conformance**, as §11.1 defines it: frontmatter that doesn't parse as a YAML mapping, and an `index.md` or `log.md` that breaks §8 or §9.
- **A `warning` is a value the spec's other sections advise against**, such as a timestamp without an offset or an unknown `status`; the bundle still conforms.
- **`info` needs no fix**, such as a record past its `stale_after`, and never fails the run.
- **The trust rules judge each record's sign-off**, which no general OKF checker does (see [Trust rules](#-trust-rules)), and the house rules a repo turns on check conventions the spec leaves open (see [House rules](#-house-rules)).
  - A sign-off is current as OKF v0.3 counts one: at or after `generated.at`, to the whole second, and not ahead of the clock.
- **A record whose body changed since the base branch under a sign-off from before the change that still counts is an error** (`T006`), as when `generated.at` wasn't re-stamped.
  - The base is where the branch left `origin/HEAD`, else `origin/main`, else `main`, as for `okf verify --changed`; with none, uncommitted changes are compared with `HEAD`.
  - In CI, fetch the base branch, such as with `actions/checkout`'s `fetch-depth: 0`: a shallow checkout has no base, so the gate sees no change.
  - A sign-off made on the branch, after the change, covers it.
- **A record whose `sources` cite a file in the repo warns when the file changed in a commit outside the history of the record's re-stamps and sign-offs** (`T007`), and fails when it no longer exists (`T008`).
  - A `resource` counts when it resolves by §6's rules to a path in the repo, in the bundle or not, such as `../../src/check.ts` for code the record describes; a URL and a scope descriptor are skipped.
  - A change is a commit to the file that isn't in the history of a commit that re-stamped or signed off the record, changing its `generated` or `verified`, or uncommitted changes to it, so a rebase that re-dates a branch's commits doesn't warn, and a branch merged after the record's re-stamp does. A commit that re-stamped the record too doesn't count, so a pull request that updates both passes.
  - An edit to the record that changes neither, such as to `tags` alone or an `okf format`, doesn't count as having seen the file, and neither does a merge that only took one side's re-stamp. A commit that added the record counts, a `git mv` included, since git's history of a path doesn't follow a rename.
  - While the record's own `generated` or `verified` differs from `HEAD`'s, both readable, as an uncommitted re-stamp from `okf touch` leaves it, uncommitted changes to the file don't count, and a commit counts only when it's also later than both `generated.at` and the latest sign-off; a record no commit re-stamped or signed off, such as one not committed yet, is judged by that time alone. An uncommitted edit that changes neither, such as an `okf format` fix, is judged as its commit will be.
  - It works at file level, so it stays a warning: whether the prose still holds is the reviewer's call.
  - It reads the history git has, so in CI fetch it all, as for `T006`: in a shallow checkout the oldest commit seems to change every file, the record included, so it doesn't count.
- **`--changed` reports only on the files changed since the base branch**, from the branch diff and `git status`, and on the records whose `sources` cite a file the branch changed, for a pull request's check. Without a base to diff against, it says so on stderr and reports on uncommitted changes alone.
- **It reads frontmatter as `okf verify` does**, so the two never disagree about a record.
- **A key the spec doesn't define passes without a finding**, so a repo can use okf-tools beside a tool that adds its own keys.
- **It skips what OKF leaves out of a bundle:** files and folders whose names start with `.`, and symlinks that lead out of the bundle; it skips what `okf.exclude` matches too.
- **It exits `1` on an error, or a file it can't read,** and under `--strict` on a warning too; otherwise `0`.
- **In GitHub Actions, text findings print as annotations too**, on the files they name, so they show on a pull request's diff; each still prints as a line, since GitHub shows only so many annotations.
- **`--format json` prints the report for a program**, with `schemaVersion`, `filesChecked`, `counts`, `findings`, and `skipped`. A finding that names cited sources, as `T001` can, lists them in `sources`, each with its `path` from the repo root and its `resource` as written; `schemaVersion` 2 added it. Its shape is public API: a change to it bumps `schemaVersion`, and its TypeScript type is exported as `CheckReport`.

| Flag                   | Does                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--bundle <dir>`       | A bundle to check, relative to where you run it; repeat for more.                                                               |
| `--changed`            | Report only on what changed since the base branch.                                                                              |
| `--fix`                | Fix what has one obvious fix first, then report the rest.                                                                       |
| `--format <format>`    | `text`, the default, or `json`.                                                                                                 |
| `--review-file <file>` | Write each draft's `T001` to `<file>` as JSON for `okf review-comments`, and leave it out of the annotations; text format only. |
| `--strict`             | Exit `1` on a warning too.                                                                                                      |
| `--help`, `-h`         | Print the usage.                                                                                                                |

### 🤖 In GitHub Actions

This repo publishes a reusable workflow that runs `okf check` on another repo's bundles, so each repo needn't copy the same job:

```yaml
jobs:
  okf:
    name: 📚 OKF records
    permissions:
      contents: read
    uses: jjloneman/okf-tools/.github/workflows/okf-check.yml@<commit SHA> # <release tag>
```

- **Pin it by a full commit SHA**, with the release tag in a comment, so Renovate can update both.
- **It checks out the full history**, and diffs against the branch a pull request targets, or the default branch on a push, so the `--changed` gate sees every change the branch made.
  - On a push to the default branch itself, `--changed` has nothing to compare, so it checks no files; set `changed: false` to check them all.
- **By default it runs the `okf` the repo's own pnpm lockfile installs**, so the version that checks CI is the one that signs records off locally.
  - It reads the pnpm version from `packageManager` in `package.json`, which that path needs.
  - Set `okf-version` to run a version from npm instead, for a repo without pnpm or without okf-tools in its dependencies.
- **Grant the calling job `contents: read`;** the workflow asks for nothing more, unless `review-comments` is on.
- **Its status check is named `<calling job's name> / 🩺 OKF check`**, such as `📚 OKF records / 🩺 OKF check`; a required check names it that way.
- **Findings print as annotations** on the pull request's diff, as `okf check` does in any GitHub Actions run.
- **`review-comments: true` posts each draft's `T001` as a review comment instead**, on the record's file, so the owner can reply to it, and resolve it to acknowledge that the record merges as a draft.
  - Grant the calling job `contents: write` and `pull-requests: write` too, since resolving a thread needs both; the comments job, `💬 OKF review comments`, takes the calling job's permissions, and the check job still reads only.
  - Each cited source a comment names links to its file in the pull request's diff, the Files changed tab, when the pull request changes it.
  - A later run edits its own comment, found by a hidden marker, rather than posting again. A resolved thread stays resolved until the record changes again, and an open one whose draft is gone, as when the record was signed off, is resolved.
  - With a ruleset that requires conversations to be resolved, a draft merges only once someone has resolved its thread. Errors, such as `T006`, still fail the check.
  - A pull request from a fork, any other event, a draft the pull request doesn't change, and a comment GitHub refuses fall back to annotations.
  - The check job runs `okf check --review-file`, and the comments job `okf review-comments`, from the same okf: the repo's own, or `okf-version`. Both need a version of okf-tools that has them.
  - `okf review-comments <file>` posts what `okf check --review-file` wrote, reading `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_EVENT_PATH`, and `GITHUB_SERVER_URL` for the links, as a GitHub Actions job sets them. It exits `1` only when it can't read the file, or the file isn't a list of findings. A run whose pull request has moved on to a newer push annotates its drafts instead, leaving them to the newer run.

| Input             | Does                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `bundles`         | Bundle directories to check, one per line. Empty, the default, reads `okf.bundles` from `package.json`.  |
| `changed`         | Report only on the files the branch changed, as `--changed` does. `true` by default.                     |
| `node-version`    | The Node version to run on, as `actions/setup-node` reads it. `lts/*` by default.                        |
| `okf-version`     | A version of `@jjloneman/okf-tools` to run from npm. Empty, the default, runs the repo's own.            |
| `review-comments` | Post each draft's `T001` as a pull request review comment, instead of an annotation. `false` by default. |
| `strict`          | Fail on warnings too, as `--strict` does. `false` by default.                                            |

### 📏 Rules

| Code | Rule                          | Severity | Finds                                                                                                                                                 |
| ---- | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| E002 | `frontmatter-parses`          | error    | Frontmatter that isn't valid YAML, isn't a mapping, or has a near-miss fence (§4).                                                                    |
| E004 | `subfolder-index-frontmatter` | error    | An `index.md` below the bundle root with frontmatter (§8).                                                                                            |
| E005 | `log-date-heading`            | error    | A `log.md` `##` heading that isn't a real `YYYY-MM-DD` date (§9).                                                                                     |
| E006 | `log-frontmatter`             | error    | A `log.md` with frontmatter (§9).                                                                                                                     |
| E007 | `frontmatter-unique-keys`     | error    | A key given twice in one mapping (§4).                                                                                                                |
| I201 | `stale`                       | info     | A record past its `stale_after` (§5.5).                                                                                                               |
| I204 | `no-current-verification`     | info     | A record whose every `verified` event is older than its `generated.at`, which consumers read as unverified (§5.3); not a draft, which `T001` reports. |
| W101 | `timestamp-format`            | warning  | A `generated.at`, `verified[].at`, or `stale_after` that's neither a date-time with an offset nor a date (§5).                                        |
| W102 | `generated-shape`             | warning  | A `generated` that isn't a mapping with a `by` (§5.2).                                                                                                |
| W103 | `actor-format`                | warning  | A `generated.by` or `verified[].by` in neither actor form (§7).                                                                                       |
| W104 | `verified-event-shape`        | warning  | A `verified` event without both `by` and `at`, which consumers ignore (§5.2).                                                                         |
| W105 | `status-value`                | warning  | A `status` other than `draft`, `stable`, or `deprecated` (§5.4).                                                                                      |
| W108 | `footnote-source`             | warning  | A footnote whose label is no `sources` entry's `id` (§5.1).                                                                                           |
| W110 | `tags-list`                   | warning  | `tags` written as one string or a mapping, not a list (§4.1).                                                                                         |
| W115 | `link-target`                 | warning  | A link in a record or an `index.md` to a path in the bundle that doesn't exist, such as a deleted record's (§6.1).                                    |
| W116 | `path-target`                 | warning  | A `superseded_by` that resolves to no file, or a root `license` that's neither SPDX nor a file (§6.2, §8.1).                                          |
| W117 | `string-quoted`               | warning  | A `type`, `title`, `description`, `status`, or `okf_version` YAML would read as a number or boolean (§4).                                             |
| W118 | `log-date-order`              | warning  | A `log.md` date heading newer than the one before it (§9).                                                                                            |
| W119 | `path-root-fallback`          | warning  | A bare `superseded_by` that resolves only from the bundle root, through v0.2's fallback; write it with a `/` (§6.2).                                  |
| W120 | `not-a-concept`               | warning  | Markdown with no frontmatter, or no `type`, which consumers skip (§3.2).                                                                              |
| W122 | `date-only-trust-time`        | warning  | A `generated.at` or `verified[].at` with a date but no time (§5).                                                                                     |
| W123 | `superseded-by-status`        | warning  | A `superseded_by` on a record that isn't `status: deprecated`, where it means nothing (§5.4).                                                         |
| W125 | `bundle-version`              | warning  | A bundle with no root `index.md`, or one without `okf_version` (§8.1).                                                                                |

The gaps in the numbering are upstream rules okf-tools doesn't run yet, such as those on `sources` and attested computations.

- **A link resolves from its own file's folder**, or from the bundle root when it starts with `/` (§6).
  - In a bundle whose root `index.md` declares `okf_version` 0.2 or earlier, or no version, a bare link that resolves only from the bundle root passes too, as v0.2 bundles wrote them; a bare `superseded_by` that does warns as `W119`.

### 🔏 Trust rules

okf-tools' own rules, whose `T` codes upstream doesn't use:

| Code | Rule               | Severity                 | Finds                                                                                                                                                                                                                                                      |
| ---- | ------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T001 | `draft`            | info, or as `okf.drafts` | A record still `status: draft`; one re-stamped since a sign-off names it, and says whether its text changed since the base branch, naming the cited sources the branch changed when it didn't, and quotes the `okf touch --reason` it was re-stamped with. |
| T002 | `verified-draft`   | warning                  | A `status: draft` record with a current sign-off, which `okf verify` would have set `stable`.                                                                                                                                                              |
| T003 | `generated-ahead`  | warning                  | A `generated.at` later than now, as a wrong time zone writes it, which no sign-off made now passes.                                                                                                                                                        |
| T004 | `verified-ahead`   | warning                  | A `verified[].at` later than now, which would hide every change until then.                                                                                                                                                                                |
| T005 | `self-verified`    | warning                  | A current sign-off by the actor in `generated.by`, so no one else has checked the record.                                                                                                                                                                  |
| T006 | `unstamped-change` | error                    | A body changed since the base branch under a sign-off the base already held that still counts.                                                                                                                                                             |
| T007 | `source-changed`   | warning                  | A file in the repo that `sources` cites, changed in a commit outside the history of the record's re-stamps and sign-offs.                                                                                                                                  |
| T008 | `source-gone`      | error                    | A file in the repo that `sources` cites, which git history has but the working tree doesn't.                                                                                                                                                               |

### 🏠 House rules

Conventions the spec leaves open, which a repo turns on in `okf.rules`; their `H` codes upstream doesn't use. Every one is off until named:

```json
{
  "okf": {
    "rules": {
      "index-entry-missing": "error",
      "tags-count": ["warn", { "max": 10, "min": 5 }],
      "tags-layout": ["warn", { "layout": "block" }],
      "tags-sorted": "error",
      "tags-vocabulary": ["error", { "tags": ["checks", "cli", "spec"] }]
    }
  }
}
```

| Code | Rule                  | Options                                  | Finds                                                                                  |
| ---- | --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| H001 | `tags-required`       |                                          | A record with no tags.                                                                 |
| H002 | `tags-sorted`         |                                          | Tags out of alphabetical order, at the first out of place.                             |
| H003 | `tags-kebab-case`     |                                          | A tag that isn't lower-case words of letters and digits joined by `-`.                 |
| H004 | `tags-vocabulary`     | `tags`, the vocabulary; required         | A tag the vocabulary doesn't list.                                                     |
| H005 | `tags-layout`         | `layout`: `block`, `flow`, or `any`      | `tags` written in the other layout; `any`, the default, finds nothing.                 |
| H006 | `tags-count`          | `min` and `max`, by default `5` and `10` | A record with fewer or more tags.                                                      |
| H007 | `index-entry-missing` |                                          | A record no line in its nearest `index.md` links to.                                   |
| H008 | `index-entry-stale`   |                                          | A record whose index line differs from the title and description it now has.           |
| H009 | `index-entry-order`   |                                          | A record whose index line sorts before the line above it, by title ignoring case.      |
| H010 | `source-uncited`      |                                          | A `sources` entry no footnote in the body cites by its `id`.                           |
| H011 | `wikilink`            |                                          | A `[[wikilink]]` in a record's body, which OKF doesn't read as a link (§6.1).          |
| H012 | `key-order`           | `order`, the keys to put first; required | A top-level key out of that order; keys it doesn't list belong after it, as they were. |
| H013 | `sources-sorted`      |                                          | A `sources` entry whose `id` sorts before the one above it, at the first out of place. |

- **`warn` reports a warning, and `error` an error,** which fails the run.
- **A name, level, or option `okf check` doesn't know is refused**, so a typo can't turn a rule off unnoticed.
- **The index rules judge an index as `okf index` would write it**, so running `okf index` clears them.
  - Each reports on the record, naming its index line, so `--changed` catches a record a branch retitled.
  - An index `okf index` can't read is reported under each index rule turned on.
  - A line linking to a record that's gone is `W115`'s.
- **A footnote with no source and a broken link are spec rules**, `W108` and `W115`, since upstream checks both.

### 🧹 Fixes

```sh
# Fix what has one obvious fix, then report the rest
pnpm okf check --fix

# The same
pnpm okf format --changed
```

`okf check --fix`, or `okf format`, fixes the house-rule findings that have one obvious fix, then reports what's left, with the exit code `okf check` would give.

```text
[okf] Fixed docs/decisions/a.md.
[okf] Fixed docs/decisions/index.md.
[okf] 12 files checked: 0 errors, 0 warnings, 0 info.
```

| Rule                  | Fix                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `tags-sorted`         | Sorts `tags` in place, flow or block, keeping each tag's quotes.                         |
| `tags-layout`         | With `block`, rewrites a flow list as a block list; a comment after it moves to `tags:`. |
| `sources-sorted`      | Sorts `sources` by `id`, moving each entry as written, comments inside it included.      |
| `key-order`           | Moves each top-level key, with its lines, into the order `order` lists.                  |
| `index-entry-missing` | Writes the record's nearest `index.md` as `okf index` would.                             |
| `index-entry-stale`   | The same.                                                                                |
| `index-entry-order`   | The same.                                                                                |

- **It fixes only what `okf check` reported**, so `okf.rules` and `okf.exclude` decide what it touches.
  - Under `--changed`, it fixes the files the branch changed, the indexes that list them, and the records reported for citing a changed file.
  - It fixes a record with a `T007` finding too, and once the fix is committed the warning stays, since only a re-stamp or a sign-off counts as the record having seen its sources.
  - It stays before the fix is committed, too: an uncommitted fix leaves `generated` and `verified` as they were, so an uncommitted change to the source still counts.
  - An index fix writes the index as `okf index` would, so its other stale lines and its tag index are synced too.
- **It never edits `generated` or `verified`**, so a sign-off still holds after a fix, and it commits nothing.
- **It moves text as written**, with no YAML round-trip, so a fixed record's diff shows only the fix, and every key is kept, unknown and `x-` keys included.
- **It refuses what it can't move safely**, naming the file and why on stderr, and keeps its findings, which decide the exit code:
  - frontmatter `okf verify` would refuse, such as YAML that isn't valid;
  - a `tags` list that's an alias, has an anchor, a tag or a comment among its tags, or holds anything but single values on one line each;
  - a `sources` list that's an alias or a flow list, has a comment among its entries, or has entries at different columns; or an entry with no `id`, a tag, an anchor or an alias inside it, or a block scalar last;
  - keys with a comment line between two of them.
- **It writes as `okf verify` does:** never through a symlink, only over a file still holding the text it checked, and all or nothing.
- **Prettier leaves its output alone,** at Prettier's defaults, so a repo can run both.
- **Under `--format json`**, the fixes print on stderr and the report of what's left on stdout.

## 🧭 Agents

Much OKF authoring now happens in a chat with a coding agent, and the non-interactive mode exists for that:

- the owner edits a record with the agent until it meets their bar;
- then asks the agent to verify it, which it does with `--yes`.

`okf init` writes these rules into `AGENTS.md`, between its markers, and refreshes them when run again:

```md
<!-- Written by `okf init` from @jjloneman/okf-tools. Run it again to refresh this block, and keep the repo's own rules outside it. -->

## OKF records

The Markdown files in the bundles that `okf.bundles` lists in `package.json` are [Open Knowledge Format](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md) records. okf-tools follows OKF v0.3; `okf migrate` moves a v0.1 or v0.2 bundle to it.

- **Start a new record with `okf new <record> --type <type> --by <producer>/<version>`**, such as `--by claude-code/2.1.316`, which writes it as `status: draft` with `generated` stamped from the clock, and lists it in its index; then write its body.
- **List in `sources` each repo file or folder a record was written from**, with `resource` relative to the record's folder, such as `../../src/git.ts`, and footnote each claim it rests on with a footnote whose label is the source's `id`, such as `[^git]`, so `okf check` warns when a cited file changes after the record was written or signed off.
  - Cite files, or a folder only when the record covers all of it, and leave out a file nearly every change touches, such as `package.json`, which would warn on every release.
- **When you edit a record, other than an edit that changes only its `tags`, the order of its `sources`, the order of its top-level keys, or several of these, re-stamp it with `okf touch <record>... --by <producer>/<version> --draft`**, which sets `generated` from the clock and a `stable` one back to `status: draft`, keeping its `verified` entry, so it shows as changed until it's signed off again.
  - A reorder of `sources` keeps `generated` and `status`, since a footnote cites its source by `id`, so the order changes no claim. Adding, removing, or editing an entry is re-stamped as usual.
  - A reorder of the top-level keys, such as `okf format` makes under the `key-order` house rule, keeps them too, since a key means the same wherever it sits.
  - Never type `generated.at` by hand; a wrong time makes a record look changed, or not.
- **Never add or change a `verified` entry yourself.** Signing a record off is the person's call.
- **Verify only when the person asks you to**, with `okf verify --yes <record>...`, naming the files they approved.
  - Pass `--changed` instead only when they asked for every changed record.
  - Never verify a record as a side effect of drafting or editing it.
- **Give each record 5 to 10 specific tags**, so a search finds it by any term a reader would type:
  - its topic, and the area of the repo it covers;
  - the tools and products it names;
  - the task or problem it's about;
  - the words someone searching for it would type, common synonyms included.
- **Reuse the bundle's tags first.** List them with `okf tags`, which reads every layout, rather than `grep`, and add a new tag only when none fits.
  - Prefer specific tags to broad ones: a tag most of the bundle's records carry helps no search.
  - Never add a near-duplicate of a tag the bundle has, such as its plural or another spelling.
- **Write `tags` as a block list**, one `- tag` per line, sorted, in kebab-case, even where upstream's examples show a one-line `[a, b]` list, which okf-tools reads as the same tags.
- **A change to `tags` alone keeps `generated` and `status`**, so a signed-off record stays signed off: don't run `okf touch` for it.
  - Any other change in the same edit, to the body or another field, `title` and `description` included, is re-stamped as usual, apart from a reorder of `sources` or of the top-level keys.
  - Run `okf index` after it, which syncs each tag index.
- **Where `okf.rules` in `package.json` turns on a tag rule, it wins over these:**
  - `tags-count`'s `min` and `max` replace 5 to 10;
  - `tags-layout` with `flow` means a one-line `[a, b]` list;
  - `tags-vocabulary` allows only the tags it lists, so ask the person before adding one to it.

Run `okf guide` through the repo's package manager, such as `pnpm exec okf guide`, for every okf-tools command and when you may run each, printed from the installed version.
```

`okf guide` prints the same rules, then each command and when an agent may run it, from the version installed in the repo, so an agent reads guidance that matches its commands; it prints Markdown with no `[okf]` prefix, reads nothing, and exits `0`, or `1` when given any argument but `--help`.

The agent signs as the person (the configured `okf.verifiedBy`), since the approval is theirs. A repo that wants a stricter rule can say so in its own agent instructions, outside the block.

### 🧩 Skills

`okf init` also installs three [Agent Skills](https://agentskills.io) in `.claude/skills`, where Claude Code finds them, from the installed version:

| Skill              | Use it to                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `okf-record`       | Draft or edit a record: start it with `okf new`, re-stamp it with `okf touch --draft`, and leave it a draft; or audit a bundle's tags. |
| `okf-review`       | Summarize what changed in each record since its last sign-off, from `okf status` and `okf diff`, for the owner.                        |
| `okf-architecture` | Create, update, or audit a `type: Architecture` record, written from the code it lists in `sources`.                                   |

- **okf-tools never writes `verified`, and neither does any skill.** The person signs a record off with `okf verify`, or an agent runs `okf verify --yes` when they ask it to, naming the records.
- **No skill types a timestamp:** `okf new` and `okf touch` stamp `generated` from the clock.
- **For what goes in a record**, such as sources, footnotes, and types, `okf-record` points at upstream's [okf-generate](https://github.com/open-knowledge-format/open-knowledge-format/tree/527e81aff55992be21507e97004286789126f88c/skills/okf-generate) skill. It also says to cite in `sources` the repo files a record was written from, so `okf check` warns when one changes. Where okf-generate records a `human:<id>` verification when the person confirms the content, okf-tools leaves every sign-off to `okf verify`.
- `okf guide` lists each skill and when to load it.
- A skill is rewritten whole on every `okf init`, so to change one, copy it to a folder with another name, set its `name` to match, and delete its `Written by` line.

The full reasoning is in [Which skills okf-tools ships, and how okf init installs them](docs/decisions/skills.md).

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

### 🎯 Choosing tags

- **Give each record 5 to 10 specific tags**: its topic and area, the tools it names, the problem it's about, and the words a searcher would type, synonyms included.
  - Reuse a tag `okf tags` lists before adding one, and prefer specific tags: one on most records helps no search.
  - The agent block, `okf guide`, and the `okf-record` skill all print the same tag rules.
- **A change to `tags` alone keeps `generated` and `status`**, so retagging a signed-off record leaves it signed off.
  - Tags help a reader find a record; they don't change what it says.
  - Any other change in the same edit, `title` and `description` included, is re-stamped with `okf touch` as usual, apart from a reorder of `sources` or of the top-level keys.
- **`okf-record` audits a bundle's tags** when asked:
  - it finds records outside 5 to 10 tags, from the [`tags-count`](#-house-rules) house rule when it's on;
  - it proposes each fuller list in one table, and writes only the ones the person approves;
  - it never signs a record off.

The re-stamp rule's reasoning is in [How okf new and okf touch stamp generated](docs/decisions/new-and-touch.md).

### 🔢 Listing tags

```sh
pnpm okf tags
```

`okf tags` prints every tag in the bundles with how many records carry it, one per line, sorted by name, such as `[okf] cli (8)`. It reads each record's frontmatter, so it finds a block list, a one-line flow list, and a flow list Prettier wrapped alike, which `grep '^tags:'` doesn't.

- **It writes nothing**, and exits `0` whatever it finds.
- **A file it can't read as a record** is listed under Skipped, with why, and its tags aren't counted.
- **`--format json`** prints one JSON document to stdout, with no `[okf]` prefix:

  ```json
  {
    "schemaVersion": 1,
    "skipped": [],
    "tags": [{ "count": 8, "name": "cli" }]
  }
  ```

  - The shape is public API, typed as `TagsReport`: a change to it bumps `schemaVersion`, and ships as a breaking change.

| Flag                | Does                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `--bundle <dir>`    | A bundle to scan, relative to where you run it; repeat for more. |
| `--format <format>` | `text`, the default, or `json`.                                  |
| `--help`, `-h`      | Print the usage.                                                 |

## 📚 Library

The frontmatter functions are exported too, for tools of your own:

```ts
import {
  findEditProblem,
  findFrontmatterProblem,
  findSignOffProblem,
  getRecordState,
  readRecordSummary,
  signOffRecord,
  verifyRecord,
} from "@jjloneman/okf-tools";
```

- `signOffRecord` is the sign-off `okf verify` makes: `verifyRecord`'s edits, then the reason `okf touch --reason` gave, `x-okf-restamp-reason`, taken out. `verifyRecord` edits only `status` and `verified`, leaving the reason in place, so call `signOffRecord` to sign a record off; `findSignOffProblem` says why it would refuse a record.
- `verifyRecord` takes an optional `style`, one of `ENTRY_STYLES` (`match`, `inline`, `block`), as `okf.style` describes, `match` when not given.
- `verifyRecord` takes the sign-off's `at` as RFC 3339 profiles ISO 8601: a date, `T`, a time to the minute or finer, and a zone, such as `2026-10-02T13:30:00Z` or `2026-10-02T15:30+02:00`. It refuses any other, so every sign-off it writes can be dated.
- A refusal has a `kind` to switch on, one of `REFUSAL_KINDS` (`invalidParams`, `invalidYaml`, `noFrontmatter`, `unsupportedLayout`), beside its `reason` in words.
- `readRecordSummary` reads what it can even of frontmatter that isn't valid YAML; `findFrontmatterProblem` says when it isn't, or when a block is almost right, and `findEditProblem` says why `verifyRecord` would refuse a record.
- A summary's `status` is a status OKF defines, or `undefined`; `writtenStatus` is the status as written, `undefined` when there's none (or it's empty or null).
- `getRecordState` needs only a summary's `generatedAt` and `verifiedAt` (`RecordTimes`), and never reads the clock: a `generated.at` ahead of it is judged like any other.
- `getTrustTier` calculates a record's tier, one of `TRUST_TIERS` (`unverified`, `machine-confirmed`, `human-reviewed`), from a summary's `generatedAt` and `verifications` (`TrustTimes`), every `verified` event with a `by` and an `at`; it reads the clock, so a sign-off ahead of it doesn't count.

- A summary's `staleAfter` is the record's `stale_after` as written, or `undefined`; its `description` is the record's `description`, and its `tags` the record's tags, each once, whatever the list's layout.
- `StatusReport`, with `StatusRecord`, `StatusGroup`, and `StatusSkipped`, types what `okf status --format json` prints.
- `TagsReport`, with `TagCount` and `TagsSkipped`, types what `okf tags --format json` prints.

`run` is the CLI itself, for calling it in-process; it never throws and resolves to the exit code. Its `program` is `okf` or `okf-verify`, which takes the command as the first argument or not, and runs as `okf-verify` when left out.

## 🛠️ Development

| Script                   | Does                                                    |
| ------------------------ | ------------------------------------------------------- |
| `pnpm check`             | Lint with fixes, format, then typecheck.                |
| `pnpm test`              | Run the tests.                                          |
| `pnpm test:coverage`     | Run them with the 100% coverage gate.                   |
| `pnpm lint:package`      | Build, then run publint and Are the Types Wrong.        |
| `pnpm okf <command>`     | Run `okf` from source.                                  |
| `pnpm okf:verify`        | Run the CLI from source.                                |
| `pnpm changeset`         | Add a changeset for the next release.                   |
| `pnpm changeset --empty` | Add an empty changeset, for a PR that releases nothing. |

This repo dogfoods the tool: its design decisions are an OKF bundle in [docs/decisions/](docs/decisions/index.md), and what it knows of other OKF tools is a second, in [docs/references/](docs/references/index.md), each signed off with `pnpm okf:verify`.

See [AGENTS.md](AGENTS.md) for the conventions.

## 📄 License

[MIT](LICENSE)
