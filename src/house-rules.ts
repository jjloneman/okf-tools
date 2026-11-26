/*
 * The house rules `okf check` runs when a repo turns them on in
 * `okf.rules`: conventions OKF leaves open that a repo would otherwise
 * enforce by hand, such as tags in one vocabulary, or an index that matches
 * its records.
 *
 * - Every one is off until named, at `warn` or `error`, so a bundle the
 *   spec calls conformant never fails on a convention it didn't choose.
 *
 * - Their codes start with `H`, a range upstream's `validate.py` doesn't use.
 *   A convention upstream checks, such as a footnote with no `sources` id,
 *   is a spec rule instead, so the two tools never report it twice.
 *
 * - The index rules judge an index against what `okf index` would write, so
 *   running it clears every one.
 */
import path from "node:path";
import { isSeq } from "yaml";

import type {
  BundleHit,
  CheckedBundle,
  CheckedFile,
  CheckRule,
  CheckSeverity,
  RuleHit,
} from "./check-engine.ts";
import type { IndexDrift, IndexRecord } from "./index-sync.ts";
import type { ParsedFile } from "./spec-rules.ts";

import { readNodeLine } from "./check-engine.ts";
import { orderKeyNames } from "./frontmatter/format.ts";
import { readRecordSummary } from "./frontmatter/read.ts";
import { readString, readTimestamp } from "./frontmatter/shared.ts";
import { NO_SIGNER } from "./index-command.ts";
import { findIndexDrift } from "./index-sync.ts";
import {
  isConceptFile,
  readFootnotes,
  readParsed,
  readProseLines,
  readSourceIds,
  withConcept,
} from "./spec-rules.ts";

/** How loud a house rule is once turned on. */
export type HouseLevel = (typeof HOUSE_LEVELS)[number];

/** The house rules a repo turned on, from `okf.rules`. */
export type HouseRules = {
  /**
   * A record no line in its nearest `index.md` links to.
   *
   * @example "warn"
   */
  "index-entry-missing"?: HouseLevel;

  /**
   * An index line out of the order `okf index` sorts by.
   *
   * @example "warn"
   */
  "index-entry-order"?: HouseLevel;

  /**
   * An index line whose title or description differs from its record's.
   *
   * @example "error"
   */
  "index-entry-stale"?: HouseLevel;

  /**
   * Top-level keys out of the order `order` lists, the keys it doesn't list
   * after the ones it does.
   *
   * @example `{ level: "warn", order: ["type", "title", "description"] }`
   */
  "key-order"?: { level: HouseLevel; order: readonly string[] };

  /**
   * A `sources` entry no footnote in the body cites by its `id`.
   *
   * @example "warn"
   */
  "source-uncited"?: HouseLevel;

  /**
   * How many tags a record has, at least `min` and at most `max`.
   *
   * @example `{ level: "warn", max: 10, min: 5 }`
   */
  "tags-count"?: { level: HouseLevel; max: number; min: number };

  /**
   * A tag that isn't kebab-case.
   *
   * @example "error"
   */
  "tags-kebab-case"?: HouseLevel;

  /**
   * How `tags` is written: a block list, a flow list, or either.
   *
   * @example `{ layout: "block", level: "warn" }`
   */
  "tags-layout"?: { layout: TagsLayout; level: HouseLevel };

  /**
   * A record with no tags.
   *
   * @example "warn"
   */
  "tags-required"?: HouseLevel;

  /**
   * Tags out of alphabetical order.
   *
   * @example "error"
   */
  "tags-sorted"?: HouseLevel;

  /**
   * A tag outside the repo's vocabulary.
   *
   * @example `{ level: "error", tags: ["checks", "cli"] }`
   */
  "tags-vocabulary"?: { level: HouseLevel; tags: readonly string[] };

  /**
   * A `[[wikilink]]` in a body, which OKF doesn't read as a link (§6.1).
   *
   * @example "warn"
   */
  wikilink?: HouseLevel;
};

/** `okf.rules`, or why it can't be read. */
export type HouseRulesResult =
  | {
      /**
       * Whether it could be read; `false` here.
       *
       * @example false
       */
      isOk: false;

      /**
       * Why not, naming the rule.
       *
       * @example "`okf.rules` in package.json names no rule \"tag-case\"."
       */
      reason: string;
    }
  | {
      /**
       * Whether it could be read; `true` here.
       *
       * @example true
       */
      isOk: true;

      /**
       * The rules turned on.
       *
       * @example `{ "tags-sorted": "error" }`
       */
      rules: HouseRules;
    };

