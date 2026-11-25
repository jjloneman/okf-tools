---
"@jjloneman/okf-tools": patch
---

Add `okf index`, which rewrites each `index.md` line that links to a record from that record's title and description, sorted by title, adds missing records, drops gone ones, and keeps a tag index between `<!-- tag-index:start -->` and `<!-- tag-index:end -->`; `--check` fails when an index is out of date. Add `okf tags`, which lists every tag in the bundles with its record count, with `--format json`, and a line in `okf init`'s agent block that points agents to it.
