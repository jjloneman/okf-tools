---
"@jjloneman/okf-tools": patch
---

A file or git call that fails mid-run, such as a record deleted while the prompt is open, a bundle that can't be listed, or a failing `git status`, now ends the run with exit `1` and a message naming the path, and closes the prompts cleanly, instead of printing a raw system error. A rollback that can't restore a record now names it rather than saying no files changed.
