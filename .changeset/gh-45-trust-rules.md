---
"@jjloneman/okf-tools": patch
---

`okf check` judges whether each sign-off still holds: trust rules `T001` to `T006`, upstream's `I201` and `I204`, an `okf.drafts` setting, `--changed` for a pull request, and an error for a body changed since the base branch without a new `generated.at`