/** How `tags` must be written under `tags-layout`. */
export type TagsLayout = (typeof TAGS_LAYOUTS)[number];

/** A house rule's name. */
type HouseRuleName = keyof HouseRules;

/** A tag as written: its node, for the line, and its text. */
type TagItem = {
  /**
   * The item's node.
   *
   * @example `tags.items[0]`
   */
  node: unknown;

  /**
   * Its text, or `undefined` when it isn't a single value.
   *
   * @example "checks"
   */
  value: string | undefined;
};

/** The levels a house rule takes once turned on. */
export const HOUSE_LEVELS = ["error", "warn"] as const;

/** The layouts `tags-layout` takes. */
export const TAGS_LAYOUTS = ["any", "block", "flow"] as const;

/** `tags-count`'s bounds when it's turned on without them. */
const DEFAULT_TAG_COUNT = { max: 10, min: 5 } as const;

/** The severity each level reports at. */
const LEVEL_SEVERITIES: Readonly<Record<HouseLevel, CheckSeverity>> = {
  error: "error",
  warn: "warning",
};

/** A tag in kebab-case: lower-case words of letters and digits. */
const KEBAB_CASE = /^[\da-z]+(?:-[\da-z]+)*$/u;

/** The options each rule takes; a rule not listed takes none. */
const RULE_OPTIONS: Readonly<
  Partial<Record<HouseRuleName, readonly string[]>>
> = {
  "key-order": ["order"],
  "tags-count": ["max", "min"],
  "tags-layout": ["layout"],
  "tags-vocabulary": ["tags"],
};

/** A wikilink, which OKF doesn't read as a link (§6.1). */
const WIKILINK = /\[\[[^\n\]]+\]\]/gu;

/** Every house rule, by name: its code, and what it checks once on. */
const HOUSE_RULES: {
  readonly [Name in HouseRuleName]: {
    build: (
      setting: NonNullable<HouseRules[Name]>
    ) => Pick<CheckRule, "checkBundle" | "checkFile">;
    code: string;
  };
} = {
  "index-entry-missing": {
    build: () => ({
      checkBundle: (bundle) => checkIndexes({ bundle, kind: "missing" }),
    }),
    code: "H007",
  },
  "index-entry-order": {
    build: () => ({
      checkBundle: (bundle) => checkIndexes({ bundle, kind: "order" }),
    }),
    code: "H009",
  },
  "index-entry-stale": {
    build: () => ({
      checkBundle: (bundle) => checkIndexes({ bundle, kind: "stale" }),
    }),
    code: "H008",
  },
  "key-order": {
    build: ({ order }) => ({
      checkFile: (file) =>
        withConcept(file, (parsed) => checkKeyOrder({ order, parsed })),
    }),
    code: "H012",
  },
  "source-uncited": {
    build: () => ({
      checkFile: (file) =>
        withConcept(file, (parsed) => {
          const cited = new Set(
            readFootnotes(file)
              .filter(({ isDefinition }) => !isDefinition)
              .map(({ label }) => label)
          );

          return readSourceIds(parsed).flatMap(({ id, node }) =>
            cited.has(id)
              ? []
              : [
                  {
                    line: readNodeLine({ file, node }),
                    message: `no footnote cites the source "${id}"; add [^${id}] after the claim it supports`,
                  },
                ]
          );
        }),
    }),
    code: "H010",
  },
  "tags-count": {
    build: ({ max, min }) => {
      return {
        checkFile: (file) =>
          withConcept(file, (parsed) => {
            const count = readTags(parsed).filter(
              ({ value }) => value !== undefined
            ).length;

            return count >= min && count <= max
              ? []
              : [
                  {
                    line: readNodeLine({ file, node: parsed.get("tags") }),
                    message: `the record has ${String(count)} tags; give it ${String(min)} to ${String(max)}`,
                  },
                ];
          }),
      };
    },
    code: "H006",
  },
  "tags-kebab-case": {
    build: () => ({
      checkFile: (file) =>
        withConcept(file, (parsed) =>
          readTags(parsed).flatMap(({ node, value }) =>
            value === undefined || KEBAB_CASE.test(value)
              ? []
              : [
                  {
                    line: readNodeLine({ file, node }),
                    message: `tag "${value}" isn't kebab-case, such as "open-knowledge"`,
                  },
                ]
          )
        ),
    }),
    code: "H003",
  },
  "tags-layout": {
    build: ({ layout }) => {
      return {
        checkFile: (file) =>
          withConcept(file, (parsed) => {
            const tags = parsed.get("tags");

            return isSeq(tags) &&
              tags.items.length > 0 &&
              layout !== "any" &&
              (layout === "block") === (tags.flow === true)
              ? [
                  {
                    line: readNodeLine({ file, node: tags }),
                    message:
                      layout === "block"
                        ? "write tags as a block list, one `- tag` line each"
                        : "write tags as a flow list, such as `[a, b]`",
                  },
                ]
              : [];
          }),
      };
    },
    code: "H005",
  },
  "tags-required": {
    build: () => ({
      checkFile: (file) =>
        withConcept(file, (parsed) =>
          readTags(parsed).length === 0
            ? [
                {
                  line: readNodeLine({ file, node: parsed.get("tags") }),
                  message: "the record has no tags",
                },
              ]
            : []
        ),
    }),
    code: "H001",
  },
  "tags-sorted": {
    build: () => ({
      checkFile: (file) =>
        withConcept(file, (parsed) => {
          let previous: string | undefined;

          for (const { node, value } of readTags(parsed)) {
            if (value === undefined) {
              continue;
            }

            if (previous !== undefined && previous > value) {
              return [
                {
                  line: readNodeLine({ file, node }),
                  message: `tags aren't sorted: "${value}" comes after "${previous}"`,
                },
              ];
            }

            previous = value;
          }

          return [];
        }),
    }),
    code: "H002",
  },
  "tags-vocabulary": {
    build: (setting) => {
      const vocabulary = new Set(setting.tags);

      return {
        checkFile: (file) =>
          withConcept(file, (parsed) =>
            readTags(parsed).flatMap(({ node, value }) =>
              value === undefined || vocabulary.has(value)
                ? []
                : [
                    {
                      line: readNodeLine({ file, node }),
                      message: `tag "${value}" isn't in the vocabulary \`okf.rules\` lists`,
                    },
                  ]
            )
          ),
      };
    },
    code: "H004",
  },
  wikilink: {
    build: () => ({
      checkFile: (file) =>
        isConceptFile(file)
          ? readProseLines(file).flatMap(({ content, line }) =>
              [...content.matchAll(WIKILINK)].map(([wikilink]) => ({
                line,
                message: `${wikilink} isn't a link in OKF; write [text](path) (§6.1)`,
              }))
            )
          : [],
    }),
    code: "H011",
  },
};

