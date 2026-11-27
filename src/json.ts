/*
 * Readers for parsed JSON that arrives as `unknown`, such as GitHub's
 * answers and the drafts file `okf check --review-file` writes.
 *
 * - Each narrows rather than casts, so a field of the wrong type reads as
 *   missing instead of slipping through.
 */

/** Read a value as a list, or an empty one when it isn't. */
export function readArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: unknown[] = value;

  return items;
}

/** Read a nested field of parsed JSON, or nothing when a step is missing. */
export function readPath(params: {
  /** The keys to follow, outermost first. @example `["head", "sha"]` */
  keys: readonly string[];

  /** The parsed JSON to read from. @example `{ head: { sha: "4c2a9f0" } }` */
  value: unknown;
}): unknown {
  return params.keys.reduce<unknown>(
    (value, key): unknown =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Reflect.get(value, key)
        : undefined,
    params.value
  );
}
