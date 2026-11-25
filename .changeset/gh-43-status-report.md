---
"@jjloneman/okf-tools": patch
---

Add `okf status`, which lists every record's trust state (changed since sign-off, draft, never signed off, stale, or settled) without writing anything, with `--draft`, `--changed`, and `--stale` filters and a versioned `--format json` report; record summaries now carry `staleAfter`.
