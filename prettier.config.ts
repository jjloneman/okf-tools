import type { Config } from "prettier";

const CONFIG: Config = {
  overrides: [
    /*
     * The git hooks are POSIX shell scripts with no extension, so Prettier
     * can't infer a parser from the filename.
     *
     * - Matched by `!(*.*)` (extensionless files only) rather than
     *   `.githooks/*`, so a non-shell file added later keeps its own parser.
     */
    {
      files: ".githooks/!(*.*)",
      options: { parser: "sh" },
    },

    /*
     * JSONC files are hand-edited, so keep them free of the trailing commas
     * the es5 default would add.
     *
     * - `tsconfig.json` is listed by name because Prettier parses it as JSONC
     *   despite the `.json` extension.
     */
    {
      files: ["*.jsonc", "tsconfig.json"],
      options: { trailingComma: "none" },
    },
  ],
  plugins: ["prettier-plugin-packagejson", "prettier-plugin-sh"],
  trailingComma: "es5",
};

export default CONFIG;
