import type { Rule } from "eslint";

/*
 * Matches one TSDoc line whose `@param` names a key of an object param.
 *
 * - The dot is the whole rule. A non-dotted `@param value - …` documents a
 *   positional param and is correct, so matching `@param` broadly would flag
 *   every one of those instead.
 *
 * - `linePrefix` is the line's `* ` prefix, which the report's column
 *   arithmetic needs; `objectName` is the object's own name (`options`,
 *   `params`), so the message can quote the site as written.
 *
 * - The asterisk is optional because a doc block can be written without one
 *   per line, and Prettier reformats no comment's interior — so requiring it
 *   would leave that style permanently unscanned.
 *
 * - A JSDoc-style `{type}` and an optional-param `[` may sit between the tag
 *   and the name, so a comment carried over from plain JavaScript is caught
 *   too.
 */
const DOTTED_PARAM =
  /^(?<linePrefix>\s*\*?\s*)@param\s+(?:\{[^}]*\}\s*)?\[?(?<objectName>[A-Za-z_$][\w$]*)\.[\w$.]+/;

/*
 * `getAllComments` hands back the comment's *value* — its delimiters stripped —
 * so a match on the first line sits two characters right of where the comment
 * itself starts.
 */
const BLOCK_DELIMITER_WIDTH = "/*".length;

/**
 * Reports a TSDoc `@param` whose name is dotted, e.g. `@param options.fallback`.
 *
 * - `no-restricted-syntax` cannot express this: its selectors match AST nodes,
 *   and a doc block is a comment attached to the source text rather than a
 *   node the selector language can reach.
 *
 * - A pure comment scan, so it needs no type information.
 *
 * - Deliberately not fixable. Relocating the text means finding the matching
 *   property in the type literal, deleting rather than moving it when the param
 *   type is imported, and re-wrapping prose to the print width — three
 *   judgment calls a fixer would get wrong silently.
 */
export const NO_DOTTED_JSDOC_PARAM: Rule.RuleModule = {
  create(context) {
    return {
      // `Program` runs once per linted file, and `sourceCode` is that file
      // alone, so this scans one file's comments, never the whole project.
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          /*
           * `loc` is the comment's source location — the line and column where
           * it starts and ends — which the report needs to underline the match.
           *
           * - Always present here (ESLint parses with `loc: true`), but optional
           *   on the estree type, so narrow it rather than assert it.
           */
          const commentStart = comment.loc?.start;

          if (
            !commentStart ||
            comment.type !== "Block" ||
            !comment.value.startsWith("*")
          ) {
            continue;
          }

          comment.value.split("\n").forEach((line, index) => {
            const match = DOTTED_PARAM.exec(line);

            if (!match) {
              return;
            }

            const [matched] = match;
            const { linePrefix = "", objectName = "" } = match.groups ?? {};

            // The match spans the line's `* ` prefix too, so the underline is
            // the remainder — the `@param name.key` a reader would delete.
            const dottedParam = matched.slice(linePrefix.length);
            const reportedLine = commentStart.line + index;
            const column =
              index === 0
                ? commentStart.column +
                  BLOCK_DELIMITER_WIDTH +
                  linePrefix.length
                : linePrefix.length;

            context.report({
              data: { name: objectName },
              loc: {
                end: {
                  column: column + dottedParam.length,
                  line: reportedLine,
                },
                start: { column, line: reportedLine },
              },
              messageId: "dotted",
            });
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "disallow a dotted TSDoc `@param` name, which documents an object " +
        "param's key where no editor tooltip will ever read it",
    },
    messages: {
      dotted:
        "`@param {{name}}.<key>` is invisible to IntelliSense — the editor " +
        "shows nothing for that key at the call site, which is the one place " +
        "the doc was for. Put the comment on the property in the type literal " +
        "instead. See the TSDoc conventions in AGENTS.md.",
    },
    schema: [],
    type: "problem",
  },
};
