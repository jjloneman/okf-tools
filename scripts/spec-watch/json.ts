/*
 * Readers for the JSON the GitHub API answers with, which arrives as
 * `unknown`.
 *
 * - Each narrows rather than casts, so a field of the wrong type reads as
 *   missing instead of slipping through.
 */

/** A JSON object, as opposed to an array, a primitive, or `null`. */
export type JsonObject = Record<string, unknown>;

/** Whether a parsed JSON value is an object, rather than an array or a primitive. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a boolean field, or `undefined` when it is missing or not a boolean. */
export function readBoolean({
  key,
  value,
}: {
  /** The field's name. */
  key: string;

  /** The parsed JSON value to read from. */
  value: unknown;
}): boolean | undefined {
  const field = isJsonObject(value) ? value[key] : undefined;

  return typeof field === "boolean" ? field : undefined;
}

/** Read any field, or `undefined` when the value isn't an object. */
export function readField({
  key,
  value,
}: {
  /** The field's name. */
  key: string;

  /** The parsed JSON value to read from. */
  value: unknown;
}): unknown {
  return isJsonObject(value) ? value[key] : undefined;
}

/** Read a number field, or `undefined` when it is missing or not a number. */
export function readNumber({
  key,
  value,
}: {
  /** The field's name. */
  key: string;

  /** The parsed JSON value to read from. */
  value: unknown;
}): number | undefined {
  const field = isJsonObject(value) ? value[key] : undefined;

  return typeof field === "number" ? field : undefined;
}

/** Read a string field, or `undefined` when it is missing or not a string. */
export function readString({
  key,
  value,
}: {
  /** The field's name. */
  key: string;

  /** The parsed JSON value to read from. */
  value: unknown;
}): string | undefined {
  const field = isJsonObject(value) ? value[key] : undefined;

  return typeof field === "string" ? field : undefined;
}