/** Every house rule's name, in the order `okf.rules` errors list them. */
const HOUSE_RULE_NAMES: readonly HouseRuleName[] = Object.keys(
  HOUSE_RULES
).filter((name) => isHouseRuleName(name));

/** Build the house rules a repo turned on, at its levels, in code order. */
export function buildHouseRules(rules: HouseRules): CheckRule[] {
  return HOUSE_RULE_NAMES.flatMap((name) =>
    buildHouseRule({ name, rules })
  ).sort((left, right) => (left.code < right.code ? -1 : 1));
}

/**
 * Judge each index in a bundle as the index rules do: where it differs from
 * what `okf index` would write, or why `okf index` can't read it.
 *
 * - `okf check --fix` reads it too, so it syncs the very index a finding
 *   judged.
 */
export function judgeIndexes(bundle: CheckedBundle): {
  found: ReturnType<typeof findIndexDrift>;
  indexPath: string;
}[] {
  const indexes = new Map(
    bundle.files
      .filter((file) => file.kind === "index")
      .map((file) => [file.filePath, file])
  );
  const records = bundle.files.flatMap((file) => readIndexRecord(file));

  return [...indexes.values()].map((index) => ({
    found: findIndexDrift({
      doesExist: index.doesExist,
      indexPath: index.filePath,
      records,
      scoped: records.filter(
        (record) =>
          findNearestIndex({
            bundle,
            folder: path.posix.dirname(record.path),
            indexes,
          }) === index.filePath
      ),
      text: index.text,
    }),
    indexPath: index.filePath,
  }));
}

/**
 * Read `okf.rules`: each rule's level, `off`, `warn` or `error`, or a
 * `[level, options]` pair, as ESLint takes them.
 *
 * - A rule set to `off`, like one not named, isn't run.
 *
 * - A name, level or option it doesn't know is refused, so a typo can't
 *   silently turn a rule off.
 */
