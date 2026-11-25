---
"@jjloneman/okf-tools": patch
---

Report each record's OKF v0.3 trust tier (`unverified`, `machine-confirmed`, or `human-reviewed`) as `tier` in `okf status --format json`, from each actor's latest `verified` event, when it's at or after `generated.at`; the library exports `getTrustTier` and `TRUST_TIERS`, and record summaries now carry every event as `verifications`.
