/*
 * The pure logic `okf migrate` runs on one bundle: it plans the edits that
 * move a bundle declared OKF v0.1 or v0.2, or undeclared, to v0.3, and the
 * problems only a person can settle.
 *
 * - v0.3 resolves a path without a leading `/` from the folder of the file
 *   that holds it, where v0.2's examples wrote path fields from the bundle
 *   root, so a bare path that resolves only from the root is rewritten to the
 *   relative path that reaches the same file, in the same step as the version
 *   bump.
 *
 * - Edits replace only the characters they change, by position, and never
 *   touch `generated` or `verified`, so a signed-off record stays current.
 *
 * - Code, fenced or inline, is never rewritten.
 */
import type { Scalar } from "yaml";

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Document, isAlias, isMap, isScalar, isSeq, parse, visit } from "yaml";

import type { Frontmatter, Placed } from "./frontmatter/shared.ts";

import {
  describeYamlErrors,
  isPlaced,
  parseFrontmatter,
  splitFrontmatter,
} from "./frontmatter/shared.ts";
import { findBodyStart, hasScheme, maskCode, splitLines } from "./markdown.ts";
import { SUPPORTED_SPEC_VERSION } from "./version.ts";

/** What `planBundle` came to for one bundle. */
export type BundlePlan = {
  /**
   * The files to rewrite, each with its text before and after; empty unless
   * `state` is `migrate`.
   *
   * @example `[{ after: "…", before: "…", filePath: "docs/a/b.md" }]`
   */
  changes: FileChange[];

  /**
   * The `okf_version` the bundle declares, or `undefined` for none.
   *
   * @example "0.2"
   */
  declared: string | undefined;

  /**
   * What the run reports beside the changes: values filled in, and what
   * needs a person.
   *
   * @example `[{ filePath: "docs/a/index.md", level: "filled", message: "…" }]`
   */
  notes: MigrateNote[];

  /**
   * Whether the bundle is already on v0.3, can be migrated, or can't be
   * until a person settles a `blocked` note.
   *
   * @example "migrate"
   */
  state: "current" | "migrate" | "refused";
};

/** A file the migration rewrites. */
export type FileChange = {
  /**
   * Its text after the edits.
   *
   * @example `"---\nokf_version: \"0.3\"\n---\n"`
   */
  after: string;

  /**
   * Its text as read.
   *
   * @example `"---\nokf_version: \"0.2\"\n---\n"`
   */
  before: string;

  /**
   * Its path from the repo root.
   *
   * @example "docs/decisions/index.md"
   */
  filePath: string;
};

/** Something a plan reports beside its edits. */
export type MigrateNote = {
  /**
   * The file it's about, from the repo root.
   *
   * @example "docs/decisions/a/b.md"
   */
  filePath: string;

  /**
   * How it bears on the run:
   *
   * - `blocked` stops the bundle migrating until a person settles it;
   * - `check` asks a person to look, but the migration changes nothing about
   *   it;
   * - `filled` says what the migration filled in.
   *
   * @example "check"
   */
  level: "blocked" | "check" | "filled";

  /**
   * What it says, worded to follow the file's path.
   *
   * @example "links to b.md, which resolves under neither rule"
   */
  message: string;
};

/** What `planBundle` reads: the bundle, its files, and the file system. */
export type PlanBundleParams = {
  /**
   * The bundle's folder, from the repo root; `.` for the repo root itself.
   *
   * @example "docs/decisions"
   */
  bundleDir: string;

  /**
   * Whether a path from the repo root names a file or folder on disk.
   *
   * @example `(filePath) => existsSync(path.join(repoRoot, filePath))`
   */
  doesExist: (filePath: string) => boolean;

  /**
   * The bundle's root `index.md` as read, or `undefined` when it has none.
   *
   * @example `"---\nokf_version: \"0.2\"\n---\n\n# Decisions\n"`
   */
  indexText: string | undefined;

  /**
   * The bundle's records, each with its path from the repo root and its text.
   *
   * @example `[{ filePath: "docs/decisions/a/b.md", text: "---\n…" }]`
   */
  records: readonly PlannedFile[];
};

