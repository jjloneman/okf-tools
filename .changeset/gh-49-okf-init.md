---
"@jjloneman/okf-tools": patch
---

Add `okf init`, which writes the `okf` block of `package.json` and a block of agent rules between `<!-- okf:start -->` and `<!-- okf:end -->` lines in `AGENTS.md` (and, with `--copilot`, `.github/copilot-instructions.md`), refreshing only the text between the markers when run again; `okf init --check` fails when a block is missing or out of date.
