/*
 * Plain-text output for the CLI's non-prompt lines.
 *
 * - Every line starts with `[okf-verify]`, so its output is traceable in a log
 *   or an agent's transcript.
 */

/** The prefix on every line the CLI prints outside a prompt. */
const PREFIX = "[okf-verify]";

/** Word a caught value as a message, whatever was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Prefix each line of a message with `[okf-verify]`. */
export function formatLines(message: string): string {
  return message
    .trimEnd()
    .split("\n")
    .map((line) => (line === "" ? PREFIX : `${PREFIX} ${line}`))
    .join("\n");
}

/** Print a message to stderr, every line prefixed. */
export function printError(message: string): void {
  console.error(formatLines(message));
}

/** Print a message to stdout, every line prefixed. */
export function printInfo(message: string): void {
  console.log(formatLines(message));
}
