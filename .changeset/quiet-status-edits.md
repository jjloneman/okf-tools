---
"@jjloneman/okf-tools": patch
---

Mark `status: draft` stable and add a new `verified` entry at the positions the YAML parser reports, so a quoted key, an anchor, a value on the next line, or another signer's entry spread over lines is edited in place rather than refused or missed. A signer whose name holds YAML syntax is quoted, and an edit whose result would mean anything other than the original with the sign-off is refused.
