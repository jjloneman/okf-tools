---
"@jjloneman/okf-tools": patch
---

Add `okf guide`, which prints the rules for writing and verifying records and each command with when an agent may run it, as Markdown from the installed version; the `okf init` block now ends with a line pointing at it (run `okf init` to refresh), and `okf verify --help` points at it instead of restating the agent rule.
