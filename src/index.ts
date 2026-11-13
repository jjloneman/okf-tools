/*
 * The package's library entry: the pure frontmatter functions `okf-verify` is
 * built on, and `run`, the CLI itself, for tools that call it in-process.
 */
export type { RunParams } from "./cli.ts";
export { run } from "./cli.ts";
export type { ExitCode } from "./exit-codes.ts";
export { EXIT_CODES } from "./exit-codes.ts";
export type { RecordVerification } from "./frontmatter/edit.ts";
export { verifyRecord } from "./frontmatter/edit.ts";
export type {
  ReadRecordSummaryParams,
  RecordState,
  RecordSummary,
} from "./frontmatter/read.ts";
export { getRecordState, readRecordSummary } from "./frontmatter/read.ts";
export type {
  RecordStatus,
  Timestamp,
  VerifyRecordParams,
} from "./frontmatter/types.ts";
export { RECORD_STATUSES } from "./frontmatter/types.ts";
