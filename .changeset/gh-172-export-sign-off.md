---
"@jjloneman/okf-tools": patch
---

Export `signOffRecord`, the sign-off `okf verify` makes, which also takes out a re-stamp's `x-okf-restamp-reason`, and `findSignOffProblem`, which reports its refusals before a record is chosen. `verifyRecord` and `findEditProblem` keep their behavior and now say so.
