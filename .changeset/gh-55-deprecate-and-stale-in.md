---
"@jjloneman/okf-tools": patch
---

Add `okf deprecate`, which marks records `status: deprecated` and re-stamps `generated`, with `--superseded-by` to name the record that replaces them, and `okf verify --stale-in <duration>`, which sets `stale_after` that long after the sign-off.
