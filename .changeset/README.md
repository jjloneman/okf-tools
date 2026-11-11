# Changesets

Every PR adds one file here, and CI fails a PR that doesn't. A PR that should cut a release runs `pnpm changeset`: the bump (`patch`, `minor`, or `major`) and the line it adds to `CHANGELOG.md`. One that releases nothing runs `pnpm changeset --empty`. See [AGENTS.md](../AGENTS.md#-versioning--releases).
