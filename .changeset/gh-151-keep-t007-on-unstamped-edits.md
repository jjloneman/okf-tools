---
"@jjloneman/okf-tools": patch
---

`okf check`'s `T007` no longer stops warning about a changed source while a record has an uncommitted edit that leaves its `generated` and `verified` as `HEAD` has them, such as an `okf format` fix; only an uncommitted re-stamp or sign-off falls back to the clock.
