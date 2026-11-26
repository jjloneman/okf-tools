/*
 * The trust rules `okf check` runs beside the spec rules: whether a record's
 * sign-off still means what it says, which no general OKF checker judges.
 *
 * - Their codes start with `T`, a range upstream's `validate.py` doesn't
 *   use, and don't name a severity, since `okf.drafts` sets the draft
 *   rule's.
 *
 * - A sign-off is current as OKF v0.3 counts one: at or after the record's
 *   last change, and not ahead of the clock. `readChangedAt` alone says what
 *   the last change is, so a later spec that moves it to a new key changes
 *   one function.
 */
import type { CheckedFile, CheckRule, RuleHit } from "./check-engine.ts";
import type { DraftPolicy } from "./config.ts";
import type { ParsedFile } from "./spec-rules.ts";

import { readCheckedFile, readNodeLine } from "./check-engine.ts";
import {
  isCurrentVerification,
  isGeneratedAhead,
  isVerifiedAhead,
  readLatestByActor,
} from "./frontmatter/read.ts";
import { readTimestamp } from "./frontmatter/shared.ts";
import { findBodyStart } from "./markdown.ts";
import { readEvents, readParsed, withConcept } from "./spec-rules.ts";

/** A `verified` event with a `by` and an `at` that can be read as text. */
type TrustEvent = {
  /**
   * When it says it signed the record off.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  at: string;

  /**
   * Who signed it off.
   *
   * @example "human:jjloneman"
   */
  by: string;

  /**
   * Its `at` node, for the line a finding is on.
   *
   * @example `parsed.read(event, "at")`
   */
  node: unknown;
};

/** The severity the draft rule takes under each `okf.drafts` policy. */
const DRAFT_SEVERITIES = {
  block: "error",
  warn: "warning",
} as const;

/**
 * Build the trust rules, the draft rule's severity set by `okf.drafts`:
 * none under `allow`, a warning under `warn`, an error under `block`, and a
 * notice when unset.
 */
export function buildTrustRules(drafts: DraftPolicy | undefined): CheckRule[] {
  return [
    ...(drafts === "allow"
      ? []
      : [
          {
            checkFile: checkDraft,
            code: "T001",
            name: "draft",
            severity: drafts === undefined ? "info" : DRAFT_SEVERITIES[drafts],
          } satisfies CheckRule,
        ]),
    {
      checkFile: checkVerifiedDraft,
      code: "T002",
      name: "verified-draft",
      severity: "warning",
    },
    {
      checkFile: checkGeneratedAhead,
      code: "T003",
      name: "generated-ahead",
      severity: "warning",
    },
    {
      checkFile: checkVerifiedAhead,
      code: "T004",
      name: "verified-ahead",
      severity: "warning",
    },
    {
      checkFile: checkSelfVerified,
      code: "T005",
      name: "self-verified",
      severity: "warning",
    },
    {
      checkFile: checkUnstampedChange,
      code: "T006",
      name: "unstamped-change",
      severity: "error",
    },
  ];
}

/** Read a record's last change time, `generated.at`, as its node. */
export function readChangedAt(parsed: ParsedFile): unknown {
  return parsed.read(parsed.get("generated"), "at");
}

/** Note a record that's still a draft. */
function checkDraft(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const node = parsed.get("status");

    return readTimestamp(node) === "draft"
      ? [
          {
            line: readNodeLine({ file, node }),
            message:
              "the record is a draft, so no one has signed it off as settled; okf verify signs it off",
          },
        ]
      : [];
  });
}

/** Warn about a `generated.at` later than now, as a wrong time zone writes. */
function checkGeneratedAhead(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const node = readChangedAt(parsed);
    const generatedAt = readTimestamp(node);

    return isGeneratedAhead({ generatedAt, verifiedAt: undefined })
      ? [
          {
            line: readNodeLine({ file, node }),
            message: `generated.at ${String(generatedAt)} is later than now, so no sign-off made before then can be current; write the time it was generated, in UTC`,
          },
        ]
      : [];
  });
}

