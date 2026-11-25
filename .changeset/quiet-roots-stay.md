---
"@jjloneman/okf-tools": patch
---

Resolve paths from the package root when `INIT_CWD` points outside the package's repo, as `pnpm --dir` from another repo sets it, so a run never reads or signs another repo's records
