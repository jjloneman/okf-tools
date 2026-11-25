---
"@jjloneman/okf-tools": patch
---

A sign-off whose `verified.at` is ahead of the clock, as a wrong time zone writes it, now counts as changed, so `--changed` and the checklist offer the record again and signing it renews that entry, instead of hiding every regeneration until the clock passes it.
