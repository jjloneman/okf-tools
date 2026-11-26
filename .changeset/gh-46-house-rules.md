---
"@jjloneman/okf-tools": patch
---

`okf check` runs opt-in house rules that `okf.rules` in package.json turns on at `warn` or `error`: required, sorted, kebab-case, vocabulary, layout and count rules for tags, an index that matches what `okf index` writes, sources no footnote cites, and wikilinks. It also warns, as upstream's `validate.py` does, on a footnote with no matching `sources` id (`W108`), a broken link in a record's body (`W115`, renamed `link-target`), and a `superseded_by` that resolves nowhere (`W116`, renamed `path-target`), only through v0.2's root fallback (`W119`), or on a record that isn't deprecated (`W123`)
