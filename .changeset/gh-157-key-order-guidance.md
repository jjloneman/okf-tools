---
"@jjloneman/okf-tools": patch
---

The record rules, `okf guide` and the `okf-record` skill now say a reorder of a record's top-level keys alone keeps `generated` and `status`, as a change to `tags` or to the order of `sources` alone does, so an agent no longer re-stamps a record whose keys `okf format` only ordered under `key-order`.
