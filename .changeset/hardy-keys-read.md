---
"@jjloneman/okf-tools": patch
---

Read frontmatter with a YAML parser, so records written in valid but unusual YAML are handled: a `verified` entry is renewed in place whatever order its keys are in, however it's quoted, spaced, or commented, and when its timestamp is empty or missing, rather than gaining a duplicate; quoted titles keep their escapes; and `generated.at` is read past nested lists and keys. A record that can't be read, or whose frontmatter isn't valid YAML, is reported (a warning in the checklist, a failure with `--yes`) instead of ending the run or being edited, and an edit that would leave invalid YAML is refused.
