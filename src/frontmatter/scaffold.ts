/*
 * Writes a new record's frontmatter, for `okf new`.
 *
 * - The record is a draft no one has signed off, so it never has `verified`.
 *
 * - Nothing here touches the file system or the clock; the caller passes the
 *   timestamp in.
 */
import { Document, parse, Scalar } from "yaml";

import type { Timestamp } from "./types.ts";

import { createEntry } from "./meaning.ts";
import { FRONTMATTER_KEYS } from "./shared.ts";
import { RECORD_STATUSES } from "./types.ts";

/** What `scaffoldRecord` writes into a new record's frontmatter. */
export type ScaffoldRecordParams = {
  /**
   * The time to write as `generated.at`.
   *
   * @example "2026-11-25T21:24:51Z"
   */
  at: Timestamp;

  /**
   * Who wrote the record, written as `generated.by`.
   *
   * @example "claude-code/claude-opus-5-5"
   */
  by: string;

  /**
   * Its `description`, left out when `undefined`.
   *
   * @example "Every export returns a fallback instead of throwing."
   */
  description: string | undefined;

  /**
   * Its tags, written as a block list in the order given; none leaves `tags`
   * out.
   *
   * @example `["api", "cli"]`
   */
  tags: readonly string[];

  /**
   * Its `title`, left out when `undefined`.
   *
   * @example "What every export promises"
   */
  title: string | undefined;

  /**
   * Its `type`.
   *
   * @example "Decision"
   */
  type: string;
};

/**
 * Write a new record: a frontmatter block of `type`, then `title`,
 * `description`, and `tags` when given, then `status: draft` and an inline
 * `generated` entry, with no body.
 *
 * - Each value is quoted only where YAML 1.2 or 1.1 needs it to read back as
 *   the text given.
 */
export function scaffoldRecord(params: ScaffoldRecordParams): string {
  const { at, by, description, tags, title, type } = params;
  const doc = new Document({
    [FRONTMATTER_KEYS.type]: toScalar(type),
    ...(title === undefined
      ? {}
      : { [FRONTMATTER_KEYS.title]: toScalar(title) }),
    ...(description === undefined
      ? {}
      : { [FRONTMATTER_KEYS.description]: toScalar(description) }),
    ...(tags.length === 0
      ? {}
      : { [FRONTMATTER_KEYS.tags]: tags.map((tag) => toScalar(tag)) }),
    [FRONTMATTER_KEYS.status]: RECORD_STATUSES.draft,
  });

  doc.set(FRONTMATTER_KEYS.generated, createEntry({ at, verifiedBy: by }));

  return `---\n${doc.toString({ lineWidth: 0 })}---\n`;
}

/**
 * Make a scalar of the text given, double-quoted when YAML 1.1 would read it
 * as anything else.
 *
 * - The writer quotes what YAML 1.2 would misread, but readers such as
 *   js-yaml's default schema and PyYAML follow 1.1, where `no` is false and
 *   `2026-11-25` is a date.
 */
function toScalar(text: string): Scalar {
  const scalar = new Scalar(text);
  let isReadBack: boolean;

  try {
    isReadBack = parse(text, { version: "1.1" }) === text;
  } catch {
    isReadBack = false;
  }

  if (!isReadBack) {
    scalar.type = Scalar.QUOTE_DOUBLE;
  }

  return scalar;
}
