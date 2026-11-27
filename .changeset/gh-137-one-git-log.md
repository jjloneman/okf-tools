---
"@jjloneman/okf-tools": patch
---

`okf check` and `okf format` now read the history of every path a record's `sources` cite in one `git status` and one `git log`, instead of two git calls per path, so a bundle that cites many files checks in a fraction of the time. A history with a merge commit still reads each path on its own, so every rule reports what it did before.
