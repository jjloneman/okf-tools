/*
 * Guards on what a frontmatter means, rather than how it is written.
 *
 * - `findAmbiguity` refuses a frontmatter before any edit when its meaning
 *   isn't clear: an unresolved alias, or two keys that mean the same.
 *
 * - `checkMeaning` refuses an edited result that isn't valid YAML, or
 *   doesn't parse to the original plus the intended changes.
 */
import type { Document } from "yaml";

import { isDeepStrictEqual } from "node:util";
import { isNode, isScalar, isSeq, visit, YAMLMap, YAMLSeq } from "yaml";

import type {
  FindOwnEntryParams,
  Frontmatter,
  ResolveAliasParams,
} from "./shared.ts";
import type { VerifyRecordParams } from "./types.ts";

import {
  describeYamlErrors,
  ENTRY_KEYS,
  findOwnEntry,
  FRONTMATTER_KEYS,
  isNullScalar,
  resolveAlias,
} from "./shared.ts";
import { RECORD_STATUSES } from "./types.ts";

/**
 * What a null reads as in the meaning check, so it differs from an empty
 * string, which the failsafe schema would otherwise make it.
 */
const NULL_MEANING = Symbol("null");

/** Why a record whose aliases resolve past the parser's limit is refused. */
const TOO_MANY_ALIASES =
  "the frontmatter has too many aliases to check the edit";

/** What `checkMeaning` needs: the original and edited parses, who, and when. */
export type CheckMeaningParams = {
  /**
   * The frontmatter after the edits, parsed.
   *
   * @example `parseFrontmatter("status: stable")`
   */
  editedDoc: Frontmatter;
} & PlanEntryParams;

/** What `formatEntry` needs: who signs, and when. */
export type FormatEntryParams = Pick<VerifyRecordParams, "at" | "verifiedBy">;

/** The parsed frontmatter, who signs, and when. */
type PlanEntryParams = Pick<FindOwnEntryParams, "doc"> &
  Pick<VerifyRecordParams, "at" | "verifiedBy">;

/** What `readKeyMeaning` needs: the key, and the document it's in. */
type ReadKeyMeaningParams = {
  /**
   * The key, which may be an alias or missing.
   *
   * @example `pair.key`
   */
  key: unknown;
} & Pick<ResolveAliasParams, "doc">;

/**
 * Check that the edited frontmatter means exactly what the edits intend: the
 * original, with a draft made stable and the signer's entry added or renewed.
 *
 * - Exported for its own tests: no edit `verifyRecord` plans today reaches the
 *   mismatch, so it's checked directly.
 *
 * @returns why the edit is refused, or `undefined` when it means what's meant.
 */
export function checkMeaning(params: CheckMeaningParams): string | undefined {
  const { at, doc, editedDoc, verifiedBy } = params;

  // A last check that no edit, whatever the layout, left the YAML broken.
  if (describeYamlErrors(editedDoc) !== undefined) {
    return "the edit would leave the frontmatter invalid YAML";
  }

  const intended = doc.clone();
  const status = intended.get(FRONTMATTER_KEYS.status, true);

  if (isScalar(status) && status.value === RECORD_STATUSES.draft) {
    status.value = RECORD_STATUSES.stable;
  }

  addIntendedEntry({ at, doc: intended, verifiedBy });

  // Resolving aliases throws past the parser's limit, which guards against
  // alias bombs, so such a record is refused rather than ending the run.
  try {
    return isDeepStrictEqual(
      readMeaning(editedDoc.clone()),
      readMeaning(intended)
    )
      ? undefined
      : "the edit would change more than the status and the sign-off";
  } catch {
    return TOO_MANY_ALIASES;
  }
}

/** Build the signer's new entry as a flow mapping of `by`, then `at`. */
export function createEntry(params: FormatEntryParams): YAMLMap {
  const { at, verifiedBy } = params;
  const entry = new YAMLMap();

  // Set one at a time, since `by` before `at` is the order records read in.
  entry.set(ENTRY_KEYS.by, verifiedBy);
  entry.set(ENTRY_KEYS.at, at);
  entry.flow = true;

  return entry;
}

/**
 * Say why a frontmatter's meaning is ambiguous before any edit: an alias
 * whose anchor isn't set before it, or a mapping with two keys that mean the
 * same, such as an alias key repeating another, or `~` beside `null`.
 */
export function findAmbiguity(doc: Document): string | undefined {
  const unresolved = findUnresolvedAlias(doc);

  if (unresolved !== undefined) {
    return `the alias \`*${unresolved}\` names no anchor set before it`;
  }

  try {
    return hasEqualKeys(doc)
      ? "the frontmatter has two keys that mean the same"
      : undefined;
  } catch {
    return TOO_MANY_ALIASES;
  }
}

/**
 * Add or renew the signer's entry in a parsed copy of the frontmatter, as the
 * meaning check expects to find it.
 */
function addIntendedEntry(params: PlanEntryParams): void {
  const { at, doc, verifiedBy } = params;
  const ownEntry = findOwnEntry({ doc, verifiedBy });

  if (ownEntry !== undefined) {
    const atNode = ownEntry.get(ENTRY_KEYS.at, true);

    if (isScalar(atNode)) {
      atNode.value = at;
    } else {
      ownEntry.set(ENTRY_KEYS.at, at);
    }

    return;
  }

  const entry = createEntry({ at, verifiedBy });
  const verified = doc.get(FRONTMATTER_KEYS.verified, true);

  if (isSeq(verified)) {
    verified.add(entry);
  } else if (
    verified === undefined ||
    (isScalar(verified) && isNullScalar(verified))
  ) {
    doc.set(FRONTMATTER_KEYS.verified, entry);
  } else {
    const list = new YAMLSeq();

    list.items = [verified, entry];
    doc.set(FRONTMATTER_KEYS.verified, list);
  }
}

/** Find an alias whose anchor isn't set before it, which can't be read. */
function findUnresolvedAlias(doc: Document): string | undefined {
  let source: string | undefined;

  visit(doc, {
    Alias(_key, node) {
      if (node.resolve(doc) === undefined) {
        source = node.source;

        return visit.BREAK;
      }

      return undefined;
    },
  });

  return source;
}

/** Whether any mapping in a document has two keys that mean the same. */
function hasEqualKeys(doc: Document): boolean {
  let isFound = false;

  visit(doc, {
    Map(_key, map) {
      const keys = map.items.map(({ key }) => readKeyMeaning({ doc, key }));

      isFound = keys.some((key, index) =>
        keys.slice(index + 1).some((other) => isDeepStrictEqual(key, other))
      );

      return isFound ? visit.BREAK : undefined;
    },
  });

  return isFound;
}

/**
 * Read what a key means, with its alias resolved and a null or missing key
 * read as null, so two spellings of one key compare equal.
 */
function readKeyMeaning(params: ReadKeyMeaningParams): unknown {
  const resolved = resolveAlias({ doc: params.doc, node: params.key });

  if (!isNode(resolved) || (isScalar(resolved) && isNullScalar(resolved))) {
    return NULL_MEANING;
  }

  return resolved.toJS(params.doc, { mapAsMap: true });
}

/**
 * Read what a throwaway copy of a document means, for the meaning check:
 * nulls kept apart from empty text, and collection keys kept as keys.
 */
function readMeaning(doc: Document): unknown {
  // Marks the document in place, so pass a copy that can be thrown away.
  visit(doc, {
    Scalar(_key, node) {
      if (isNullScalar(node)) {
        node.value = NULL_MEANING;
      }
    },
  });

  return doc.toJS({ mapAsMap: true });
}
