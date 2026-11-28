---
"@jjloneman/okf-tools": patch
---

`okf check` now reports an anchor set a second time as `E002`, and reports the code upstream's `validate.py` does for frontmatter with more than one problem: a syntax error, an alias whose anchor isn't set before it, or an anchor set again is reported, whichever comes first, before a key given twice.
