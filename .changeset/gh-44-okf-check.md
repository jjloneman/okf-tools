---
"@jjloneman/okf-tools": patch
---

Add `okf check`, which reports problems in the bundles against OKF v0.3's spec rules and writes nothing: frontmatter that doesn't parse, a repeated key, frontmatter on a `log.md` or a subfolder's `index.md`, and a `log.md` heading that isn't a date are errors; timestamps, actors, `status`, `tags`, root `index.md` metadata, and `index.md` links to files that don't exist are warnings. Codes and severities match upstream's `validate.py`. It exits `1` on an error, or a warning under `--strict`, prints a versioned report with `--format json`, whose type is exported as `CheckReport`, and annotates files in GitHub Actions.
