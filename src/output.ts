/*
 * Plain-text output for the CLI's non-prompt lines.
 *
 * - Every line starts with the program's name in brackets, `[okf]` or
 *   `[okf-verify]`, so its output is traceable in a log or an agent's
 *   transcript.
 */

/** Where a run prints its non-prompt lines, every line prefixed. */
export type Output = {
  /**
   * Print a message to stderr.
   *
   * @example `output.error("No files changed.")`
   */
  error: (message: string) => void;

  /**
   * Print a message to stdout.
   *
   * @example `output.info("Nothing to verify.")`
   */
  info: (message: string) => void;
};

/**
 * A command the package installs, which names its output lines.
 *
 * - `okf-verify` is the alias for `okf verify`.
 */
export type Program = "okf-verify" | "okf";

/** The output for a program, prefixing every line with `[<program>]`. */
export function createOutput(program: Program): Output {
  const prefix = `[${program}]`;

  return {
    error: (message) => {
      console.error(formatLines({ message, prefix }));
    },
    info: (message) => {
      console.log(formatLines({ message, prefix }));
    },
  };
}

/** Word a caught value as a message, whatever was thrown. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Prefix each line of a message. */
export function formatLines(params: {
  /**
   * The message, which may span lines.
   *
   * @example "Nothing to verify."
   */
  message: string;

  /**
   * What every line starts with.
   *
   * @example "[okf]"
   */
  prefix: string;
}): string {
  const { message, prefix } = params;

  return message
    .trimEnd()
    .split("\n")
    .map((line) => (line === "" ? prefix : `${prefix} ${line}`))
    .join("\n");
}
