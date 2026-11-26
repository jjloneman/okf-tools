---
"@jjloneman/okf-tools": patch
---

`okf check`'s `T007 source-changed` now dates a cited file's commit by when it was committed rather than when it was authored, so a commit written before a record was re-stamped but landed after it, as a rebase merge or a cherry-pick lands it, still warns.
