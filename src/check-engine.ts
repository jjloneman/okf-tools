/*
 * The engine `okf check` runs its rules on: each file read once into a
 * `CheckedFile`, every rule run over it, and the findings gathered into a
 * report.
 *
 * - A rule is pure: it gets a file or a bundle and returns what it found, so
 *   a later rule set adds rules to a list without touching the engine.
 *
 * - Frontmatter is read with the parser `okf verify` uses, so `check` and
 *   `verify` never disagree about whether a record's frontmatter reads.
 */
import type { Document, YAMLMap } from "yaml";

import { isMap, isNode } from "yaml";

import {
  findFenceProblem,
  parseFrontmatter,
  splitFrontmatter,
} from "./frontmatter/shared.ts";

/** What a bundle-wide rule found, with the file it's about. */
export type BundleHit = {
  /**
   * The file's path from the repo root, which may not exist.
   *
   * @example "docs/decisions/index.md"
   */
  path: string;
} & RuleHit;

/** A bundle as the bundle-wide rules see it: its folder and its files. */
export type CheckedBundle = {
  /**
   * The bundle's folder from the repo root, with `/` separators.
   *
   * @example "docs/decisions"
   */
  bundleDir: string;

  /**
   * Every Markdown file the bundle holds, in path order.
   *
   * @example `[{ filePath: "docs/decisions/index.md", … }]`
   */
  files: readonly CheckedFile[];
};

/** A Markdown file in a bundle, read once for every rule. */
export type CheckedFile = {
  /**
   * Its text at the commit the branch's changes are judged against, when it
   * changed since and that commit holds it.
   *
   * @example `"---\ntype: Decision\n---\n"`
   */
  baseText: string | undefined;

  /**
   * The folder of the bundle that holds it, the deepest when bundles nest.
   *
   * @example "docs/decisions"
   */
  bundleDir: string;

  /**
   * Whether a path from the repo root names a file or folder that exists.
   *
   * @example `(filePath) => existsSync(path.join(repoRoot, filePath))`
   */
  doesExist: (filePath: string) => boolean;

  /**
   * Whether its first line is exactly `---`, a byte order mark and a CR
   * aside: what OKF counts as opening frontmatter.
   *
   * @example false
   */
  doesOpenWithFence: boolean;

  /**
   * Its path from the repo root, with `/` separators.
   *
   * @example "docs/decisions/a.md"
   */
  filePath: string;

  /**
   * Its frontmatter as `okf verify` reads it.
   *
   * @example `{ kind: "absent" }`
   */
  frontmatter: FrontmatterState;

  /**
   * Whether it sits directly in the bundle's folder, not in a subfolder.
   *
   * @example true
   */
  isAtBundleRoot: boolean;

  /**
   * What OKF makes of it by its name: an `index.md`, a `log.md`, or any
   * other Markdown file.
   *
   * @example "log"
   */
  kind: FileKind;

  /**
   * The changes git knows to a path from the repo root, a file or a folder:
   * its commits, and its uncommitted changes when it has any; empty for a
   * path no record here cites.
   *
   * @example `(filePath) => changes.get(filePath) ?? []`
   */
  readChanges: (filePath: string) => readonly FileChange[];

  /**
   * Which commits to the paths a record cites aren't in the history of any
   * commit that re-stamped or signed off the record, by the record's path
   * from the repo root.
   *
   * - A commit is in that history when it's one of those commits or an
   *   ancestor of one.
   *
   * - `undefined` when git couldn't say, or for a path that isn't a record
   *   citing a path in the repo.
   *
   * @example `(filePath) => unseen.get(filePath)`
   */
  readUnseenCommits: (filePath: string) => undefined | UnseenCommits;

  /**
   * Its text, as read.
   *
   * @example `"---\ntype: Decision\n---\n"`
   */
  text: string;
};

