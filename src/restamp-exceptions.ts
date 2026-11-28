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
   * - The tag rules name only the reorders beside `tags`, so a new exception
   *   that is neither rewords their sentence too.
   *
   * @example "of the top-level keys"
   */
  reorderOf: string | undefined;
};

/** Every edit that keeps `generated` and `status`, in the order named. */
const EXCEPTIONS: readonly RestampException[] = [
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
  EXCEPTIONS.map(({ bare }) => bare)
);

/** The edits that keep `generated`, after "only", as the record's own. */
export const OWNED_RESTAMP_EXCEPTIONS: string = listExceptions(
  EXCEPTIONS.map(({ owned }) => owned)
);

/** The reorders that keep `generated`, as "a reorder of …". */
export const RESTAMP_REORDERS: string = [
  "a reorder",
  EXCEPTIONS.flatMap(({ reorderOf }) =>
    reorderOf === undefined ? [] : [reorderOf]
  ).join(" or "),
].join(" ");

/** List the edits as one phrase that also allows any mix of them. */
function listExceptions(edits: readonly string[]): string {
  return `${edits.join(", ")}, or several of these`;
}