/** A file the planner reads: its path from the repo root, and its text. */
export type PlannedFile = {
  /**
   * Its path from the repo root.
   *
   * @example "docs/decisions/a/b.md"
   */
  filePath: string;

  /**
   * Its text as read.
   *
   * @example `"---\ntype: Decision\n---\n"`
   */
  text: string;
};

/** One replacement in a file's text, by position. */
type Edit = {
  /**
   * Where the replaced text ends.
   *
   * @example 24
   */
  end: number;

  /**
   * Where it starts.
   *
   * @example 14
   */
  start: number;

  /**
   * What replaces it.
   *
   * @example `"\"0.3\""`
   */
  text: string;
};

/** What one file's plan came to: its edits and its notes. */
type FilePlan = {
  /**
   * The edits, in any order.
   *
   * @example `[{ end: 24, start: 14, text: "../b.md" }]`
   */
  edits: Edit[];

  /**
   * What it reports.
   *
   * @example `[{ filePath: "docs/a/b.md", level: "check", message: "…" }]`
   */
  notes: MigrateNote[];
};

/** A line of an index's body, as written and with its code masked. */
type IndexLine = {
  /**
   * The line as written, without its line break.
   *
   * @example "Records `okf` keeps."
   */
  content: string;

  /**
   * The same line with its code blanked out, at the same offsets.
   *
   * @example "Records      keeps."
   */
  masked: string;
};

/** Where a frontmatter path field sits: its keys from the top, and its node. */
type PathField = {
  /**
   * Its keys and list positions from the top of the frontmatter.
   *
   * @example `["sources", 0, "resource"]`
   */
  keys: (number | string)[];

  /**
   * Its node.
   *
   * @example `doc.getIn(["sources", 0, "resource"], true)`
   */
  node: Placed<Scalar>;
};

/** How a bare path reads under v0.2's bundle-root rule and v0.3's own. */
type Resolution =
  | {
      /**
       * It names a file from its own folder, or reads the same under both
       * rules: nothing to change.
       *
       * @example "same"
       */
      kind: "same";
    }
  | {
      /**
       * It names a file only from the bundle root: rewrite it to `value`.
       *
       * @example "rewrite"
       */
      kind: "rewrite";

      /**
       * The relative path that names the same file from its own folder.
       *
       * @example "../b.md"
       */
      value: string;
    }
  | {
      /**
       * It names no file under either rule.
       *
       * @example "unresolved"
       */
      kind: "unresolved";
    }
  | {
      /**
       * The file it names from its own file's folder, from the repo root.
       *
       * @example "docs/decisions/a/b.md"
       */
      fromFile: string;

      /**
       * The file it names from the bundle root, from the repo root.
       *
       * @example "docs/decisions/b.md"
       */
      fromRoot: string;

      /**
       * It names two different files: one from the root, one from the file.
       *
       * @example "ambiguous"
       */
      kind: "ambiguous";
    };

/** A Markdown link's target, by position in the masked body. */
type TargetMatch = {
  /**
   * Where the target starts in the body.
   *
   * @example 12
   */
  start: number;

  /**
   * The target as written, angle brackets included.
   *
   * @example `"<a b.md>"`
   */
  target: string;
};

/** The keys a bundle-root `index.md` declares the bundle with. */
const BUNDLE_KEYS = {
  description: "description",
  title: "title",
  version: "okf_version",
} as const;