/** A finding as `okf check` reports it. */
export type CheckFinding = {
  /**
   * The rule's code, as upstream's `validate.py` numbers it.
   *
   * @example "E005"
   */
  code: string;

  /**
   * The 1-based line it's on, or `null` when it's about a file that isn't
   * there.
   *
   * @example 3
   */
  line: null | number;

  /**
   * What's wrong, naming the spec section.
   *
   * @example "a log.md date heading must be YYYY-MM-DD (§9); found \"May 1\""
   */
  message: string;

  /**
   * The file's path from the repo root.
   *
   * @example "docs/decisions/log.md"
   */
  path: string;

  /**
   * The rule's name.
   *
   * @example "log-date-heading"
   */
  rule: string;

  /**
   * How much it matters: an `error` fails the run.
   *
   * @example "error"
   */
  severity: CheckSeverity;
};

/**
 * What `okf check --format json` prints.
 *
 * - The shape is public: a change to it bumps `schemaVersion`.
 */
export type CheckReport = {
  /**
   * How many findings there are at each severity.
   *
   * @example `{ error: 1, info: 0, warning: 2 }`
   */
  counts: Record<CheckSeverity, number>;

  /**
   * How many Markdown files were checked.
   *
   * @example 12
   */
  filesChecked: number;

  /**
   * Every finding, by bundle, then path, then line.
   *
   * @example `[{ code: "E005", line: 3, … }]`
   */
  findings: CheckFinding[];

  /**
   * The version of this shape.
   *
   * @example 1
   */
  schemaVersion: typeof CHECK_SCHEMA_VERSION;

  /**
   * The files that couldn't be read, so weren't checked, and why.
   *
   * @example `[{ path: "docs/decisions/b.md", reason: "…" }]`
   */
  skipped: CheckSkipped[];
};

/**
 * One rule: its code, name and severity, and what it checks, a file at a
 * time or a whole bundle.
 */
export type CheckRule = {
  /**
   * Check a whole bundle, for what no single file shows, such as a missing
   * root `index.md`.
   *
   * @example `(bundle) => []`
   */
  checkBundle?: (bundle: CheckedBundle) => BundleHit[];

  /**
   * Check one file.
   *
   * @example `(file) => []`
   */
  checkFile?: (file: CheckedFile) => RuleHit[];

  /**
   * Its code, as upstream's `validate.py` numbers it: `E` for an error, `W`
   * for a warning, `I` for information.
   *
   * @example "E005"
   */
  code: string;

  /**
   * Its name, in kebab-case.
   *
   * @example "log-date-heading"
   */
  name: string;

  /**
   * How much a finding matters.
   *
   * @example "error"
   */
  severity: CheckSeverity;
};

/**
 * How much a finding matters: an `error` breaks the bundle's conformance
 * with OKF and fails the run; a `warning` is a value OKF's other sections
 * advise against; `info` needs no fix.
 */
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

/** A file `okf check` couldn't read, and why. */
export type CheckSkipped = {
  /**
   * Its path from the repo root.
   *
   * @example "docs/decisions/b.md"
   */
  path: string;

  /**
   * Why it couldn't be read, naming the path.
   *
   * @example "docs/decisions/b.md can't be read: EACCES: permission denied"
   */
  reason: string;
};

/** A change git knows to a path: a commit, or its uncommitted changes. */
export type FileChange = {
  /**
   * When it was made, in whole seconds since the epoch: the commit's
   * committer time, or now for uncommitted changes.
   *
   * @example 1790000000
   */
  at: number;

  /**
   * The commit, or `undefined` for uncommitted changes.
   *
   * @example `{ hash: "1a2b3c4d…", shortHash: "1a2b3c4" }`
   */
  commit: { hash: string; shortHash: string } | undefined;
};

/** What OKF makes of a Markdown file by its name. */
export type FileKind = "index" | "log" | "markdown";

/**
 * A file's frontmatter as `okf verify` reads it: none, a block that can't be
 * read, or a parsed mapping.
 */
