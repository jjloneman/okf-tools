/*
 * The package's library entry: the pure frontmatter functions `okf-verify` is
 * built on, `run`, the CLI itself, for tools that call it in-process, and the
 * shapes `okf status --format json` and `okf tags --format json` print.
 */
export type { RunParams } from "./cli.ts";
export { run } from "./cli.ts";
export type { ExitCode } from "./exit-codes.ts";
export { EXIT_CODES } from "./exit-codes.ts";
export type {
  FindEditProblemParams,
  RecordVerification,
} from "./frontmatter/edit.ts";
export { findEditProblem, verifyRecord } from "./frontmatter/edit.ts";
export type {
  ReadRecordSummaryParams,
  RecordState,
  RecordSummary,
  RecordTimes,
} from "./frontmatter/read.ts";
export {
  findFrontmatterProblem,
  getRecordState,
  readRecordSummary,
} from "./frontmatter/read.ts";
export type {
  EntryStyle,
  RecordStatus,
  RefusalKind,
  Timestamp,
  VerifyRecordParams,
} from "./frontmatter/types.ts";
export {
  ENTRY_STYLES,
  RECORD_STATUSES,
  REFUSAL_KINDS,
} from "./frontmatter/types.ts";
export type { Program } from "./output.ts";
export type {
  StatusGroup,
  StatusRecord,
  StatusReport,
  StatusSkipped,
} from "./status.ts";
export type { TagCount, TagsReport, TagsSkipped } from "./tags.ts";
