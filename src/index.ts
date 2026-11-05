/*
 * The package's library entry: the pure frontmatter functions `okf-verify` is
 * built on, and `run`, the CLI itself, for tools that call it in-process.
 */
export type { RunParams } from "./cli.ts";
export { run } from "./cli.ts";
export type { ExitCode } from "./exit-codes.ts";
export { EXIT_CODES } from "./exit-codes.ts";
export type {
  ReadRecordSummaryParams,
  RecordState,
  RecordStatus,
  RecordSummary,
  RecordVerification,
  Timestamp,
  VerifyRecordParams,
} from "./okf-frontmatter.ts";
export {
  getRecordState,
  readRecordSummary,
  RECORD_STATUSES,
  verifyRecord,
} from "./okf-frontmatter.ts";
