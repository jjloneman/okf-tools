---
"@jjloneman/okf-tools": patch
---

After a record or bundle folder is renamed only in case on disk, without `git mv`, `okf-verify` now spells it as git's index does: a record named as the disk spells it is committed rather than left edited, the interactive checklist lists it as changed, and a new record in such a folder is accepted as a record in its bundle.