export type FrontmatterState =
  | {
      /**
       * The file has no frontmatter.
       *
       * @example "absent"
       */
      kind: "absent";
    }
  | {
      /**
       * The parsed frontmatter, every value as text.
       *
       * @example `parseFrontmatter("type: Decision\n")`
       */
      doc: Document.Parsed;

      /**
       * The block parsed as a mapping, or an empty one.
       *
       * @example "parsed"
       */
      kind: "parsed";

      /**
       * The mapping, or `undefined` for an empty block.
       *
       * @example `doc.contents`
       */
      map: undefined | YAMLMap;

      /**
       * Where the frontmatter's text starts in the file.
       *
       * @example 4
       */
      start: number;
    }
  | {
      /**
       * Whether the parser's complaint is a key given twice.
       *
       * @example false
       */
      isDuplicateKey: boolean;

      /**
       * A block was found but can't be read.
       *
       * @example "broken"
       */
      kind: "broken";

      /**
       * The line the problem is on.
       *
       * @example 3
       */
      line: number;

      /**
       * Why it can't be read, on one line.
       *
       * @example "Map keys must be unique"
       */
      reason: string;
    };

/** What a rule found: a line and a message; the engine adds the rest. */
export type RuleHit = {
  /**
   * The 1-based line, or `null` for a file that isn't there.
   *
   * @example 3
   */
  line: null | number;

  /**
   * What's wrong, naming the spec section.
   *
   * @example "log.md has no frontmatter (§9)"
   */
  message: string;
};

/**
 * Which commits to the paths a record cites aren't in the history of any
 * commit that re-stamped or signed off the record: changed its `generated`
 * or its `verified`.
 */
export type UnseenCommits = {
  /**
   * Whether the record's `generated` or `verified` in the working tree
   * differs from `HEAD`'s, as an uncommitted re-stamp or sign-off makes it;
   * always for a record no commit holds yet.
   *
   * @example true
   */
  hasUncommittedStamp: boolean;

  /**
   * The record's newest commit that re-stamped or signed it off, or
   * `undefined` when none did.
   *
   * @example `{ hash: "5e6f7a8b…", shortHash: "5e6f7a8" }`
   */
  lastSeen: FileChange["commit"];

  /**
   * The commits, by full hash.
   *
   * @example `new Set(["1a2b3c4d…"])`
   */
  unseen: ReadonlySet<string>;
};

/** The version of the JSON report's shape. */
export const CHECK_SCHEMA_VERSION = 1;

/** The severities, from most to least serious. */
export const CHECK_SEVERITIES = ["error", "warning", "info"] as const;

/** A byte order mark, which belongs to the file and not its first line. */
const BYTE_ORDER_MARK = "﻿";

/** The yaml package's code for a key given twice in one mapping. */
const DUPLICATE_KEY = "DUPLICATE_KEY";

/** Run every rule over the bundles, and gather the findings into a report. */
export function buildCheckReport(params: {
  /**
   * The bundles, each with its files, in the order they're configured.
   *
   * @example `[{ bundleDir: "docs/decisions", files: [] }]`
   */
  bundles: readonly CheckedBundle[];

  /**
   * Whether a file is one to report on; every file is, unless given.
   *
   * - A bundle-wide rule still sees every file, so only its findings are
   *   narrowed.
   *
   * @example `(filePath) => changed.has(filePath)`
   */
  isInScope?: ((filePath: string) => boolean) | undefined;

  /**
   * The rules to run.
   *
   * @example `SPEC_RULES`
   */
  rules: readonly CheckRule[];

  /**
   * The files that couldn't be read.
   *
   * @example `[]`
   */
  skipped: readonly CheckSkipped[];
}): CheckReport {
  const { bundles, isInScope = () => true, rules, skipped } = params;
  const findings: CheckFinding[] = [];
  let filesChecked = 0;

  for (const bundle of bundles) {
    const found: CheckFinding[] = [];
    const files = bundle.files.filter((file) => isInScope(file.filePath));

    filesChecked += files.length;

    for (const rule of rules) {
      const named = {
        code: rule.code,
        rule: rule.name,
        severity: rule.severity,
      };

      for (const hit of rule.checkBundle?.(bundle) ?? []) {
        if (isInScope(hit.path)) {
          found.push({ ...named, ...hit });
        }
      }

      for (const file of files) {
        for (const hit of rule.checkFile?.(file) ?? []) {
          found.push({ ...named, ...hit, path: file.filePath });
        }
      }
    }

    findings.push(...found.sort(compareFindings));
  }

  return {
    counts: {
      error: countSeverity({ findings, severity: "error" }),
      info: countSeverity({ findings, severity: "info" }),
      warning: countSeverity({ findings, severity: "warning" }),
    },
    filesChecked,
    findings,
    schemaVersion: CHECK_SCHEMA_VERSION,
    skipped: [...skipped],
  };
}

