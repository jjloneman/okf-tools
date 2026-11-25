---
"@jjloneman/okf-tools": patch
---

A new `verified` entry now takes the record's own style: `okf.style` in `package.json` (`style` for `verifyRecord`) is `match` by default, writing a block entry when `generated` is a block, or `inline` or `block`; its `at` is quoted as the record's other timestamps are.
