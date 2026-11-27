---
"@jjloneman/okf-tools": patch
---

The record rules, `okf guide` and the `okf-record` skill now say a reorder of a record's `sources` alone keeps `generated` and `status`, alone or with a change to `tags`, as a change to `tags` alone does, so an agent no longer re-stamps a record whose `tags` and `sources` `okf format` only sorted.
