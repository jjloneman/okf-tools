---
type: Decision
title: How okf-tools is distributed
description: A public package on the npm registry, installed as an exact-pinned dev dependency; not a private package, GitHub Packages, a git dependency, or a global CLI.
tags: [distribution]
sources:
  - id: pnpm-minimum-release-age
    resource: https://pnpm.io/settings#minimumreleaseage
    title: pnpm settings, minimumReleaseAge
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-11-11T23:36:00Z }
---

# How okf-tools is distributed

`okf-verify` started as a script pasted into each repo with OKF bundles. It now ships once, as `@jjloneman/okf-tools`, and each repo installs it.

## Decision

As of 2026-11-11, from `package.json`:

- **A public package on npmjs.com**, published with `access: public` and provenance (`publishConfig` in `package.json`).
- **Each consumer installs it as a dev dependency**, pinned exactly, and runs it from a script: `"okf:verify": "okf-verify"`.
- **Rejected alternatives:**
  - **A private package:** safe-fns is public, so every contributor and CI run would need a token just to `pnpm install`.
  - **GitHub Packages:** every consumer needs an `.npmrc` and a token, even for a public package.
  - **A git dependency:** it has no publish date, so the 7-day release-age floor never applies to it.
  - **`pnpm dlx` or a global install:** the version floats outside the lockfile, with no pin, no update PRs, and no release-age floor.
- **The name is scoped,** since the unscoped `okf-tools` was already taken on npm.
- **It ships compiled JavaScript** in `dist/`, the only published directory. Node refuses to strip types from files under `node_modules`, so a consumer can't run the `.ts` sources the way this repo's own `pnpm okf:verify` does.

## Why

- This repo and its consumers hold new dependency versions back for 7 days with pnpm's `minimumReleaseAge`[^pnpm-minimum-release-age]. A registry release is the one channel where that floor, `saveExact`, and Renovate's update PRs all work as they do for any other dependency.
- The git-dependency gap was tested, not assumed: on 2026-11-03, pnpm 12.4.1 installed a git dependency on a same-day commit despite `minimumReleaseAge: 10080`.
- The code holds nothing private: its only owner-specific value, `human:jjloneman`, lives in each consumer's `okf.verifiedBy`.

## Consequences

- Releases go through changesets and npm trusted publishing (OIDC), so no npm token exists; the first version was published by hand, since trusted publishing can only be set up for a package that already exists.
- A breaking change in 0.x ships as a minor bump, which consumers pick up deliberately, since they pin exactly.

[^pnpm-minimum-release-age]: pnpm's `minimumReleaseAge` setting, which holds back versions published more recently than the given number of minutes.
