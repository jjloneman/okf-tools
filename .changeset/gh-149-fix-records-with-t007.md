---
"@jjloneman/okf-tools": patch
---

`okf check --fix` and `okf format` now fix a record with a `T007` finding, and under `--changed` a record reported for citing a changed file, since a fix never re-stamps the record and so can't hide a source change once it's committed; the `T007` warning stays.
