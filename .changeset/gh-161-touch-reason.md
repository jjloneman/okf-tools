---
"@jjloneman/okf-tools": patch
---

Add `okf touch --reason "<why>"`, which writes why a record was re-stamped as `x-okf-restamp-reason`, for `okf check`'s `T001` to quote in the text report, the JSON report and the review comment. A re-stamp without `--reason`, `okf deprecate`, and a sign-off with `okf verify` each take out any reason an earlier re-stamp wrote.
