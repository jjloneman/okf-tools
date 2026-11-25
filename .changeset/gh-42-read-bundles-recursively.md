---
"@jjloneman/okf-tools": minor
---

Records are now read at any depth inside a bundle, leaving out `index.md` and `log.md` at every level, and a new `okf.exclude` setting lists globs of Markdown that isn't a record, such as `**/README.md`. A repo that lists a parent folder as a bundle now sees the records in its subfolders too, so add an exclusion for any Markdown there that isn't one.
