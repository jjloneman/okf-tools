---
"@jjloneman/okf-tools": minor
---

Report a record whose frontmatter block is almost right, such as one with no closing `---`, blanks around a fence, a blank line before the opening one, or a `...` close, instead of skipping it as "no frontmatter", so `--yes` fails on it rather than finding nothing to verify; `findFrontmatterProblem`, `findEditProblem` and `verifyRecord` name what's wrong with the fence. `log.md`, which OKF reserves, is no longer a record.
