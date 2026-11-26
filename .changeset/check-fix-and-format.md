---
"@jjloneman/okf-tools": patch
---

Add `okf check --fix`, also run as `okf format`, which fixes the house-rule findings with one obvious fix: sorted tags, a flow `tags` list rewritten as a block under `tags-layout: block`, top-level keys in the order the new `key-order` rule lists, and index lines `okf index` would rewrite. It moves text as written, never edits `generated` or `verified`, refuses what it can't move safely, and commits nothing.
