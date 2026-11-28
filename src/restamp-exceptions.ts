/*
 * The edits that keep a record's `generated` and `status`, written once for
 * the record rules, the tag rules, and the okf-record skill.
 *
 * - Each shipped sentence that lists them reads the phrase from here, so
 *   adding an exception changes every copy at once, as `TAG_RULES` is shared;
 *   the README and the records stay prose.
 *
 * - The sentences differ in grammar, some naming the record's own `tags`,
 *   others bare `tags`, so each entry holds every form, and a new one can't
 *   miss a form.
 *
 * - The builders join one, two, or more entries as English lists, and the
 *   tests pin the list's shape that the tag rules' sentence assumes.
 */

/** An edit that keeps a record's `generated` and `status`. */
type RestampException = {
  /**
   * The edit, naming the part of the record bare.
   *
   * @example "the order of `sources`"
   */
  bare: string;

  /**
   * The edit, naming the part of the record as the record's own.
   *
   * @example "the order of its `sources`"
   */
  owned: string;

  /**
   * What the edit reorders, after "a reorder", or `undefined` for one that
   * isn't a reorder.
   *
   * @example "of the top-level keys"
   */
  reorderOf: string | undefined;
};

/**
 * Every edit that keeps `generated` and `status`, in the order named.
 *
 * - The tag rules name `tags` on its own and every other entry as a reorder
 *   beside it, so a test fails until their sentence is reworded for a new
 *   entry that isn't a reorder.
 */
export const RESTAMP_EXCEPTION_LIST: readonly RestampException[] = [
  { bare: "`tags`", owned: "its `tags`", reorderOf: undefined },
  {
    bare: "the order of `sources`",
    owned: "the order of its `sources`",
    reorderOf: "of `sources`",
  },
  {
    bare: "the order of top-level keys",
    owned: "the order of its top-level keys",
    reorderOf: "of the top-level keys",
  },
];

/** The edits that keep `generated`, after "only", naming parts bare. */
export const RESTAMP_EXCEPTIONS: string = listExceptions(
  RESTAMP_EXCEPTION_LIST.map(({ bare }) => bare)
);

/** The edits that keep `generated`, after "only", as the record's own. */
export const OWNED_RESTAMP_EXCEPTIONS: string = listExceptions(
  RESTAMP_EXCEPTION_LIST.map(({ owned }) => owned)
);

/** The reorders that keep `generated`, as "a reorder of …". */
export const RESTAMP_REORDERS: string = listReorders(
  RESTAMP_EXCEPTION_LIST.flatMap(({ reorderOf }) =>
    reorderOf === undefined ? [] : [reorderOf]
  )
);

/**
 * List the edits as one phrase that also allows any mix of them.
 *
 * @example listExceptions(["a", "b"]) // "a or b, or both"
 */
export function listExceptions(edits: readonly string[]): string {
  if (edits.length < 2) {
    return joinWithOr(edits);
  }
  if (edits.length === 2) {
    return [joinWithOr(edits), "both"].join(", or ");
  }
  return joinWithOr([...edits, "several of these"]);
}

/**
 * List what the reorders reorder, each after "of", as one reorder phrase.
 *
 * @example listReorders(["of a", "of b"]) // "a reorder of a or of b"
 */
export function listReorders(objects: readonly string[]): string {
  return ["a reorder", joinWithOr(objects)].join(" ");
}

/**
 * Join phrases as an English list with "or", serial comma included.
 *
 * @example joinWithOr(["a", "b", "c"]) // "a, b, or c"
 */
function joinWithOr(phrases: readonly string[]): string {
  if (phrases.length <= 2) {
    return phrases.join(" or ");
  }
  return [phrases.slice(0, -1).join(", "), ...phrases.slice(-1)].join(", or ");
}
