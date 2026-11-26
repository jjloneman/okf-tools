/*
 * The rules OKF v0.3's SPEC.md states, for `okf check`.
 *
 * - Each rule's code, severity, and wording follow upstream's own checker,
 *   `skills/okf-generate/scripts/validate.py` at the pinned commit, so the
 *   two tools report a finding the same way.
 *
 * - An error is what §11.1 makes a conformance failure: frontmatter that
 *   doesn't parse as a mapping, and an `index.md` or `log.md` that breaks §8
 *   or §9. Everything else is a warning, or information that needs no fix,
 *   as upstream has it.
 *
 * - A key the spec doesn't define passes without a finding, so a repo can
 *   use okf-tools beside a tool that adds its own keys.
 */
import { DateTime } from "luxon";
import path from "node:path";
import { isMap, isScalar, isSeq } from "yaml";

import type {
  BundleHit,
  CheckedBundle,
  CheckedFile,
  CheckRule,
  RuleHit,
} from "./check-engine.ts";

import { readNodeLine } from "./check-engine.ts";
import { getRecordState, isStale } from "./frontmatter/read.ts";
import {
  isNullScalar,
  readTimestamp,
  resolveAlias,
} from "./frontmatter/shared.ts";
import {
  findBodyStart,
  hasScheme,
  maskCode,
  maskFences,
  splitLines,
} from "./markdown.ts";

/** A parsed file's frontmatter, as the concept and index rules read it. */
export type ParsedFile = {
  /**
   * The file.
   *
   * @example `readCheckedFile({ … })`
   */
  file: CheckedFile;

  /**
   * Read a top-level key's value, an alias resolved.
   *
   * @example `parsed.get("status")`
   */
  get: (key: string) => unknown;

  /**
   * Read a key of a mapping, an alias resolved for either, or `undefined`
   * when the value isn't a mapping.
   *
   * @example `read(parsed.get("generated"), "by")`
   */
  read: (from: unknown, key: string) => unknown;

  /**
   * Follow an alias to the node its anchor names, or return the node.
   *
   * @example `resolve(item)`
   */
  resolve: (node: unknown) => unknown;
};

/** A date-time with an offset, in RFC 3339's form. */
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/u;

/** A date alone, as a `log.md` heading and a date-only timestamp write it. */
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** An actor: `<producer>/<version>` or `<scheme>:<id>` (§7). */
const ACTOR = /^(?:[^\s/:]+\/\S+|[A-Za-z][\d+.A-Za-z-]*:\S+)$/u;

/** An SPDX license expression, as upstream recognizes one. */
const SPDX = /^[\d+.A-Za-z-]+(?: (?:AND|OR|WITH) [\d+.A-Za-z-]+)*$/u;

/** A footnote reference or definition, and its label. */
const FOOTNOTE = /\[\^(?<label>[^\s\]]+)\]/gu;

