---
"@jjloneman/okf-tools": patch
---

`okf init` now installs three Agent Skills in `.claude/skills`: `okf-record`, which drafts and edits records through `okf new` and `okf touch` and points at upstream's okf-generate for content, `okf-review`, which summarizes what changed since each sign-off, and `okf-architecture`, which creates, updates, or audits an architecture record from its code; none writes `verified` or a timestamp, `okf init --check` fails until they're installed, and `okf guide` lists them.
