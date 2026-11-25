/*
 * `okf status`: every record's trust state in one read-only report, as text
 * for a person or JSON for a program.
 *
 * - It never writes, and exits `0` whatever it finds: it reports, it doesn't
 *   judge.
 */
import type { ExitCode } from "./exit-codes.ts";
import type { RecordState } from "./frontmatter/read.ts";
import type { TrustTier } from "./frontmatter/types.ts";
import type { StatusFilter, StatusOptions } from "./options.ts";
import type { Outcome } from "./outcome.ts";
import type { Candidate } from "./records.ts";
import type { LoadedRecords } from "./repo.ts";
import type { RunContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { getTrustTier, isStale, readStatusText } from "./frontmatter/read.ts";
import { RECORD_STATUSES } from "./frontmatter/types.ts";
import { toTerminalLine } from "./output.ts";
import {
  loadCandidate,
  loadCandidates,
  orderRecordPaths,
  resolveRecordPaths,
} from "./repo.ts";

/**
 * Which group `okf status` lists a record under, the first that fits, in
 * this order:
 *
 * - `changed`: signed off, then changed since, so the sign-off no longer
 *   holds, whatever its status;
 * - `draft`: `status: draft`, with no sign-off it has changed since;
 * - `unverified`: never signed off by the signer, and not a draft;
 * - `stale`: signed off and unchanged, but past its `stale_after`;
 * - `settled`: signed off, unchanged, and not stale.
 */
export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** One record in an `okf status` report. */
export type StatusRecord = {
  /**
   * When the record was last generated, as written, or `null`.
   *
   * @example "2026-10-01T15:00:00Z"
   */
  generatedAt: null | string;

  /**
   * The group it's listed under.
   *
   * @example "changed"
   */
  group: StatusGroup;

  /**
   * Whether it's past its `stale_after`, whatever its group.
   *
   * @example false
   */
  isStale: boolean;

  /**
   * Its path from the repo root, with `/` separators.
   *
   * @example "docs/decisions/package-promise.md"
   */
  path: string;

  /**
   * Its `stale_after`, as written, or `null`.
   *
   * @example "2027-01-01T00:00:00Z"
   */
  staleAfter: null | string;

  /**
   * Where it stands with the signer's sign-off, as `getRecordState` judges
   * it, with a sign-off ahead of the clock counted as `changed`.
   *
   * @example "verified"
   */
  state: RecordState;

  /**
   * Its `status` as written, even one OKF doesn't define, or `null` when it
   * has none, which OKF reads as `stable`.
   *
   * @example "draft"
   */
  status: null | string;

  /**
   * Its trust tier, as OKF v0.3 calculates it from every actor's current
   * `verified` events, not only the signer's: `unverified`,
   * `machine-confirmed`, or `human-reviewed`.
   *
   * @example "human-reviewed"
   */
  tier: TrustTier;

  /**
   * Its `title`, or `null`.
   *
   * @example "What every export promises"
   */
  title: null | string;

  /**
   * Its `type`, or `null`.
   *
   * @example "Decision"
   */
  type: null | string;

  /**
   * When the signer last signed it off, as written, or `null`.
   *
   * @example "2026-10-02T13:30:00Z"
   */
  verifiedAt: null | string;
};

/**
 * What `okf status --format json` prints.
 *
 * - The shape is public: a change to it bumps `schemaVersion`.
 */
export type StatusReport = {
  /**
   * The records listed, after any filters, in the order the bundles list
   * them.
   *
   * @example `[{ group: "draft", path: "docs/decisions/a.md", … }]`
   */
  records: StatusRecord[];

  /**
   * The version of this shape.
   *
   * @example 1
   */
  schemaVersion: typeof STATUS_SCHEMA_VERSION;

  /**
   * The files that couldn't be read as records, and why; never filtered,
   * since their state can't be known.
   *
   * @example `[{ path: "docs/decisions/b.md", reason: "…" }]`
   */
  skipped: StatusSkipped[];

  /**
   * The actor whose sign-off counts.
   *
   * @example "human:jjloneman"
   */
  verifiedBy: string;
};

/** A file `okf status` couldn't read as a record, and why. */
export type StatusSkipped = {
  /**
   * Its path from the repo root.
   *
   * @example "docs/decisions/b.md"
   */
  path: string;

  /**
   * Why it couldn't be read, naming the path.
   *
   * @example "docs/decisions/b.md can't be read: EACCES: permission denied"
   */
  reason: string;
};

/** The groups, in the order a record is tested against them and listed. */
export const STATUS_GROUPS = [
  "changed",
  "draft",
  "unverified",
  "stale",
  "settled",
] as const;

/** The version of the JSON report's shape. */
export const STATUS_SCHEMA_VERSION = 1;

/** Each group's heading in the text report. */
const GROUP_HEADINGS: Record<StatusGroup, (verifiedBy: string) => string> = {
  changed: () => "Changed since sign-off",
  draft: () => "Draft",
  settled: () => "Settled",
  stale: () => "Stale",
  unverified: (verifiedBy) => `Never signed off by ${verifiedBy}`,
};

/**
 * Build the report from the loaded records, keeping those that match any
 * filter, or all of them with none.
 */
export function buildStatusReport(params: {
  filters: readonly StatusFilter[];
  loaded: LoadedRecords;
  verifiedBy: string;
}): StatusReport {
  const { filters, loaded, verifiedBy } = params;

  const records = loaded.candidates
    .map((candidate) => toStatusRecord(candidate))
    .filter(
      (record) =>
        filters.length === 0 ||
        filters.some((filter) => matchesFilter({ filter, record }))
    );

  return {
    records,
    schemaVersion: STATUS_SCHEMA_VERSION,
    skipped: loaded.skipped.map(({ filePath, reason }) => ({
      path: filePath,
      reason,
    })),
    verifiedBy,
  };
}

/**
 * Word the report for a person: each group that has records, under its
 * heading with a count, then the skipped files.
 */
export function formatStatusText(params: {
  hasFilters: boolean;
  report: StatusReport;
}): string {
  const { hasFilters, report } = params;
  const sections: string[] = [];

  for (const group of STATUS_GROUPS) {
    const records = report.records.filter((record) => record.group === group);

    if (records.length > 0) {
      sections.push(
        [
          `${GROUP_HEADINGS[group](report.verifiedBy)} (${records.length})`,
          ...records.map((record) => `  ${describeRecord(record)}`),
        ].join("\n")
      );
    }
  }

  if (sections.length === 0) {
    sections.push(hasFilters ? "No records match." : "No records.");
  }

  if (report.skipped.length > 0) {
    sections.push(
      [
        `Skipped (${report.skipped.length})`,
        ...report.skipped.map(({ reason }) => indentReason(reason)),
      ].join("\n")
    );
  }

  return sections.join("\n\n");
}

/** Group a record: the first of `STATUS_GROUPS` that fits it. */
export function groupRecord(params: {
  isStale: boolean;
  state: RecordState;
  status: string | undefined;
}): StatusGroup {
  const { state, status } = params;

  if (state === "changed") {
    return "changed";
  }

  if (status === RECORD_STATUSES.draft) {
    return "draft";
  }

  if (state === "unverified") {
    return "unverified";
  }

  return params.isStale ? "stale" : "settled";
}

/**
 * Run `okf status`: load the records, then print the report.
 *
 * - A named path that isn't a record in the bundles fails the run, as a
 *   usage error; anything it finds in the records doesn't.
 */
export function runStatus(params: {
  context: RunContext;
  options: StatusOptions;
}): ExitCode {
  const { context, options } = params;
  const { output, verifiedBy } = context;
  const loaded = loadStatusRecords({
    context,
    recordPaths: options.recordPaths,
  });

  if (!loaded.isOk) {
    output.error(loaded.reason);

    return EXIT_CODES.failure;
  }

  const report = buildStatusReport({
    filters: options.filters,
    loaded: loaded.value,
    verifiedBy,
  });

  if (options.format === "json") {
    output.data(JSON.stringify(report, undefined, 2));
  } else {
    output.info(
      formatStatusText({ hasFilters: options.filters.length > 0, report })
    );
  }

  return EXIT_CODES.ok;
}

/**
 * Word one record's line: its path, then its status, sign-off, and
 * staleness, as far as it has them.
 */
function describeRecord(record: StatusRecord): string {
  const details = [
    record.status === null ? "no status" : `status ${record.status}`,
    record.verifiedAt === null
      ? "never signed off"
      : `signed off ${record.verifiedAt}`,
  ];

  if (record.generatedAt !== null) {
    details.push(`generated ${record.generatedAt}`);
  }

  // Only a readable `stale_after` makes a record stale, so it's there.
  if (record.isStale) {
    details.push(`stale since ${String(record.staleAfter)}`);
  }

  return toTerminalLine(`${record.path}: ${details.join(", ")}`);
}

/**
 * Indent a skipped file's reason under its heading, its later lines, such as
 * a YAML error's excerpt, further still.
 */
function indentReason(reason: string): string {
  return reason
    .split("\n")
    .map((line, index) => {
      const shown = toTerminalLine(line);

      if (shown === "") {
        return shown;
      }

      return index === 0 ? `  ${shown}` : `    ${shown}`;
    })
    .join("\n");
}

/**
 * Load the records to report: every record in the bundles, or only the ones
 * named, each read only, so a layout the edits refuse is still reported.
 *
 * - Named records are listed in the bundles' order, as a scan lists them,
 *   not the order they were named in.
 *
 * - A named file with no frontmatter block is reported as skipped, since it
 *   was asked for.
 */
function loadStatusRecords(params: {
  context: RunContext;
  recordPaths: readonly string[];
}): Outcome<LoadedRecords> {
  const { context, recordPaths } = params;
  const { bundleDirs, cwd, excludeGlobs, repoRoot, verifiedBy } = context;

  if (recordPaths.length === 0) {
    return loadCandidates({
      bundleDirs,
      excludeGlobs,
      isReadOnly: true,
      repoRoot,
      verifiedBy,
    });
  }

  const resolved = resolveRecordPaths({
    bundleDirs,
    cwd,
    excludeGlobs,
    recordPaths,
    repoRoot,
  });

  if (!resolved.isOk) {
    return resolved;
  }

  const loaded: LoadedRecords = { candidates: [], skipped: [] };
  const filePaths = orderRecordPaths({ bundleDirs, filePaths: resolved.value });

  for (const filePath of filePaths) {
    const record = loadCandidate({
      filePath,
      isReadOnly: true,
      repoRoot,
      verifiedBy,
    });

    if (record.kind === "record") {
      loaded.candidates.push(record.candidate);
    } else {
      loaded.skipped.push({ filePath, reason: record.reason });
    }
  }

  return { isOk: true, value: loaded };
}

/** Whether a record matches one filter. */
function matchesFilter(params: {
  filter: StatusFilter;
  record: StatusRecord;
}): boolean {
  const { filter, record } = params;
  const matches: Record<StatusFilter, boolean> = {
    changed: record.state === "changed",
    draft: record.status === RECORD_STATUSES.draft,
    stale: record.isStale,
  };

  return matches[filter];
}

/** Read a loaded record into the report's shape, `null` for each absence. */
function toStatusRecord(candidate: Candidate): StatusRecord {
  const { filePath, state, summary, text } = candidate;
  const isPastStale = isStale(summary);

  // A status OKF doesn't define, even a list, is reported as written, since
  // `null` would claim the record has none.
  const status = summary.writtenStatus ?? readStatusText(text);

  return {
    generatedAt: summary.generatedAt ?? null,
    group: groupRecord({
      isStale: isPastStale,
      state,
      status: summary.status,
    }),
    isStale: isPastStale,
    path: filePath,
    staleAfter: summary.staleAfter ?? null,
    state,
    status: status === undefined || status === "" ? null : status,
    tier: getTrustTier(summary),
    title: summary.title ?? null,
    type: summary.type ?? null,
    verifiedAt: summary.verifiedAt ?? null,
  };
}
