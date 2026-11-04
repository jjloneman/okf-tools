/**
 * Read a line by index, or an empty string past either end.
 *
 * - The frontmatter helpers index only lines they just found, so the empty
 *   string stands in for a line that can't be missing, without a non-null
 *   assertion.
 */
export function lineAt(params: {
  index: number;
  lines: readonly string[];
}): string {
  const { index, lines } = params;

  return lines[index] ?? "";
}
