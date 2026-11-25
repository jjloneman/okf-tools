---
"@jjloneman/okf-tools": patch
---

Add `okf new`, which writes a draft record's frontmatter with `generated` stamped from the clock and lists it in its index, and `okf touch`, which re-stamps an edited record's `generated` from the clock, with `--draft` to set a stable one back to draft; the agent rules now point at both instead of a hand-typed `generated.at`.
