---
"@jjloneman/okf-tools": patch
---

`okf check` reports a draft re-stamped since a sign-off as one `T001` notice that names the sign-off and says whether the record's text changed since the base branch or only its frontmatter did, and `I204` no longer reports a draft. `okf check --review-file` writes each draft's `T001` for the new `okf review-comments`, which posts them as pull request review comments the owner resolves to acknowledge them, as the `okf-check.yml` workflow's new `review-comments` input does.
