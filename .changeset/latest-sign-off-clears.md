---
"@jjloneman/okf-tools": patch
---

Make every sign-off clear the record it signs: judge a record by the signer's latest readable `verified` entry and renew that one, compare times at whole seconds, and treat a `generated.at` ahead of the clock as unchanged once signed, saying so in the skip line and the checklist hint.
