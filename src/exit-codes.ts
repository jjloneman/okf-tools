/** The exit codes the CLI ends with. */
export const EXIT_CODES = {
  /** A usage error, a git failure, or a record that refused the edit. */
  failure: 1,

  /** `--yes` found nothing that still needs a sign-off. */
  nothingToVerify: 2,

  /** The run worked, or the person cancelled it. */
  ok: 0,
} as const;

/** One of the CLI's exit codes. */
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