/** An inline link, not an image, and its target. */
const LINK =
  /(?<!!)\[[^\]]*\]\(\s*<?(?<target>[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/gu;

/**
 * A plain scalar YAML 1.2's core schema reads as a number or a boolean, not
 * text: what §4 asks producers to quote.
 */
const CORE_NON_STRING =
  /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?|0o[0-7]+|0x[\dA-Fa-f]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN)|true|True|TRUE|false|False|FALSE)$/u;

/** The `status` values §5.4 defines. */
const STATUSES: ReadonlySet<string> = new Set([
  "deprecated",
  "draft",
  "stable",
]);

/** The concept keys §4 expects as text. */
const TEXT_KEYS = ["description", "status", "title", "type"] as const;

/**
 * The spec rules, by code.
 *
 * - The codes are upstream's; a gap is a rule okf-tools doesn't run yet.
 */
export const SPEC_RULES: readonly CheckRule[] = [
  {
    checkFile: (file) =>
      readsFrontmatter(file) &&
      file.frontmatter.kind === "broken" &&
      !file.frontmatter.isDuplicateKey
        ? [
            {
              line: file.frontmatter.line,
              message: `frontmatter doesn't parse as a YAML mapping: ${file.frontmatter.reason} (§4)`,
            },
          ]
        : [],
    code: "E002",
    name: "frontmatter-parses",
    severity: "error",
  },
  {
    checkFile: (file) =>
      file.kind === "index" && !file.isAtBundleRoot && file.doesOpenWithFence
        ? [
            {
              line: 1,
              message:
                "an index.md below the bundle root must have no frontmatter (§8)",
            },
          ]
        : [],
    code: "E004",
    name: "subfolder-index-frontmatter",
    severity: "error",
  },
  {
    checkFile: (file) =>
      readLogHeadings(file)
        .filter(({ date }) => date === undefined)
        .map(({ heading, line }) => ({
          line,
          message: `a log.md date heading must be YYYY-MM-DD (§9); found "${heading}"`,
        })),
    code: "E005",
    name: "log-date-heading",
    severity: "error",
  },
  {
    checkFile: (file) =>
      file.kind === "log" && file.doesOpenWithFence
        ? [{ line: 1, message: "log.md must have no frontmatter (§9)" }]
        : [],
    code: "E006",
    name: "log-frontmatter",
    severity: "error",
  },
  {
    checkFile: (file) =>
      readsFrontmatter(file) &&
      file.frontmatter.kind === "broken" &&
      file.frontmatter.isDuplicateKey
        ? [
            {
              line: file.frontmatter.line,
              message: "frontmatter repeats a key; keys must be unique (§4)",
            },
          ]
        : [],
    code: "E007",
    name: "frontmatter-unique-keys",
    severity: "error",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => {
        const node = parsed.get("stale_after");
        const staleAfter = readTimestamp(node);

        return staleAfter !== undefined &&
          isValidTimestamp(staleAfter) &&
          isStale({ staleAfter })
          ? [
              {
                line: readNodeLine({ file, node }),
                message: `the concept is stale: stale_after ${staleAfter} has passed (§5.5)`,
              },
            ]
          : [];
      }),
    code: "I201",
    name: "stale",
    severity: "info",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => {
        const generatedAt = readTimestamp(readGeneratedAt(parsed)[0]?.node);
        const times = readEvents(parsed)
          .filter(({ isComplete }) => isComplete)
          .map(({ at }) => readTimestamp(at) ?? "")
          .filter(isValidTimestamp);

        return generatedAt === undefined ||
          !isValidTimestamp(generatedAt) ||
          times.length === 0 ||
          times.some(
            (verifiedAt) =>
              getRecordState({ generatedAt, verifiedAt }) === "verified"
          )
          ? []
          : [
              {
                line: readNodeLine({ file, node: parsed.get("verified") }),
                message:
                  "no verification is current: each verified event is older than generated.at, so consumers read the concept as unverified (§5.3)",
              },
            ];
      }),
    code: "I204",
    name: "no-current-verification",
    severity: "info",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => [
        ...readGeneratedAt(parsed).flatMap(({ field, node }) =>
          checkTimestamp({ field, file, node })
        ),
        ...readEvents(parsed)
          .filter(({ isComplete }) => isComplete)
          .flatMap(({ at, index }) =>
            checkTimestamp({ field: `verified[${index}].at`, file, node: at })
          ),
        ...checkStaleAfter({ file, node: parsed.get("stale_after") }),
      ]),
    code: "W101",
    name: "timestamp-format",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => {
        const generated = parsed.get("generated");

        return isBlank(generated) || readGeneratedBy(parsed).length > 0
          ? []
          : [
              {
                line: readNodeLine({ file, node: generated }),
                message: "generated is a mapping with a by field (§5.2)",
              },
            ];
      }),
    code: "W102",
    name: "generated-shape",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => [
        ...readGeneratedBy(parsed).flatMap((node) =>
          checkActor({ field: "generated.by", file, node })
        ),
        ...readEvents(parsed)
          .filter(({ isComplete }) => isComplete)
          .flatMap(({ by, index }) =>
            checkActor({ field: `verified[${index}].by`, file, node: by })
          ),
      ]),
    code: "W103",
    name: "actor-format",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) =>
        readEvents(parsed)
          .filter(({ isComplete }) => !isComplete)
          .map(({ index, node }) => ({
            line: readNodeLine({ file, node }),
            message: `verified[${index}] needs by and at; consumers ignore it (§5.2)`,
          }))
      ),
    code: "W104",
    name: "verified-event-shape",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => {
        const status = parsed.get("status");
        const value = readTimestamp(status);

        return isBlank(status) || (value !== undefined && STATUSES.has(value))
          ? []
          : [
              {
                line: readNodeLine({ file, node: status }),
                message: `status is draft, stable, or deprecated; consumers treat ${value === undefined ? "this value" : `"${value}"`} as not current (§5.4)`,
              },
            ];
      }),
    code: "W105",
    name: "status-value",
    severity: "warning",
  },
  {
    checkFile: (file) => withConcept(file, (parsed) => checkFootnotes(parsed)),
    code: "W108",
    name: "footnote-source",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => {
        const tags = parsed.get("tags");

        if (isBlank(tags) || isSeq(tags)) {
          return [];
        }

        const value = readTimestamp(tags);

        return [
          {
            line: readNodeLine({ file, node: tags }),
            message:
              value === undefined
                ? "write tags as a YAML list of strings (§4.1)"
                : `write tags as a YAML list (§4.1, §11.2)${value.includes(",") ? `; consumers read it as the single tag "${value}"` : ""}`,
          },
        ];
      }),
    code: "W110",
    name: "tags-list",
    severity: "warning",
  },
  {
    checkBundle: (bundle) =>
      withEachFile({
        bundle,
        check: (file, canFallBack) =>
          file.kind === "index" || isConceptFile(file)
            ? checkLinks({ canFallBack, file })
            : [],
      }),
    code: "W115",
    name: "link-target",
    severity: "warning",
  },
  {
    checkBundle: (bundle) =>
      withEachFile({
        bundle,
        check: (file, canFallBack) =>
          checkSupersededBy({ canFallBack, file, kind: "missing" }),
      }),
    checkFile: (file) =>
      withRootIndex(file, (parsed) => {
        const license = parsed.get("license");
        const value = readTimestamp(license);

        return value === undefined ||
          SPDX.test(value) ||
          resolvePath({ canFallBack: false, file, target: value }) !== "missing"
          ? []
          : [
              {
                line: readNodeLine({ file, node: license }),
                message: `license "${value}" is not an SPDX expression or a file in the bundle (§8.1)`,
              },
            ];
      }),
    code: "W116",
    name: "path-target",
    severity: "warning",
  },
  {
    checkFile: (file) => [
      ...withConcept(file, (parsed) =>
        TEXT_KEYS.flatMap((key) =>
          checkQuoted({ file, key, node: parsed.get(key) })
        )
      ),
      ...withRootIndex(file, (parsed) =>
        checkQuoted({
          file,
          key: "okf_version",
          node: parsed.get("okf_version"),
        })
      ),
    ],
    code: "W117",
    name: "string-quoted",
    severity: "warning",
  },
  {
    checkFile: (file) => {
      const hits: RuleHit[] = [];
      let newer: string | undefined;

      for (const { date, line } of readLogHeadings(file)) {
        if (date !== undefined && newer !== undefined && date > newer) {
          hits.push({
            line,
            message: `log.md puts the newest date first (§9); ${date} follows ${newer}`,
          });
        }

        newer = date ?? newer;
      }

      return hits;
    },
    code: "W118",
    name: "log-date-order",
    severity: "warning",
  },
  {
    checkBundle: (bundle) =>
      withEachFile({
        bundle,
        check: (file, canFallBack) =>
          checkSupersededBy({ canFallBack, file, kind: "fallback" }),
      }),
    code: "W119",
    name: "path-root-fallback",
    severity: "warning",
  },
  {
    checkFile: (file) => {
      if (file.kind !== "markdown") {
        return [];
      }

      if (file.frontmatter.kind === "absent") {
        return [
          {
            line: 1,
            message: "not a concept: the file has no frontmatter (§3.2)",
          },
        ];
      }

      const parsed = readParsed(file);

      return parsed !== undefined && !isConcept(parsed)
        ? [
            {
              line: 1,
              message:
                "not a concept: the frontmatter has no non-empty type (§3.2)",
            },
          ]
        : [];
    },
    code: "W120",
    name: "not-a-concept",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) =>
        [
          ...readGeneratedAt(parsed),
          ...readEvents(parsed)
            .filter(({ isComplete }) => isComplete)
            .map(({ at, index }) => ({
              field: `verified[${index}].at`,
              node: at,
            })),
        ].flatMap(({ field, node }) =>
          isDateOnly(readTimestamp(node) ?? "")
            ? [
                {
                  line: readNodeLine({ file, node }),
                  message: `write ${field} as a date-time, because consumers compare generated.at with verified[].at (§5)`,
                },
              ]
            : []
        )
      ),
    code: "W122",
    name: "date-only-trust-time",
    severity: "warning",
  },
  {
    checkFile: (file) =>
      withConcept(file, (parsed) => {
        const supersededBy = parsed.get("superseded_by");

        return isBlank(supersededBy) ||
          readTimestamp(parsed.get("status")) === "deprecated"
          ? []
          : [
              {
                line: readNodeLine({ file, node: supersededBy }),
                message:
                  "superseded_by has a meaning only with status: deprecated (§5.4)",
              },
            ];
      }),
    code: "W123",
    name: "superseded-by-status",
    severity: "warning",
  },
  {
    checkBundle: checkBundleVersion,
    checkFile: (file) => {
      if (file.kind !== "index" || !file.isAtBundleRoot) {
        return [];
      }

      if (file.frontmatter.kind === "absent") {
        return [
          {
            line: 1,
            message:
              'give the root index.md frontmatter with okf_version: "0.3" (§8.1)',
          },
        ];
      }

      return withRootIndex(file, (parsed) =>
        isBlank(parsed.get("okf_version"))
          ? [
              {
                line: 1,
                message: 'add okf_version: "0.3" to the root index.md (§8.1)',
              },
            ]
          : []
      );
    },
    code: "W125",
    name: "bundle-version",
    severity: "warning",
  },
];

