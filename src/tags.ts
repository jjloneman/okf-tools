/*
 * `okf tags`: every tag in the bundles with how many records carry it, as
 * text for a person or JSON for a program.
 *
 * - It reads each record's frontmatter, so a block list, a one-line flow
 *   list, and a flow list Prettier wrapped over lines all count alike.
 *
 * - It never writes, and exits `0` whatever it finds.
 */
import type { ExitCode } from "./exit-codes.ts";
import type { TagsFormat } from "./options.ts";
import type { LoadedRecords } from "./repo.ts";
import type { BundleContext } from "./run-context.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { NO_SIGNER } from "./index-command.ts";
import { toTerminalLine } from "./output.ts";
import { loadCandidates } from "./repo.ts";

/** One tag in an `okf tags` report. */
export type TagCount = {
  /**
   * How many records carry it.
   *
   * @example 3
   */
  count: number;

  /**
   * The tag, as written.
   *
   * @example "cli"
   */
  name: string;
};

/**
 * What `okf tags --format json` prints.
 *
 * - The shape is public: a change to it bumps `schemaVersion`.
 */
export type TagsReport = {
  /**
   * The version of this shape.
   *
   * @example 1
   */
  schemaVersion: typeof TAGS_SCHEMA_VERSION;

  /**
   * The files that couldn't be read as records, and why; their tags aren't
   * counted.
   *
   * @example `[{ path: "docs/decisions/b.md", reason: "…" }]`
   */
  skipped: TagsSkipped[];

  /**
   * Every tag, sorted by name in code-unit order.
   *
   * @example `[{ count: 3, name: "cli" }]`
   */
  tags: TagCount[];
};

/** A file `okf tags` couldn't read as a record, and why. */
export type TagsSkipped = {
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

/** The version of the JSON report's shape. */
export const TAGS_SCHEMA_VERSION = 1;

/** Count each tag across the loaded records, sorted by name. */
export function buildTagsReport(loaded: LoadedRecords): TagsReport {
  const counts = new Map<string, number>();

  for (const { summary } of loaded.candidates) {
    for (const tag of summary.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return {
    schemaVersion: TAGS_SCHEMA_VERSION,
    skipped: loaded.skipped.map(({ filePath, reason }) => ({
      path: filePath,
      reason,
    })),
    tags: [...counts]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([name, count]) => ({ count, name })),
  };
}

/** Word the report for a person: one tag a line, then the skipped files. */
export function formatTagsText(report: TagsReport): string {
  const sections = [
    report.tags.length === 0
      ? "No tags."
      : report.tags
          .map(({ count, name }) => `${toTerminalLine(name)} (${count})`)
          .join("\n"),
  ];

  if (report.skipped.length > 0) {
    sections.push(
      [
        `Skipped (${report.skipped.length})`,
        ...report.skipped.map(({ reason }) => `  ${toTerminalLine(reason)}`),
      ].join("\n")
    );
  }

  return sections.join("\n\n");
}

/** Run `okf tags`: load the records, then print every tag with its count. */
export function runTags(params: {
  context: BundleContext;
  format: TagsFormat;
}): ExitCode {
  const { context, format } = params;
  const { bundleDirs, excludeGlobs, output, repoRoot } = context;

  const loaded = loadCandidates({
    bundleDirs,
    excludeGlobs,
    isReadOnly: true,
    repoRoot,
    verifiedBy: NO_SIGNER,
  });

  if (!loaded.isOk) {
    output.error(loaded.reason);

    return EXIT_CODES.failure;
  }

  const report = buildTagsReport(loaded.value);

  if (format === "json") {
    output.data(JSON.stringify(report, undefined, 2));
  } else {
    output.info(formatTagsText(report));
  }

  return EXIT_CODES.ok;
}