export function readHouseRules(value: unknown): HouseRulesResult {
  if (value === undefined) {
    return { isOk: true, rules: {} };
  }

  if (!isObject(value)) {
    return {
      isOk: false,
      reason: "`okf.rules` in package.json must be an object of rule levels.",
    };
  }

  const rules: Record<string, unknown> = {};

  for (const [name, setting] of Object.entries(value)) {
    const read = readHouseRule({ name, setting });

    if (!read.isOk) {
      return {
        isOk: false,
        reason: `\`okf.rules\` in package.json: ${read.reason}`,
      };
    }

    if (read.rule !== undefined) {
      rules[name] = read.rule;
    }
  }

  // Each value was read against its own name's shape.
  return { isOk: true, rules };
}

/** Build one house rule when the repo turned it on. */
function buildHouseRule<Name extends HouseRuleName>(params: {
  name: Name;
  rules: Pick<HouseRules, Name>;
}): CheckRule[] {
  const { name, rules } = params;
  const setting: HouseRules[Name] = rules[name];

  if (setting === undefined) {
    return [];
  }

  const { build, code } = HOUSE_RULES[name];
  const level = typeof setting === "string" ? setting : setting.level;

  return [{ ...build(setting), code, name, severity: LEVEL_SEVERITIES[level] }];
}

/**
 * Report where each index in a bundle differs from what `okf index` would
 * write, in one way: a missing record on the record, a line on the index.
 */
function checkIndexes(params: {
  bundle: CheckedBundle;
  kind: IndexDrift["kind"];
}): BundleHit[] {
  const { bundle, kind } = params;

  return judgeIndexes(bundle).flatMap(({ found, indexPath }) => {
    // Every index rule says so, since each alone would otherwise pass it.
    if (!found.isOk) {
      return [
        {
          line: 1,
          message: `can't judge ${indexPath} against its records, since okf index can't read it: ${found.problem}`,
          path: indexPath,
        },
      ];
    }

    return found.drift
      .filter((drift) => drift.kind === kind)
      .map((drift) => describeDrift({ drift, indexPath }));
  });
}

/**
 * Report the first top-level key out of the order `key-order` lists: the key
 * that belongs where another sits.
 */
function checkKeyOrder(params: {
  order: readonly string[];
  parsed: ParsedFile;
}): RuleHit[] {
  const { order, parsed } = params;
  const keys = parsed.keys.map((key) => ({ key, name: readString(key) }));
  const names = keys.flatMap(({ name }) => (name === undefined ? [] : [name]));

  // A key that isn't a single value can't be ordered by name.
  if (names.length < keys.length) {
    return [];
  }

  const wanted = orderKeyNames({ keyOrder: order, names });
  const index = wanted.findIndex((name, at) => name !== names[at]);
  const misplaced = wanted[index];
  const displaced = names[index];

  return misplaced === undefined || displaced === undefined
    ? []
    : [
        {
          line: readNodeLine({
            file: parsed.file,
            node: keys[names.indexOf(misplaced)]?.key,
          }),
          message: `\`${misplaced}\` belongs before \`${displaced}\`, as key-order lists the keys`,
        },
      ];
}

/**
 * Say how an index differs, on the record, since a change to the record is
 * what usually puts its line out of date, and `--changed` reports only on
 * the files a branch changed.
 */
function describeDrift(params: {
  drift: IndexDrift;
  indexPath: string;
}): BundleHit {
  const { drift, indexPath } = params;
  const where = `its line in ${indexPath}:${String(drift.line)}`;
  const messages: Record<IndexDrift["kind"], string> = {
    missing: `no line in ${indexPath} links to this record; run okf index`,
    order: `${where} sorts before the line above it, but okf index sorts by title, ignoring case; run okf index`,
    stale: `${where} differs from the record's title or description; run okf index`,
  };

  return { line: 1, message: messages[drift.kind], path: drift.recordPath };
}

/**
 * Find the index that lists a record, as `okf index` does: the nearest
 * `index.md` in its folder or one above it, up to the bundle's own.
 */
function findNearestIndex(params: {
  bundle: CheckedBundle;
  folder: string;
  indexes: ReadonlyMap<string, CheckedFile>;
}): string | undefined {
  const { bundle, folder, indexes } = params;
  const indexPath = path.posix.join(folder, "index.md");

  if (indexes.has(indexPath)) {
    return indexPath;
  }

  return folder === bundle.bundleDir
    ? undefined
    : findNearestIndex({ ...params, folder: path.posix.dirname(folder) });
}

/** Whether a value is a whole number of at least zero. */
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Whether a name is a house rule's. */
function isHouseRuleName(name: string): name is HouseRuleName {
  return Object.hasOwn(HOUSE_RULES, name);
}

