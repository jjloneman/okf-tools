---
"@jjloneman/okf-tools": patch
---

`okf check`'s `T007 source-changed` counts only a record's re-stamps and sign-offs, the commits that changed its `generated` or `verified`, as having seen its sources, so a commit that changed only its `tags`, an `okf format`, or a merge that combined edits to it no longer hides a source change.