/**
 * Whether a bundle reads a bare path field from its root too, v0.2's
 * reading (§6.2): its root `index.md` declares `okf_version` 0.2 or earlier,
 * or no version it can be read as.
 */
export function canFallBackToRoot(bundle: CheckedBundle): boolean {
  const indexPath = path.posix.join(bundle.bundleDir, "index.md");
  const index = bundle.files.find((file) => file.filePath === indexPath);
  const parsed = index === undefined ? undefined : readParsed(index);
  const declared = readTimestamp(parsed?.get("okf_version"))?.split(".");

  if (!declared?.every((part) => /^\d+$/u.test(part))) {
    return true;
  }

  // Compared as upstream compares tuples, so 0.2.1 is past 0.2.
  const [major = 0, minor = 0, ...rest] = declared.map(Number);

  return major === 0 && (minor < 2 || (minor === 2 && rest.length === 0));
}

/**
 * Decode a link's or path field's percent escapes, or keep it as written
 * when they're bad.
 */
export function decodePath(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** Whether a file is a concept: Markdown whose `type` is non-empty (§3.2). */
export function isConceptFile(file: CheckedFile): boolean {
  const parsed = readParsed(file);

  return file.kind === "markdown" && parsed !== undefined && isConcept(parsed);
}

/** Whether a timestamp is in one of §5's forms and names a real instant. */
export function isValidTimestamp(value: string): boolean {
  return (
    (DATE_TIME.test(value) || DATE.test(value)) &&
    DateTime.fromISO(value, { zone: "utc" }).isValid
  );
}

/** Read each `verified` event, a bare mapping as one (§5.2). */
export function readEvents(parsed: ParsedFile): {
  at: unknown;
  by: unknown;
  index: number;
  isComplete: boolean;
  node: unknown;
}[] {
  const verified = parsed.get("verified");

  if (isBlank(verified)) {
    return [];
  }

  const items: unknown[] = isSeq(verified) ? verified.items : [verified];

  return items.map((item, index) => {
    const node = parsed.resolve(item);
    const by = parsed.read(node, "by");
    const at = parsed.read(node, "at");

    return {
      at,
      by,
      index,
      isComplete: !isBlank(by) && !isBlank(at),
      node,
    };
  });
}

/**
 * Read each footnote label in a body's prose, wherever it's used, and
 * whether that use is the footnote's definition, `[^label]:` opening a line.
 */
export function readFootnotes(
  file: CheckedFile
): { isDefinition: boolean; label: string; line: number }[] {
  return readProseLines(file).flatMap(({ content, line }) =>
    [...content.matchAll(FOOTNOTE)].map((match) => ({
      isDefinition:
        /^ {0,3}$/u.test(content.slice(0, match.index)) &&
        content.charAt(match.index + match[0].length) === ":",
      label: match.slice(1).join(""),
      line,
    }))
  );
}

/** Read a file's parsed frontmatter, or `undefined` when it has none. */
export function readParsed(file: CheckedFile): ParsedFile | undefined {
  if (file.frontmatter.kind !== "parsed") {
    return undefined;
  }

  const { doc, map } = file.frontmatter;
  const read = (from: unknown, key: string): unknown => {
    const resolved = resolveAlias({ doc, node: from });

    return isMap(resolved)
      ? resolveAlias({ doc, node: resolved.get(key, true) })
      : undefined;
  };

  return {
    file,
    get: (key) => read(map, key),
    read,
    resolve: (node) => resolveAlias({ doc, node }),
  };
}

/**
 * Read a body's lines with fenced code and inline code blanked out, each with
 * its 1-based line in the file.
 */
export function readProseLines(
  file: CheckedFile
): { content: string; line: number }[] {
  const bodyStart = findBodyStart(file.text);
  const lineOffset = file.text.slice(0, bodyStart).split("\n").length - 1;

  return splitLines(maskCode(file.text.slice(bodyStart))).map(
    ({ content }, index) => ({ content, line: lineOffset + index + 1 })
  );
}

/**
 * Read the `id` of each `sources` entry that has one as text, a bare mapping
 * as one entry (§11.2).
 */
export function readSourceIds(
  parsed: ParsedFile
): { id: string; node: unknown }[] {
  const sources = parsed.get("sources");
  const entries: unknown[] = isSeq(sources) ? sources.items : [sources];

  return entries.flatMap((entry) => {
    const node = parsed.read(parsed.resolve(entry), "id");
    const id = readTimestamp(node);

    return id === undefined ? [] : [{ id, node }];
  });
}

/** Run a check over a concept's frontmatter, or find nothing in any other file. */
export function withConcept(
  file: CheckedFile,
  check: (parsed: ParsedFile) => RuleHit[]
): RuleHit[] {
  const parsed = readParsed(file);

  return file.kind === "markdown" && parsed !== undefined && isConcept(parsed)
    ? check(parsed)
    : [];
}

/**
 * Run a check over each file of a bundle, told whether the bundle reads a
 * bare path from its root too, and name each finding's file.
 */
export function withEachFile(params: {
  bundle: CheckedBundle;
  check: (file: CheckedFile, canFallBack: boolean) => RuleHit[];
}): BundleHit[] {
  const { bundle, check } = params;
  const canFallBack = canFallBackToRoot(bundle);

  return bundle.files.flatMap((file) =>
    check(file, canFallBack).map((hit) => ({ ...hit, path: file.filePath }))
  );
}

/** Warn about an actor in neither of §7's forms. */
function checkActor(params: {
  field: string;
  file: CheckedFile;
  node: unknown;
}): RuleHit[] {
  const { field, file, node } = params;
  const value = readTimestamp(node);

  return value !== undefined && ACTOR.test(value)
    ? []
    : [
        {
          line: readNodeLine({ file, node }),
          message: `${field} is an actor: <producer>/<version> or <scheme>:<id>, such as human:<id> (§7); found ${describeValue(node)}`,
        },
      ];
}

/** Warn about a bundle with no root `index.md`, which declares its version. */
function checkBundleVersion(bundle: CheckedBundle): BundleHit[] {
  const indexPath = path.posix.join(bundle.bundleDir, "index.md");

  return bundle.files.some((file) => file.filePath === indexPath)
    ? []
    : [
        {
          line: null,
          message: 'add a bundle-root index.md with okf_version: "0.3" (§8.1)',
          path: indexPath,
        },
      ];
}

/** Warn about each footnote label no `sources` entry has as its `id` (§5.1). */
function checkFootnotes(parsed: ParsedFile): RuleHit[] {
  const ids = new Set(readSourceIds(parsed).map(({ id }) => id));
  const reported = new Set<string>();

  // Each label once, at its first use, a definition counted as one, as
  // upstream reports it.
  return readFootnotes(parsed.file).flatMap(({ label, line }) => {
    if (ids.has(label) || reported.has(label)) {
      return [];
    }

    reported.add(label);

    return [
      {
        line,
        message: `footnote [^${label}] has no sources entry with that id (§5.1)`,
      },
    ];
  });
}

/**
 * Warn about each link in a body to a path the bundle doesn't hold.
 *
 * - A link resolves from its file's folder, or from the bundle root with a
 *   leading `/` (§6); in a bundle declared v0.2 or earlier, or undeclared, a
 *   bare link that resolves only from the bundle root passes too, as v0.2
 *   bundles wrote them.
 */
function checkLinks(params: {
  canFallBack: boolean;
  file: CheckedFile;
}): RuleHit[] {
  const { canFallBack, file } = params;

  return readProseLines(file).flatMap(({ content, line }) =>
    [...content.matchAll(LINK)].flatMap((match) => {
      const target = match.slice(1).join("");

      return resolvePath({ canFallBack, file, target }) === "missing"
        ? [
            {
              line,
              message: `link target "${target}" is not in the bundle (§6.1)`,
            },
          ]
        : [];
    })
  );
}

/** Warn about a text key written so YAML's core schema reads a non-string. */
function checkQuoted(params: {
  file: CheckedFile;
  key: string;
  node: unknown;
}): RuleHit[] {
  const { file, key, node } = params;

  return isScalar(node) &&
    node.type === "PLAIN" &&
    typeof node.value === "string" &&
    CORE_NON_STRING.test(node.value)
    ? [
        {
          line: readNodeLine({ file, node }),
          message: `quote ${key}: YAML's core schema reads ${node.value} as a number or a boolean, not a string (§4)`,
        },
      ]
    : [];
}

/** Warn about a `stale_after` that can't be read, so is never fresh. */
function checkStaleAfter(params: {
  file: CheckedFile;
  node: unknown;
}): RuleHit[] {
  const { file, node } = params;

  return isBlank(node) || isValidTimestamp(readTimestamp(node) ?? "")
    ? []
    : [
        {
          line: readNodeLine({ file, node }),
          message: `stale_after does not parse, so consumers never treat the concept as fresh (§5.5); found ${describeValue(node)}`,
        },
      ];
}

/**
 * Warn about a concept's `superseded_by` that resolves to no file in the
 * bundle, or, apart, one that resolves only through v0.2's fallback.
 */
function checkSupersededBy(params: {
  canFallBack: boolean;
  file: CheckedFile;
  kind: "fallback" | "missing";
}): RuleHit[] {
  const { canFallBack, file, kind } = params;

  return withConcept(file, (parsed) => {
    const node = parsed.get("superseded_by");
    const value = readTimestamp(node);

    if (
      value === undefined ||
      resolvePath({ canFallBack, file, target: value }) !== kind
    ) {
      return [];
    }

    return [
      {
        line: readNodeLine({ file, node }),
        message:
          kind === "missing"
            ? `superseded_by "${value}" does not resolve to a file in the bundle (§6.2)`
            : `superseded_by "${value}" resolves only from the bundle root, through the v0.2 fallback; write it as /${value} (§6.2)`,
      },
    ];
  });
}

/** Warn about a timestamp in neither of §5's forms. */
function checkTimestamp(params: {
  field: string;
  file: CheckedFile;
  node: unknown;
}): RuleHit[] {
  const { field, file, node } = params;

  return isValidTimestamp(readTimestamp(node) ?? "")
    ? []
    : [
        {
          line: readNodeLine({ file, node }),
          message: `${field} is an RFC 3339 date-time with an offset, such as 2026-06-30T14:00:00Z, or a date such as 2026-06-30 (§5); found ${describeValue(node)}`,
        },
      ];
}

/** Quote a value for a message, or name it when it isn't a single value. */
function describeValue(node: unknown): string {
  const value = readTimestamp(node);

  return value === undefined ? "a value that isn't text" : `"${value}"`;
}

/**
 * Whether a value counts as absent (§11.2): missing, null, an empty string,
 * or an empty list.
 */
function isBlank(node: unknown): boolean {
  return (
    node === undefined ||
    (isScalar(node) && (isNullScalar(node) || node.value === "")) ||
    (isSeq(node) && node.items.length === 0)
  );
}

/** Whether a parsed file is a concept: its `type` is non-empty text (§3.2). */
function isConcept(parsed: ParsedFile): boolean {
  return (readTimestamp(parsed.get("type")) ?? "").trim() !== "";
}

/** Whether a timestamp is a real date alone, with no time. */
function isDateOnly(value: string): boolean {
  return DATE.test(value) && isValidTimestamp(value);
}

/** Read `generated.at` when `generated` has a `by` and a non-blank `at`. */
function readGeneratedAt(
  parsed: ParsedFile
): { field: string; node: unknown }[] {
  const at = parsed.read(parsed.get("generated"), "at");

  return readGeneratedBy(parsed).length === 0 || isBlank(at)
    ? []
    : [{ field: "generated.at", node: at }];
}

/** Read `generated.by` when `generated` is a mapping with one. */
function readGeneratedBy(parsed: ParsedFile): unknown[] {
  const by = parsed.read(parsed.get("generated"), "by");

  return isBlank(by) ? [] : [by];
}

/**
 * Read each `## ` heading of a `log.md` outside fenced code, with its date
 * when it's one.
 */
function readLogHeadings(file: CheckedFile): {
  date: string | undefined;
  heading: string;
  line: number;
}[] {
  if (file.kind !== "log") {
    return [];
  }

  return splitLines(maskFences(file.text)).flatMap(({ content }, index) => {
    if (!content.startsWith("## ")) {
      return [];
    }

    const heading = content.slice(3).trim();

    return [
      {
        date: isDateOnly(heading) ? heading : undefined,
        heading,
        line: index + 1,
      },
    ];
  });
}

/** Whether a file's frontmatter is OKF's to read: a concept's or the root index's. */
function readsFrontmatter(file: CheckedFile): boolean {
  return (
    file.kind === "markdown" || (file.kind === "index" && file.isAtBundleRoot)
  );
}

/**
 * Resolve a link target or path field by §6's rules.
 *
 * - A URL, an in-page anchor, and a path that leaves the bundle are
 *   `external`, so they resolve as far as the bundle is concerned (§6).
 *
 * - With `canFallBack`, a bare path that resolves only from the bundle root
 *   is `fallback`, v0.2's reading (§6.2).
 */
function resolvePath(params: {
  canFallBack: boolean;
  file: CheckedFile;
  target: string;
}): "external" | "fallback" | "found" | "missing" {
  const { canFallBack, file, target } = params;

  if (hasScheme(target) || target.startsWith("//") || target.startsWith("#")) {
    return "external";
  }

  const clean = decodePath(target.replace(/[#?].*$/u, ""));
  const base = clean.startsWith("/")
    ? file.bundleDir
    : path.posix.dirname(file.filePath);
  const resolved = path.posix.join(base, clean);
  const fromBundle = path.posix.relative(file.bundleDir, resolved);

  if (fromBundle === ".." || fromBundle.startsWith("../")) {
    return "external";
  }

  if (file.doesExist(resolved)) {
    return "found";
  }

  const fromRoot = path.posix.join(file.bundleDir, clean);
  const isFallback =
    canFallBack &&
    !clean.startsWith("/") &&
    !path.posix.relative(file.bundleDir, fromRoot).startsWith("..") &&
    file.doesExist(fromRoot);

  return isFallback ? "fallback" : "missing";
}

/** Run a check over the root `index.md`'s parsed frontmatter, or find nothing. */
function withRootIndex(
  file: CheckedFile,
  check: (parsed: ParsedFile) => RuleHit[]
): RuleHit[] {
  const parsed = readParsed(file);

  return file.kind === "index" && file.isAtBundleRoot && parsed !== undefined
    ? check(parsed)
    : [];
}
