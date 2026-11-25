---
"@jjloneman/okf-tools": patch
---

Add `okf migrate`, which moves a bundle from OKF v0.1 or v0.2 to v0.3: it declares `okf_version: "0.3"`, fills a missing bundle `title` and `description`, and rewrites each bare path that names a file only from the bundle root to the relative path v0.3 reads, leaving `generated` and `verified` alone so sign-offs stay current; it's a dry run unless `--write`, and `--check` fails while a bundle needs it. `okf --version` prints the installed version and the OKF version okf-tools follows, now v0.3.
