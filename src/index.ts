/*
 * The package's library entry: the pure frontmatter functions `okf-verify` is
 * built on, `signOffRecord` among them as the sign-off it makes; `run`, the
 * CLI itself, for tools that call it in-process; and the shapes
 * `okf check --format json`, `okf status --format json`, and
 * `okf tags --format json` print.
 */
export type {
  CheckFinding,
  CheckReport,
  CheckSeverity,
  CheckSkipped,
  FindingSource,
} from "./check-engine.ts";
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
  TrustTimes,
} from "./frontmatter/read.ts";
export {
  findFrontmatterProblem,
  getRecordState,
  getTrustTier,
  readRecordSummary,
} from "./frontmatter/read.ts";
export { findSignOffProblem, signOffRecord } from "./frontmatter/sign-off.ts";
export type {
  EntryStyle,
  RecordStatus,
  RefusalKind,
  Timestamp,
  TrustTier,
  Verification,
  VerifyRecordParams,
} from "./frontmatter/types.ts";
export {
  ENTRY_STYLES,
  RECORD_STATUSES,
  REFUSAL_KINDS,
  TRUST_TIERS,
} from "./frontmatter/types.ts";
export type { Program } from "./output.ts";
export type {
  StatusGroup,
  StatusRecord,
  StatusReport,
  StatusSkipped,
} from "./status.ts";
export type { TagCount, TagsReport, TagsSkipped } from "./tags.ts";
