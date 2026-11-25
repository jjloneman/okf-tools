---
"@jjloneman/okf-tools": patch
---

A committing run now writes nothing when git would refuse the commit, such as mid-merge or for an ignored record, and re-running `--yes` after a rejected commit commits the sign-off left on disk instead of skipping it.