/**
 * Warn about a current sign-off by the actor that last generated the record,
 * which signs off its own work.
 */
function checkSelfVerified(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const generatedBy = readTimestamp(
      parsed.read(parsed.get("generated"), "by")
    );

    return readCurrentEvents(parsed)
      .filter(({ by }) => by === generatedBy)
      .map(({ by, node }) => ({
        line: readNodeLine({ file, node }),
        message: `${by} both generated the record and signed it off, so no one else has checked it`,
      }));
  });
}

/**
 * Fail a record whose body changed since the base while a sign-off the base
 * already held is still current, so it looks as if it covers the change.
 *
 * - A sign-off made on the branch came after the change, so it covers it.
 *
 * - Whether `generated.at` changed doesn't matter, only whether the old
 *   sign-off still counts: a re-stamp to a time before it, or a removed or
 *   unreadable one, leaves it current.
 *
 * - Line endings are compared as LF, so a checkout that writes CRLF doesn't
 *   read as a change.
 */
function checkUnstampedChange(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const { baseText } = file;
    const base =
      baseText === undefined
        ? undefined
        : readParsed(
            readCheckedFile({
              bundleDir: file.bundleDir,
              doesExist: file.doesExist,
              filePath: file.filePath,
              text: baseText,
            })
          );

    if (
      base === undefined ||
      readBody(base.file.text) === readBody(file.text)
    ) {
      return [];
    }

    const baseEvents = readEvents(base).flatMap(readTrustEvent);

    return readCurrentEvents(parsed)
      .filter(({ at, by }) =>
        baseEvents.some((event) => event.at === at && event.by === by)
      )
      .map(({ at, by }) => ({
        line: readNodeLine({ file, node: readChangedAt(parsed) }),
        message: `the body changed since the base branch, but ${by}'s sign-off at ${at}, from before the change, still counts; re-stamp generated with okf touch, and sign it off again`,
      }));
  });
}

/** Warn about a `verified` event later than now. */
function checkVerifiedAhead(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) =>
    readEvents(parsed)
      .flatMap(readTrustEvent)
      .filter(({ at }) =>
        isVerifiedAhead({ generatedAt: undefined, verifiedAt: at })
      )
      .map(({ at, by, node }) => ({
        line: readNodeLine({ file, node }),
        message: `${by}'s sign-off at ${at} is later than now, so it would hide every change made before then; sign the record off again`,
      }))
  );
}

/** Warn about a draft that a current sign-off says is settled. */
function checkVerifiedDraft(file: CheckedFile): RuleHit[] {
  return withConcept(file, (parsed) => {
    const node = parsed.get("status");
    const [event] = readCurrentEvents(parsed);

    return readTimestamp(node) === "draft" && event !== undefined
      ? [
          {
            line: readNodeLine({ file, node }),
            message: `status is draft, but ${event.by}'s sign-off at ${event.at} is current; okf verify sets it stable, or re-stamp generated with okf touch if it changed`,
          },
        ]
      : [];
  });
}

/** Read a body, everything after the frontmatter, with LF line breaks. */
function readBody(text: string): string {
  return text.slice(findBodyStart(text)).replaceAll("\r\n", "\n");
}

/**
 * Read each actor's latest `verified` event when it's current, as
 * `getTrustTier` counts them, in the order each actor first appears.
 */
function readCurrentEvents(parsed: ParsedFile): TrustEvent[] {
  const generatedAt = readTimestamp(readChangedAt(parsed));

  return readLatestByActor(readEvents(parsed).flatMap(readTrustEvent)).filter(
    ({ at }) => isCurrentVerification({ at, generatedAt })
  );
}

/** Read an event's `by` and `at` as text, or nothing when either is blank. */
function readTrustEvent(event: { at: unknown; by: unknown }): TrustEvent[] {
  const at = readTimestamp(event.at);
  const by = readTimestamp(event.by);

  return at === undefined || by === undefined
    ? []
    : [{ at, by, node: event.at }];
}