/** A line that opens a block other than a paragraph: no description there. */
const BLOCK_START =
  /^ {0,3}(?:[#<>|]|[*+-](?:[\t ]|$)|\d{1,9}[.)](?:[\t ]|$)|`{3}|~{3}|\[[^\]]*\]:)/u;

/** The top-level path fields a concept may hold (v0.3 §6.2). */
const TOP_PATH_KEYS = ["computation", "resource", "superseded_by"] as const;

/** The mappings whose `resource` is a path field (v0.3 §10). */
const RESOURCE_HOLDERS = ["attester", "executor"] as const;

/** An ATX heading: its text, without the closing `#`s. */
const HEADING =
  /^ {0,3}#{1,6}[\t ]+(?<text>.*?)(?:[\t ]+#+)?[\t ]*$|^ {0,3}#{1,6}[\t ]*$/u;

/** The v0.1 `# Citations` heading, which v0.3 no longer reads. */
const CITATIONS_HEADING = /^ {0,3}#[\t ]+Citations[\t ]*#*[\t ]*$/mu;

/**
 * An inline link or image's target, after `](`: angle-bracketed, or a run
 * with balanced parentheses one deep.
 */
const INLINE_TARGET =
  /(?<=(?<!\\)\]\([\t ]*)(?:<[^<>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)/gu;

/** A plain YAML scalar a rewritten path can stay as, with no quoting. */
const PLAIN_PATH = /^[\w%+./~][\w%+./=@~-]*$/u;

/**
 * A link reference definition's target; a footnote's `[^label]:` isn't one.
 */
const REFERENCE_TARGET =
  /(?<=^ {0,3}\[(?!\^)(?:\\.|[^\n\\\]])+\]:[\t ]*)(?:<[^<>\n]*>|\S+)/gmu;

/**
 * Why frontmatter with an anchor or alias isn't edited: replacing an anchored
 * value would change every alias to it too.
 */
const ANCHORS_REFUSAL =
  "uses YAML anchors or aliases, which okf migrate doesn't edit, since a change would reach every alias; edit it by hand";

/** The version a bundle that declares none is read as. */
export const UNDECLARED_VERSION = "0.2";

/** A version as `<major>.<minor>`. */
const VERSION = /^(?<major>\d+)\.(?<minor>\d+)$/u;

/**
 * Plan one bundle's migration to v0.3: the edits to its root `index.md` and
 * its records, and what needs a person.
 *
 * - A bundle declaring v0.3 plans nothing; one declaring a newer version, or
 *   one with no root `index.md` to declare it in, is refused.
 *
 * - Any `blocked` note refuses the whole bundle, so it never half-migrates.
 */
export function planBundle(params: PlanBundleParams): BundlePlan {
  const { bundleDir, indexText, records } = params;
  const indexPath = path.posix.join(bundleDir, "index.md");

  if (indexText === undefined) {
    return refuse({
      declared: undefined,
      notes: [
        {
          filePath: indexPath,
          level: "blocked",
          message: `doesn't exist, so the bundle can't declare okf_version ${SUPPORTED_SPEC_VERSION}; add one with a heading, then run okf migrate again`,
        },
      ],
    });
  }

  const declared = readDeclaredVersion(indexText);

  if (!declared.isOk) {
    return refuse({
      declared: undefined,
      notes: [
        { filePath: indexPath, level: "blocked", message: declared.reason },
      ],
    });
  }

  const order = compareVersions({
    left: declared.value ?? UNDECLARED_VERSION,
    right: SUPPORTED_SPEC_VERSION,
  });

  if (order === undefined || order > 0) {
    const version = JSON.stringify(declared.value);

    return refuse({
      declared: declared.value,
      notes: [
        {
          filePath: indexPath,
          level: "blocked",
          message:
            order === undefined
              ? `declares okf_version ${version}, which isn't a <major>.<minor> version`
              : `declares okf_version ${version}, newer than the ${SUPPORTED_SPEC_VERSION} okf migrate writes; upgrade okf-tools instead`,
        },
      ],
    });
  }

  if (order === 0) {
    return {
      changes: [],
      declared: declared.value,
      notes: [],
      state: "current",
    };
  }

  const changes: FileChange[] = [];
  const notes: MigrateNote[] = [];
  const files: { filePath: string; plan: FilePlan; text: string }[] = [
    {
      filePath: indexPath,
      plan: planIndex({ indexPath, text: indexText }),
      text: indexText,
    },
    ...records.map((file) => ({
      ...file,
      plan: planRecord({ ...params, file }),
    })),
  ];

  for (const { filePath, plan, text } of files) {
    notes.push(...plan.notes);

    if (plan.edits.length > 0) {
      changes.push({
        after: applyEdits({ edits: plan.edits, text }),
        before: text,
        filePath,
      });
    }
  }

  return notes.some((note) => note.level === "blocked")
    ? refuse({ declared: declared.value, notes })
    : { changes, declared: declared.value, notes, state: "migrate" };
}

/** Apply edits to a text, from the last to the first, so positions hold. */
function applyEdits(params: { edits: readonly Edit[]; text: string }): string {
  const { edits } = params;
  let { text } = params;

  for (const edit of [...edits].sort(
    (left, right) => right.start - left.start
  )) {
    text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
  }

  return text;
}

/**
 * Check that edited frontmatter means the original plus the intended values,
 * and nothing more.
 *
 * @returns why it doesn't, or `undefined` when it does.
 */
function checkFrontmatter(params: {
  after: string;
  before: string;
  intended: readonly { keys: readonly (number | string)[]; value: string }[];
}): string | undefined {
  const { after, before, intended } = params;
  const edited = readFrontmatterDoc(after);
  const expected = new Document(readFrontmatterDoc(before).toJS() ?? {});

  for (const { keys, value } of intended) {
    expected.setIn(keys, value);
  }

  // A last guard: no edit planned today parses to anything else, but one
  // that did must never be written.
  return describeYamlErrors(edited) === undefined &&
    isDeepStrictEqual(edited.toJS(), expected.toJS())
    ? undefined
    : "the edit wouldn't leave the frontmatter as valid YAML meaning only what's intended";
}

/**
 * Compare two `<major>.<minor>` versions.
 *
 * @returns below `0`, `0`, or above `0`, or `undefined` when either isn't one.
 */
function compareVersions(params: {
  left: string;
  right: string;
}): number | undefined {
  const left = VERSION.exec(params.left)?.groups;
  const right = VERSION.exec(params.right)?.groups;

  if (left === undefined || right === undefined) {
    return undefined;
  }

  return (
    Number(left.major) - Number(right.major) ||
    Number(left.minor) - Number(right.minor)
  );
}

/** Decode a percent-encoded path, or keep it as written when it can't be. */
function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Describe a path that names different files under the two rules. */
function describeAmbiguity(params: {
  label: string;
  resolution: Extract<Resolution, { kind: "ambiguous" }>;
}): string {
  const { label, resolution } = params;

  return `${label} names ${resolution.fromRoot} from the bundle root but ${resolution.fromFile} from its own folder; point it at one by hand`;
}

/** Say why a bundle's `title` or `description` couldn't be filled in. */
function describeMissing(params: {
  hasHeading: boolean;
  key: "description" | "title";
}): string {
  const { hasHeading, key } = params;

  if (!hasHeading) {
    return `has no heading to take a ${key} from`;
  }

  return key === BUNDLE_KEYS.title
    ? "has an empty first heading to take a title from"
    : "has no paragraph after its first heading to take a description from";
}

/**
 * Read a description from an index body: the paragraph right after its first
 * heading, on one line.
 *
 * @returns the text, or `undefined` when the heading isn't followed by one.
 */
function findDescription(params: {
  headingLine: number;
  lines: readonly IndexLine[];
}): string | undefined {
  const { headingLine, lines } = params;
  const paragraph: string[] = [];

  // Read as written: a fence's lines are masked blank, which would skip it.
  for (const { content } of lines.slice(headingLine + 1)) {
    if (content.trim() === "") {
      if (paragraph.length > 0) {
        break;
      }

      continue;
    }

    if (BLOCK_START.test(content)) {
      break;
    }

    paragraph.push(content.trim());
  }

  const text = paragraph.join(" ");

  return text === "" ? undefined : text;
}

/** Whether a frontmatter holds a YAML anchor or alias anywhere. */
function hasAnchors(doc: Document): boolean {
  let isFound = false;

  visit(doc, {
    Node: (_key, node) => {
      if (isAlias(node) || node.anchor !== undefined) {
        isFound = true;

        return visit.BREAK;
      }

      return undefined;
    },
  });

  return isFound;
}

/** List a record's path fields that hold a single text value. */
function listPathFields(doc: Document): PathField[] {
  const fields: PathField[] = [];
  const add = (keys: (number | string)[]): void => {
    const node = doc.getIn(keys, true);

    if (isScalar(node) && isPlaced(node) && typeof node.value === "string") {
      fields.push({ keys, node });
    }
  };

  for (const key of TOP_PATH_KEYS) {
    add([key]);
  }

  const sources = doc.get("sources", true);

  if (isSeq(sources)) {
    for (const [index, item] of sources.items.entries()) {
      if (isMap(item)) {
        add(["sources", index, "resource"]);
      }
    }
  } else if (isMap(sources)) {
    add(["sources", "resource"]);
  }

  for (const holder of RESOURCE_HOLDERS) {
    if (isMap(doc.get(holder, true))) {
      add([holder, "resource"]);
    }
  }

  return fields;
}

/** Find every link target in a masked body, inline or a reference. */
function listTargets(masked: string): TargetMatch[] {
  return [
    ...masked.matchAll(INLINE_TARGET),
    ...masked.matchAll(REFERENCE_TARGET),
  ].map((match) => ({ start: match.index, target: match[0] }));
}

/**
 * Plan a bundle-root `index.md`: declare v0.3, and fill in a missing `title`
 * and `description` from its first heading and the paragraph after it.
 */
function planIndex(params: { indexPath: string; text: string }): FilePlan {
  const { indexPath, text } = params;
  const block = splitFrontmatter(text);
  const doc = parseFrontmatter(block?.text ?? "");
  const lineBreak = block?.lineBreak ?? (text.includes("\r\n") ? "\r\n" : "\n");
  const notes: MigrateNote[] = [];
  const intended: { keys: string[]; value: string }[] = [
    { keys: [BUNDLE_KEYS.version], value: SUPPORTED_SPEC_VERSION },
  ];
  const edits: Edit[] = [];
  const versionLine = `${BUNDLE_KEYS.version}: "${SUPPORTED_SPEC_VERSION}"${lineBreak}`;
  const versionNode = doc.get(BUNDLE_KEYS.version, true);

  if (hasAnchors(doc)) {
    return {
      edits: [],
      notes: [
        { filePath: indexPath, level: "blocked", message: ANCHORS_REFUSAL },
      ],
    };
  }

  // `readDeclaredVersion` already refused any other shape.
  if (isScalar(versionNode) && isPlaced(versionNode) && block !== undefined) {
    const [start, end] = versionNode.range;

    edits.push({
      end: block.start + end,
      start: block.start + start,
      text: `"${SUPPORTED_SPEC_VERSION}"`,
    });
  }

  const bodyStart = findBodyStart(text);
  const lines = readIndexLines(text.slice(bodyStart));

  // Code is masked only to find the heading; the values keep it.
  const headingLine = lines.findIndex(({ masked }) => HEADING.test(masked));
  const heading = lines[headingLine]?.content;
  const added: string[] = [];

  for (const key of [BUNDLE_KEYS.title, BUNDLE_KEYS.description] as const) {
    if (doc.has(key)) {
      const existing: unknown = doc.get(key);

      if (existing === null || existing === "") {
        notes.push({
          filePath: indexPath,
          level: "check",
          message: `has an empty ${key}; fill it in by hand`,
        });
      }

      continue;
    }

    const value =
      heading === undefined
        ? undefined
        : readBundleValue({ heading, headingLine, key, lines });

    if (value === undefined || value === "") {
      notes.push({
        filePath: indexPath,
        level: "check",
        message: `${describeMissing({ hasHeading: heading !== undefined, key })}; add ${key} to its frontmatter by hand`,
      });

      continue;
    }

    added.push(`${key}: ${JSON.stringify(value)}${lineBreak}`);
    intended.push({ keys: [key], value });
    notes.push({
      filePath: indexPath,
      level: "filled",
      message: `${key} filled in as ${JSON.stringify(value)}`,
    });
  }

  if (block === undefined) {
    edits.push({
      end: bodyStart,
      start: bodyStart,
      text: `---${lineBreak}${versionLine}${added.join("")}---${lineBreak}`,
    });
  } else {
    const prepend = isScalar(versionNode) ? "" : versionLine;

    if (block.start === block.end) {
      edits.push({
        end: block.start,
        start: block.start,
        text: `${prepend}${added.join("")}`,
      });
    } else {
      edits.push(
        { end: block.start, start: block.start, text: prepend },
        { end: block.end, start: block.end, text: added.join("") }
      );
    }
  }

  const real = edits.filter(
    (edit) => edit.text !== "" || edit.end > edit.start
  );
  const problem = checkFrontmatter({
    after: applyEdits({ edits: real, text }),
    before: text,
    intended,
  });

  return problem === undefined
    ? { edits: real, notes }
    : {
        edits: [],
        notes: [
          {
            filePath: indexPath,
            level: "blocked",
            message: `can't be migrated: ${problem}`,
          },
        ],
      };
}

/**
 * Plan a record's path fields: rewrite each that names a file only from the
 * bundle root, and report one that's ambiguous or names nothing.
 */
function planPathFields(
  params: {
    block: { start: number };
    doc: Document;
    file: PlannedFile;
    fileDir: string;
  } & PlanBundleParams
): {
  edits: Edit[];
  intended: { keys: (number | string)[]; value: string }[];
  notes: MigrateNote[];
} {
  const { block, bundleDir, doc, doesExist, file, fileDir } = params;
  const { filePath } = file;
  const edits: Edit[] = [];
  const intended: { keys: (number | string)[]; value: string }[] = [];
  const notes: MigrateNote[] = [];

  for (const { keys, node } of listPathFields(doc)) {
    const written = String(node.value);
    const { suffix, value } = splitSuffix(written);
    const resolution = resolveBare({ bundleDir, doesExist, fileDir, value });
    const [start, end] = node.range;
    const label = `${keys.join(".")} ${JSON.stringify(written)}`;

    if (resolution.kind === "rewrite") {
      const rewritten = `${resolution.value}${suffix}`;

      if (node.type === "BLOCK_FOLDED" || node.type === "BLOCK_LITERAL") {
        notes.push({
          filePath,
          level: "blocked",
          message: `${label} names a file only from the bundle root, in a block scalar okf migrate doesn't rewrite; change it to ${JSON.stringify(rewritten)} by hand`,
        });
        continue;
      }

      edits.push({
        end: block.start + end,
        start: block.start + start,
        text: writeScalar({ type: node.type, value: rewritten }),
      });
      intended.push({ keys, value: rewritten });
    } else if (resolution.kind === "ambiguous") {
      notes.push({
        filePath,
        level: "blocked",
        message: describeAmbiguity({ label, resolution }),
      });
    } else if (resolution.kind === "unresolved" && !/\s/u.test(written)) {
      // A value with whitespace is a scope descriptor, not a path (§5.1).
      notes.push({
        filePath,
        level: "check",
        message: `${label} names no file under either rule`,
      });
    }
  }

  return { edits, intended, notes };
}

/**
 * Plan one record: rewrite each bare path that names a file only from the
 * bundle root, in a path field or a Markdown link, and report what v0.3 no
 * longer reads.
 */
function planRecord(
  params: { file: PlannedFile } & PlanBundleParams
): FilePlan {
  const { bundleDir, doesExist, file } = params;
  const { filePath, text } = file;
  const fileDir = path.posix.relative(bundleDir, path.posix.dirname(filePath));
  const block = splitFrontmatter(text);
  const doc = parseFrontmatter(block?.text ?? "");
  const notes: MigrateNote[] = [];
  const edits: Edit[] = [];
  const note = (entry: Pick<MigrateNote, "level" | "message">): void => {
    notes.push({ filePath, ...entry });
  };

  if (doc.has("timestamp") && !doc.has("generated")) {
    note({
      level: "check",
      message:
        "has a v0.1 `timestamp`, which v0.3 no longer reads; move it into `generated` by hand",
    });
  }

  const bodyStart = findBodyStart(text);
  const masked = maskCode(text.slice(bodyStart));

  if (CITATIONS_HEADING.test(masked) && !doc.has("sources")) {
    note({
      level: "check",
      message:
        "has a v0.1 `# Citations` list, which v0.3 no longer reads; move it into `sources` by hand",
    });
  }

  // A file at the bundle root reads a bare path the same under both rules.
  if (fileDir === "") {
    return { edits, notes };
  }

  if (block !== undefined) {
    const fields = planPathFields({ ...params, block, doc, fileDir });

    notes.push(...fields.notes);

    if (fields.edits.length > 0) {
      const problem = hasAnchors(doc)
        ? ANCHORS_REFUSAL
        : checkFrontmatter({
            after: applyEdits({ edits: fields.edits, text }),
            before: text,
            intended: fields.intended,
          });

      if (problem !== undefined) {
        return {
          edits: [],
          notes: [
            ...notes,
            {
              filePath,
              level: "blocked",
              message:
                problem === ANCHORS_REFUSAL
                  ? problem
                  : `can't be migrated: ${problem}`,
            },
          ],
        };
      }

      edits.push(...fields.edits);
    }
  }

  for (const { start, target } of listTargets(masked)) {
    const isAngled = target.startsWith("<");
    const inner = isAngled ? target.slice(1, -1) : target;
    const { suffix, value } = splitSuffix(inner);
    const resolution = resolveBare({ bundleDir, doesExist, fileDir, value });

    // v0.2 read a bare link from its own file too, so one that names a file
    // from there means the same under both versions, whatever the root holds.
    if (resolution.kind === "rewrite") {
      const rewritten = `${resolution.value}${suffix}`;

      edits.push({
        end: bodyStart + start + target.length,
        start: bodyStart + start,
        text: isAngled ? `<${rewritten}>` : rewritten,
      });
    } else if (resolution.kind === "unresolved") {
      note({
        level: "check",
        message: `links to ${inner}, which names no file under either rule`,
      });
    }
  }

  return { edits, notes };
}

/**
 * Read a bundle's `title` from an index body's first heading, or its
 * `description` from the paragraph after it.
 *
 * @returns the text, or `undefined` when there's none to take.
 */
function readBundleValue(params: {
  heading: string;
  headingLine: number;
  key: "description" | "title";
  lines: readonly IndexLine[];
}): string | undefined {
  const { heading, headingLine, key, lines } = params;

  return key === BUNDLE_KEYS.title
    ? HEADING.exec(heading)?.groups?.text?.trim()
    : findDescription({ headingLine, lines });
}

/**
 * Read the `okf_version` a bundle-root `index.md` declares.
 *
 * @returns the version, `undefined` for none, or why it can't be read.
 */
function readDeclaredVersion(
  text: string
): { isOk: false; reason: string } | { isOk: true; value: string | undefined } {
  const block = splitFrontmatter(text);

  if (block === undefined) {
    return { isOk: true, value: undefined };
  }

  const doc = parseFrontmatter(block.text);

  if (
    describeYamlErrors(doc) !== undefined ||
    (doc.contents !== null && !isMap(doc.contents))
  ) {
    return {
      isOk: false,
      reason: "has frontmatter that isn't a valid YAML mapping",
    };
  }

  const node = doc.get(BUNDLE_KEYS.version, true);

  if (node === undefined) {
    return { isOk: true, value: undefined };
  }

  return isScalar(node) &&
    typeof node.value === "string" &&
    node.value !== "" &&
    node.type !== "BLOCK_FOLDED" &&
    node.type !== "BLOCK_LITERAL"
    ? { isOk: true, value: node.value }
    : {
        isOk: false,
        reason:
          'has an okf_version that isn\'t a single quoted or plain version, such as "0.2"',
      };
}

/** Parse a text's frontmatter, or an empty document when it has none. */
function readFrontmatterDoc(text: string): Frontmatter {
  return parseFrontmatter(splitFrontmatter(text)?.text ?? "");
}

/** Split an index body into lines, each as written and with code masked. */
function readIndexLines(body: string): IndexLine[] {
  const maskedBody = maskCode(body);
  let offset = 0;

  return splitLines(body).map(({ content, ending }) => {
    const masked = maskedBody.slice(offset, offset + content.length);

    offset += content.length + ending.length;

    return { content, masked };
  });
}

/** A plan that migrates nothing, for a bundle a person must settle first. */
function refuse(params: {
  declared: string | undefined;
  notes: MigrateNote[];
}): BundlePlan {
  return { changes: [], ...params, state: "refused" };
}

/**
 * Read a path as v0.2 bundles wrote it, from the bundle root, and as v0.3
 * reads it, from its own file's folder.
 *
 * - Only a bare path counts: a URL, a `/` path, a fragment, or one that
 *   opens with `./` or `../` reads the same under both rules.
 *
 * - A path that climbs out of the bundle names no file in it.
 */
function resolveBare(params: {
  bundleDir: string;
  doesExist: (filePath: string) => boolean;
  fileDir: string;
  value: string;
}): Resolution {
  const { bundleDir, doesExist, fileDir, value } = params;

  if (
    value === "" ||
    value === "." ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    hasScheme(value)
  ) {
    return { kind: "same" };
  }

  // `fileDir` is never the bundle root here, so the two always differ.
  const fromRoot = path.posix.normalize(value);
  const fromFile = path.posix.normalize(path.posix.join(fileDir, value));

  const exists = (bundlePath: string): boolean =>
    bundlePath !== ".." &&
    !bundlePath.startsWith("../") &&
    doesExist(path.posix.join(bundleDir, decodePath(bundlePath)));
  const isFromRoot = exists(fromRoot);
  const isFromFile = exists(fromFile);

  if (isFromRoot && isFromFile) {
    return {
      fromFile: path.posix.join(bundleDir, fromFile),
      fromRoot: path.posix.join(bundleDir, fromRoot),
      kind: "ambiguous",
    };
  }

  if (isFromRoot) {
    const relative = path.posix.relative(fileDir, fromRoot) || ".";

    return {
      kind: "rewrite",
      value:
        value.endsWith("/") && !relative.endsWith("/")
          ? `${relative}/`
          : relative,
    };
  }

  return isFromFile ? { kind: "same" } : { kind: "unresolved" };
}

/** Split a path from its `#fragment` or `?query`, which resolve with it. */
function splitSuffix(written: string): { suffix: string; value: string } {
  const cut = written.search(/[#?]/u);

  return cut === -1
    ? { suffix: "", value: written }
    : { suffix: written.slice(cut), value: written.slice(0, cut) };
}

/**
 * Write a path as a YAML scalar in the style it was written in, quoting a
 * plain one that would no longer read back as plain text.
 */
function writeScalar(params: { type: Scalar["type"]; value: string }): string {
  const { type, value } = params;

  if (type === "QUOTE_SINGLE") {
    return `'${value.replaceAll("'", "''")}'`;
  }

  // A plain path such as `null` or `1.5` reads as something other than text
  // under YAML's core schema, which most readers use.
  return type === "QUOTE_DOUBLE" ||
    !PLAIN_PATH.test(value) ||
    parse(value) !== value
    ? JSON.stringify(value)
    : value;
}
