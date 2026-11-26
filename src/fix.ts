/*
 * `okf check --fix`, also run as `okf format`: works out the edits that
 * clear the house-rule findings with one obvious fix, and writes them.
 *
 * - It fixes only what `okf check` reported, so `okf.exclude` and the rules
 *   `okf.rules` turns on decide what it touches; `check.ts` passes it only
 *   the findings on files the branch changed under `--changed`.
 *
 * - A record's fixes, sorted tags, a block `tags` list and the key order,
 *   go through `formatRecord`, which moves text by position and never edits
 *   `generated` or `verified`.
 *
 * - An index's fix writes the index the finding judged whole, as `okf index`
 *   would, so its other stale lines and its tag index are synced too.
 *
 * - The writes are all or nothing, never through a symlink, and only over a
 *   file still holding the text the check read.
 */
import type { CheckedBundle, CheckFinding } from "./check-engine.ts";
import type { HouseRules } from "./house-rules.ts";
import type { IndexDrift } from "./index-sync.ts";
import type { Outcome } from "./outcome.ts";
import type { RecordEdit } from "./records.ts";
import type { BundleContext } from "./run-context.ts";

import { formatRecord } from "./frontmatter/format.ts";
import { judgeIndexes } from "./house-rules.ts";
import { planIndexSyncs } from "./index-command.ts";
import { describeError } from "./output.ts";
import { findLinkedPath, isRecordUnchanged, writeRecords } from "./repo.ts";

/** What the fixes did: the files written, and the ones that couldn't be. */
export type FixResult = {
  /**
   * Why each file that needed a fix couldn't get one, naming it.
   *
   * @example `["docs/a.md: `tags` has an anchor or a tag; fix the record by hand"]`
   */
  refusals: string[];

  /**
   * The files written, records first, then indexes, each by its path from
   * the repo root, with the text written.
   *
   * @example `[{ filePath: "docs/decisions/a.md", originalText: "…", text: "…" }]`
   */
  written: RecordEdit[];
};

/** The trust rule on a source changed since its record was written. */
const SOURCE_CHANGED = "source-changed";

/** The house rule each kind of index drift is reported under. */
const INDEX_RULES: Readonly<Record<IndexDrift["kind"], keyof HouseRules>> = {
  missing: "index-entry-missing",
  order: "index-entry-order",
  stale: "index-entry-stale",
};

/** The house rules whose findings `formatRecord` clears. */
const RECORD_RULES: ReadonlySet<string> = new Set<keyof HouseRules>([
  "key-order",
  "tags-layout",
  "tags-sorted",
]);

/**
 * Fix what `okf check` found that has one obvious fix, and write it.
 *
 * - A file that can't be fixed is named with why, and the rest are still
 *   written; its findings stay in the report that follows.
 *
 * - A failed write restores the files already written, and fails the run.
 */
export function applyFixes(params: {
  /**
   * The bundles as `okf check` read them.
   *
   * @example `[{ bundleDir: "docs/decisions", files: […] }]`
   */
  bundles: readonly CheckedBundle[];

  /**
   * The repo and bundles checked.
   *
   * @example `buildBundleContext(…)`
   */
  context: BundleContext;

  /**
   * What `okf check` found, in its scope.
   *
   * @example `report.findings`
   */
  findings: readonly CheckFinding[];

  /**
   * The house rules the repo turned on, for their options.
   *
   * @example `{ "tags-layout": { layout: "block", level: "warn" } }`
   */
  houseRules: HouseRules;
}): Outcome<FixResult> {
  const { bundles, context, findings, houseRules } = params;
  const { repoRoot } = context;
  const refusals: string[] = [];
  const records = planRecordFixes({ bundles, findings, houseRules });

  refusals.push(...records.refusals);

  const indexPaths = findJudgedIndexes({ bundles, findings });
  const indexes =
    indexPaths.length === 0
      ? { isOk: true as const, value: { edits: [], refusals: [] } }
      : planIndexSyncs({ context, indexPaths });

  if (!indexes.isOk) {
    return indexes;
  }

  refusals.push(...indexes.value.refusals);

  const edits: RecordEdit[] = [];

  for (const edit of [...records.edits, ...indexes.value.edits]) {
    const problem = findWriteProblem({ edit, repoRoot });

    if (problem === undefined) {
      edits.push(edit);
    } else {
      refusals.push(`${edit.filePath} ${problem}`);
    }
  }

  const written = writeRecords({ edits, repoRoot });

  // The run ends on the failure, so the files it never got to are named in
  // it too.
  if (!written.isOk) {
    return {
      isOk: false,
      reason: [
        ...refusals.map((refusal) => `Not fixed: ${refusal}`),
        written.reason,
      ].join("\n"),
    };
  }

  return { isOk: true, value: { refusals, written: edits } };
}

