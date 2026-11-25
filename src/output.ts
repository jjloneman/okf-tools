/*
 * Plain-text output for the CLI's non-prompt lines.
 *
 * - Every line starts with the program's name in brackets, `[okf]` or
 *   `[okf-verify]`, so its output is traceable in a log or an agent's
 *   transcript.
 *
 * - Data for a program to read, such as `okf status --format json`, is the
 *   exception: a prefix would stop it parsing.
 */

/**
 * Where a run prints its non-prompt lines, every line prefixed but the data a
 * program reads.
 */
export type Output = {
  /**
   * Print data for a program to read to stdout, as it is, with no prefix.
   *
   * @example `output.data(JSON.stringify(report))`
   */
  data: (text: string) => void;

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
    data: (text) => {
      console.log(text);
    },
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
