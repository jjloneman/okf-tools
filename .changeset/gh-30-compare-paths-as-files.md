---
"@jjloneman/okf-tools": patch
---

Record paths relative to where `okf-verify` runs, and bundles, may now take any spelling the disk resolves to the same file, such as another case on macOS, and `okf-verify` may run from a folder reached through a symlink: a bundle configured in another case finds its changed records, a record named in another case is committed rather than left edited, and a record or bundle folder whose name is decomposed Unicode counts as changed.