/**
 * Find the indexes the index rules judged, for the findings given: each
 * whose drift a finding reports on its record, and each a finding says
 * `okf index` can't read.
 *
 * - It reads the judgment the rules made, so it fixes the very index a
 *   finding names, never one `okf.exclude` leaves out.
 */
function findJudgedIndexes(params: {
  bundles: readonly CheckedBundle[];
  findings: readonly CheckFinding[];
}): string[] {
  const { bundles, findings } = params;
  const reported = new Set(
    findings.map(({ path: filePath, rule }) => `${rule}\0${filePath}`)
  );
  const isReported = (rule: string, filePath: string): boolean =>
    reported.has(`${rule}\0${filePath}`);
  const indexRules: readonly string[] = Object.values(INDEX_RULES);

  if (!findings.some(({ rule }) => indexRules.includes(rule))) {
    return [];
  }

  return bundles.flatMap((bundle) =>
    judgeIndexes(bundle)
      .filter(({ found, indexPath }) =>
        found.isOk
          ? found.drift.some(({ kind, recordPath }) =>
              isReported(INDEX_RULES[kind], recordPath)
            )
          : indexRules.some((rule) => isReported(rule, indexPath))
      )
      .map(({ indexPath }) => indexPath)
  );
}

/**
 * Say why a file can't be written now: it's reached through a symlink, or it
 * changed on disk since the check read it.
 *
 * @returns the problem, worded to follow the file's path, or `undefined`.
 */
function findWriteProblem(params: {
  edit: RecordEdit;
  repoRoot: string;
}): string | undefined {
  const { edit, repoRoot } = params;
  const { filePath, originalText } = edit;

  try {
    // Git commits a symlink, not the file it points to, so a fix written
    // through one would never show in the repo.
    if (findLinkedPath({ filePath, repoRoot }) !== undefined) {
      return "is reached through a symlink, and is fixed only at its own path";
    }

    return isRecordUnchanged({ filePath, repoRoot, text: originalText })
      ? undefined
      : "changed on disk while it was checked; run okf check --fix again";
  } catch (error) {
    return `can't be read again: ${describeError(error)}`;
  }
}

/**
 * Plan each record's fixes from its findings: sort its tags, write them as a
 * block list, and order its keys, each as its rule's options say.
 *
 * - `tags-layout` has a fix only for `block`; a flow list stays a finding.
 */
function planRecordFixes(params: {
  bundles: readonly CheckedBundle[];
  findings: readonly CheckFinding[];
  houseRules: HouseRules;
}): { edits: RecordEdit[]; refusals: string[] } {
  const { bundles, findings, houseRules } = params;
  const isBlockLayout = houseRules["tags-layout"]?.layout === "block";
  const keyOrder = houseRules["key-order"]?.order;
  const rulesByPath = new Map<string, Set<string>>();

  // A record whose source changed since it was written is left as it is:
  // a fix would give it a change of its own, which `T007` reads as the
  // record having caught up with its source.
  const staleSources = new Set(
    findings
      .filter(({ rule }) => rule === SOURCE_CHANGED)
      .map(({ path: filePath }) => filePath)
  );

  for (const { path: filePath, rule } of findings) {
    if (RECORD_RULES.has(rule) && !staleSources.has(filePath)) {
      const rules = rulesByPath.get(filePath) ?? new Set<string>();

      rules.add(rule);
      rulesByPath.set(filePath, rules);
    }
  }

  const edits: RecordEdit[] = [];
  const refusals: string[] = [];
  for (const { filePath, text } of bundles.flatMap((bundle) => bundle.files)) {
    const rules = rulesByPath.get(filePath) ?? new Set<string>();
    const shouldBlockTags = isBlockLayout && rules.has("tags-layout");
    const shouldSortTags = rules.has("tags-sorted");
    const shouldOrderKeys = rules.has("key-order");

    if (!shouldBlockTags && !shouldSortTags && !shouldOrderKeys) {
      continue;
    }

    const formatted = formatRecord({
      keyOrder: shouldOrderKeys ? keyOrder : undefined,
      shouldBlockTags,
      shouldSortTags,
      text,
    });

    // Each finding names a change the fix makes, so a fix that succeeds
    // always changes the text.
    if (formatted.isOk) {
      edits.push({ filePath, originalText: text, text: formatted.text });
    } else {
      refusals.push(`${filePath}: ${formatted.reason}`);
    }
  }

  return { edits, refusals };
}
