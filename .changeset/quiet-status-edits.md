---
"@jjloneman/okf-tools": patch
---

Mark `status: draft` stable and add a new `verified` entry at the positions the YAML parser reports, so a value on the next line or a field after a nested block is edited in place rather than missed. A signer whose name holds YAML syntax is quoted, and an edit whose result would mean anything other than the original with the sign-off is refused.
