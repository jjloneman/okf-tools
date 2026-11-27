---
"@jjloneman/okf-tools": patch
---

`okf check`'s `T007 source-changed` judges a committed source change by commit ancestry instead of a clock: a commit counts when it isn't in the history of a commit that changed the record, so a rebase no longer warns falsely, and a branch merged after the record's re-stamp no longer slips through.