/** Whether a value is a level a house rule takes, `off` included. */
function isLevel(value: unknown): value is "off" | HouseLevel {
  return value === "off" || HOUSE_LEVELS.some((level) => level === value);
}

/** Whether a parsed JSON value is an object, not an array or `null`. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read one rule's setting, or `undefined` for `off`, or why it's refused. */
function readHouseRule(params: {
  name: string;
  setting: unknown;
}):
  | { isOk: false; reason: string }
  | { isOk: true; rule: HouseRules[HouseRuleName] } {
  const { name, setting } = params;

  if (!isHouseRuleName(name)) {
    return {
      isOk: false,
      reason: `there's no house rule "${name}"; they're ${HOUSE_RULE_NAMES.join(", ")}.`,
    };
  }

  const [level, options = {}, ...extra] = Array.isArray(setting)
    ? (setting as unknown[])
    : [setting];

  if (!isLevel(level) || extra.length > 0 || !isObject(options)) {
    return {
      isOk: false,
      reason: `"${name}" must be "off", "warn", "error", or [level, { options }].`,
    };
  }

  const allowed = RULE_OPTIONS[name] ?? [];
  const unknown = Object.keys(options).find((key) => !allowed.includes(key));

  if (unknown !== undefined) {
    return {
      isOk: false,
      reason: `"${name}" takes ${allowed.length === 0 ? "no options" : `only ${allowed.join(", ")}`}, not "${unknown}".`,
    };
  }

  if (level === "off") {
    return { isOk: true, rule: undefined };
  }

  return readRuleOptions({ level, name, options });
}

/** Read a file as `okf index` lists it, or nothing for a non-record. */
function readIndexRecord(file: CheckedFile): IndexRecord[] {
  const summary =
    file.kind === "markdown" && readParsed(file) !== undefined
      ? readRecordSummary({ text: file.text, verifiedBy: NO_SIGNER })
      : undefined;

  return summary === undefined
    ? []
    : [
        {
          description: summary.description,
          path: file.filePath,

          // The index rules judge record lines only, never the tag index.
          tags: [],
          title: summary.title,
        },
      ];
}

/** Read a turned-on rule's options against its own shape. */
function readRuleOptions(params: {
  level: HouseLevel;
  name: HouseRuleName;
  options: Record<string, unknown>;
}):
  | { isOk: false; reason: string }
  | { isOk: true; rule: HouseRules[HouseRuleName] } {
  const { level, name, options } = params;

  if (name === "key-order") {
    const { order } = options;

    return Array.isArray(order) &&
      order.length > 0 &&
      order.every((key) => typeof key === "string") &&
      new Set(order).size === order.length
      ? { isOk: true, rule: { level, order } }
      : {
          isOk: false,
          reason: `"key-order" needs its keys, each once, as [level, { "order": [...] }].`,
        };
  }

  if (name === "tags-count") {
    const { max = DEFAULT_TAG_COUNT.max, min = DEFAULT_TAG_COUNT.min } =
      options;

    return isCount(min) && isCount(max) && min <= max
      ? { isOk: true, rule: { level, max, min } }
      : {
          isOk: false,
          reason: `"tags-count" takes a whole-number min and max, min no more than max.`,
        };
  }

  if (name === "tags-layout") {
    const { layout = "any" } = options;

    return TAGS_LAYOUTS.some((known) => known === layout)
      ? { isOk: true, rule: { layout: layout as TagsLayout, level } }
      : {
          isOk: false,
          reason: `"tags-layout" takes a layout of ${TAGS_LAYOUTS.join(", ")}.`,
        };
  }

  if (name === "tags-vocabulary") {
    const { tags } = options;

    return Array.isArray(tags) &&
      tags.length > 0 &&
      tags.every((tag) => typeof tag === "string")
      ? { isOk: true, rule: { level, tags } }
      : {
          isOk: false,
          reason: `"tags-vocabulary" needs its tags, as [level, { "tags": [...] }].`,
        };
  }

  return { isOk: true, rule: level };
}

/**
 * Read a record's tags as written, a single value as one tag (§11.2), or
 * none when `tags` is blank.
 */
function readTags(parsed: ParsedFile): TagItem[] {
  const tags = parsed.get("tags");

  if (isSeq(tags)) {
    return tags.items.map((item) => {
      const node = parsed.resolve(item);

      return { node, value: readTimestamp(node) };
    });
  }

  const value = readTimestamp(tags);

  return value === undefined ? [] : [{ node: tags, value }];
}
