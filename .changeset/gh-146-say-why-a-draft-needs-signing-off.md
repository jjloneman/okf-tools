---
"@jjloneman/okf-tools": patch
---

`okf check` reports a draft re-stamped since a sign-off as one `T001` notice that names the sign-off and says whether the record's text changed since the base branch or only its frontmatter did, and `I204` no longer reports a draft. The new `okf check --review-file` and `okf review-comments` post each draft's `T001` as a pull request review comment the owner resolves to acknowledge it, each in a GitHub alert by severity, with its code linked to the README, which the `okf-check.yml` workflow's new `review-comments` input runs; its calling job grants `contents: write` and `pull-requests: write`. `okf review-comments` calls GitHub through `@octokit/core`, a new dependency that only that command loads.
