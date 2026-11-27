---
"@jjloneman/okf-tools": patch
---

Add the `sources-sorted` house rule, `H013`, off until `okf.rules` names it, which reports the first `sources` entry whose `id` sorts before the one above it; `okf format` (`okf check --fix`) sorts the entries by `id`, moving each as written.
