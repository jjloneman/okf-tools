/*
 * How an agent chooses and writes a record's tags, written once for the
 * agent block, `okf guide`, and the okf-record skill.
 *
 * - A tag change alone keeps `generated`, since tags help a reader find a
 *   record and don't change what it says (see
 *   `docs/decisions/new-and-touch.md`).
 */

/** How to choose and write a record's tags, as Markdown bullets. */
export const TAG_RULES = `- **Give each record 5 to 10 specific tags**, so a search finds it by any term a reader would type:
  - its topic, and the area of the repo it covers;
  - the tools and products it names;
  - the task or problem it's about;
  - the words someone searching for it would type, common synonyms included.
- **Reuse the bundle's tags first.** List them with \`okf tags\`, which reads every layout, rather than \`grep\`, and add a new tag only when none fits.
  - Prefer specific tags to broad ones: a tag most of the bundle's records carry helps no search.
  - Never add a near-duplicate of a tag the bundle has, such as its plural or another spelling.
- **Write \`tags\` as a block list**, one \`- tag\` per line, sorted, in kebab-case, even where upstream's examples show a one-line \`[a, b]\` list, which okf-tools reads as the same tags.
- **A change to \`tags\` alone keeps \`generated\` and \`status\`**, so a signed-off record stays signed off: don't run \`okf touch\` for it.
  - Any other change in the same edit, to the body or another field, \`title\` and \`description\` included, is re-stamped as usual, apart from a reorder of \`sources\` or of the top-level keys.
  - Run \`okf index\` after it, which syncs each tag index.
- **Where \`okf.rules\` in \`package.json\` turns on a tag rule, it wins over these:**
  - \`tags-count\`'s \`min\` and \`max\` replace 5 to 10;
  - \`tags-layout\` with \`flow\` means a one-line \`[a, b]\` list;
  - \`tags-vocabulary\` allows only the tags it lists, so ask the person before adding one to it.`;
