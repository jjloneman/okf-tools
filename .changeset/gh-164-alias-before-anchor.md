---
"@jjloneman/okf-tools": patch
---

`okf check` reports frontmatter with an alias whose anchor isn't set before it as `E002 frontmatter-parses`, on the alias's line, as upstream's `validate.py` reports it as `E002`; the yaml package parsed it without an error, so it passed unreported.
