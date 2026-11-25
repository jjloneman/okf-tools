---
"@jjloneman/okf-tools": minor
---

`verifyRecord` refuses an `at` that isn't an RFC 3339 date and time with a zone, such as `2026-10-02T13:30:00Z`, and every refusal carries a `kind`; `findFrontmatterProblem`, `findEditProblem`, and `REFUSAL_KINDS` are exported, and a summary's `writtenStatus` tells an absent status from an unknown one.