/** Read a Markdown file once, for every rule to check. */
export function readCheckedFile(params: {
  baseText?: string | undefined;
  bundleDir: string;
  doesExist: (filePath: string) => boolean;
  filePath: string;
  readChanges?: ((filePath: string) => readonly FileChange[]) | undefined;
  readUnseenCommits?:
    ((filePath: string) => undefined | UnseenCommits) | undefined;
  text: string;
}): CheckedFile {
  const {
    bundleDir,
    filePath,
    readChanges = () => [],
    readUnseenCommits = () => undefined,
    text,
  } = params;
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const folder = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : ".";
  const firstLine = (
    text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  ).replace(/\r?\n[\s\S]*/u, "");

  return {
    ...params,
    baseText: params.baseText,
    doesOpenWithFence: firstLine === "---",
    frontmatter: readFrontmatterState({
      doesOpenWithFence: firstLine === "---",
      text,
    }),
    isAtBundleRoot: folder === bundleDir,
    kind: readKind(name),
    readChanges,
    readUnseenCommits,
  };
}

/**
 * Find the 1-based line of a node in a file's frontmatter, or of the opening
 * fence when it has none to point at.
 */
export function readNodeLine(params: {
  file: CheckedFile;
  node: unknown;
}): number {
  const { file, node } = params;
  const { frontmatter } = file;

  if (frontmatter.kind !== "parsed" || !isNode(node) || !node.range) {
    return 1;
  }

  return toLine({ index: frontmatter.start + node.range[0], text: file.text });
}

/** Order findings by path, then line, with a file-wide one first. */
function compareFindings(left: CheckFinding, right: CheckFinding): number {
  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }

  return (left.line ?? 0) - (right.line ?? 0);
}

/** Count the findings at one severity. */
function countSeverity(params: {
  findings: readonly CheckFinding[];
  severity: CheckSeverity;
}): number {
  const { findings, severity } = params;

  return findings.filter((finding) => finding.severity === severity).length;
}

/**
 * Read a file's frontmatter: none, a block that can't be read, or a map.
 *
 * - A block that doesn't close counts only when the first line is exactly
 *   `---`, as OKF says frontmatter opens, so Markdown that opens with a rule
 *   or a `----` break isn't taken for broken frontmatter.
 */
function readFrontmatterState(params: {
  doesOpenWithFence: boolean;
  text: string;
}): FrontmatterState {
  const { doesOpenWithFence, text } = params;
  const block = splitFrontmatter(text);

  if (block === undefined) {
    const problem = doesOpenWithFence ? findFenceProblem(text) : undefined;

    return problem === undefined
      ? { kind: "absent" }
      : { isDuplicateKey: false, kind: "broken", line: 1, reason: problem };
  }

  const doc = parseFrontmatter(block.text);
  const [error] = doc.errors;

  if (error !== undefined) {
    return {
      isDuplicateKey: error.code === DUPLICATE_KEY,
      kind: "broken",
      line: toLine({ index: block.start + error.pos[0], text }),
      reason: error.message
        .replace(/\n[\s\S]*/u, "")
        .replace(/ at line \d+, column \d+:?$/u, ""),
    };
  }

  const { contents } = doc;

  if (contents !== null && !isMap(contents)) {
    return {
      isDuplicateKey: false,
      kind: "broken",
      line: toLine({ index: block.start, text }),
      reason: "it isn't a mapping of keys to values",
    };
  }

  return {
    doc,
    kind: "parsed",
    map: contents ?? undefined,
    start: block.start,
  };
}

/** Name what OKF makes of a Markdown file by its name. */
function readKind(name: string): FileKind {
  if (name === "index.md") {
    return "index";
  }

  return name === "log.md" ? "log" : "markdown";
}

/** Find the 1-based line a position in a text is on. */
function toLine(params: { index: number; text: string }): number {
  const { index, text } = params;

  return text.slice(0, index).split("\n").length;
}
