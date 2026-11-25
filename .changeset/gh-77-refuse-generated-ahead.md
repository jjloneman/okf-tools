---
"@jjloneman/okf-tools": minor
---

A record whose `generated.at` is ahead of the clock is refused when it's listed, with "generated.at is ahead of the clock; fix its time zone", so it's never signed off or hidden as already verified; `getRecordState` no longer reads the clock, and judges such a time like any other.
