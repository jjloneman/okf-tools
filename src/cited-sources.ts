/*
 * The paths in the repo a record's `sources` cite, by §6's rules, for the
 * source rules and for the draft rule, which names the ones a branch changed.
 *
 * - Only a `sources[].resource` that resolves to a path in the repo counts; a
 *   URL, and a scope descriptor, which has a space a path would
 *   percent-encode, are skipped.
 *
 * - A path may leave the bundle, since a record written from code cites the
 *   code.
 */
import path from "node:path";
import { isSeq } from "yaml";

import type { CheckedFile } from "./check-engine.ts";
import type { ParsedFile } from "./spec-rules.ts";

import { readTimestamp } from "./frontmatter/shared.ts";
import { hasScheme } from "./markdown.ts";
import { decodePath } from "./spec-rules.ts";

/** A `sources` entry whose `resource` resolves to a path in the repo. */
export type CitedSource = {
  /**
   * Its `resource` node, for the line a finding is on.
   *
   * @example `parsed.read(entry, "resource")`
   */
  node: unknown;

  /**
   * The path it resolves to, from the repo root, with `/` separators.
   *
   * @example "src/check.ts"
   */
  path: string;

  /**
   * Its `resource` as written.
   *
   * @example "../../src/check.ts"
   */
  resource: string;
};

/**
 * Read each `sources` entry whose `resource` resolves to a path in the repo,
 * a bare mapping as one entry (§11.2).
 */
export function readCitedSources(parsed: ParsedFile): CitedSource[] {
  const sources = parsed.get("sources");

  // Anything but a list is read as one entry, which yields nothing unless
  // it's a mapping.
  const entries: unknown[] = isSeq(sources) ? sources.items : [sources];

  return entries.flatMap((entry) => {
    const node = parsed.read(parsed.resolve(entry), "resource");
    const resource = readTimestamp(node);

    if (resource === undefined) {
      return [];
    }

    const resolved = resolveSourcePath({ file: parsed.file, resource });

    return resolved === undefined ? [] : [{ node, path: resolved, resource }];
  });
}

/**
 * Resolve a `resource` to a path from the repo root, by §6's rules, or
 * `undefined` when it isn't a path in the repo.
 *
 * - A value with a space is a scope descriptor, since a path would
 *   percent-encode it (§6).
 */
function resolveSourcePath(params: {
  /** The record that cites it. @example `readCheckedFile(…)` */
  file: CheckedFile;

  /** The `resource` as written. @example "../../src/check.ts" */
  resource: string;
}): string | undefined {
  const { file, resource } = params;

  if (
    /\s/u.test(resource) ||
    hasScheme(resource) ||
    resource.startsWith("//") ||
    resource.startsWith("#")
  ) {
    return undefined;
  }

  const clean = decodePath(resource.replace(/[#?].*$/u, ""));
  const base = clean.startsWith("/")
    ? file.bundleDir
    : path.posix.dirname(file.filePath);
  const resolved = path.posix.join(base, clean).replace(/\/+$/u, "");

  return resolved === "." || resolved === ".." || resolved.startsWith("../")
    ? undefined
    : resolved;
}
