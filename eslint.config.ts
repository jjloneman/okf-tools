import type { Linter } from "eslint";

import jsPlugin from "@eslint/js";
import jsoncPlugin from "eslint-plugin-jsonc";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import tsdocPlugin from "eslint-plugin-tsdoc";
import ymlPlugin from "eslint-plugin-yml";
import { defineConfig, globalIgnores, includeIgnoreFile } from "eslint/config";
import path from "node:path";
import { configs as tsConfigs } from "typescript-eslint";

import { NO_DOTTED_JSDOC_PARAM } from "./eslint-rules/no-dotted-jsdoc-param";

/**
 * One `yml/sort-keys` option: the mappings whose path matches `pathPattern`
 * list `keys` first, in that order, then any other key alphabetized.
 *
 * @returns the rule option.
 */
function documentedOrder({
  keys,
  pathPattern,
}: {
  /** The keys whose order carries meaning, in that order. */
  keys: readonly string[];

  /**
   * A regex source matched against a mapping's path, such as
   * `jobs.lint.steps[0]`; the root mapping's path is empty.
   */
  pathPattern: string;
}): {
  order: ({ order: { caseSensitive: boolean; type: "asc" } } | string)[];
  pathPattern: string;
} {
  return {
    order: [...keys, { order: { caseSensitive: false, type: "asc" } }],
    pathPattern,
  };
}

const CONFIG: Linter.Config[] = defineConfig(
  /*
   * ESLint doesn't read `.gitignore` on its own, so load it — one list of
   * ignored paths, which can't drift from git's.
   *
   * - Without it, `eslint .` lints gitignored dotfiles such as a per-user
   *   `.vscode/settings.json`, and `lint:fix` rewrites them.
   */
  includeIgnoreFile(path.resolve(import.meta.dirname, ".gitignore")),

  // Tracked, but rewritten by pnpm on every install.
  globalIgnores(["pnpm-lock.yaml"]),

  /*
   * TypeScript, with the full typed presets.
   *
   * - Every linted file must belong to a project, and the project service
   *   resolves one only by walking up to the nearest config named exactly
   *   `tsconfig.json` — so a new top-level directory of `.ts` files must be
   *   added to that config's `include`, or linting it errors.
   *
   * - Typed rules make a file's verdict depend on the types it imports, which
   *   `.eslintcache` can't see: a file whose own content is unchanged is served
   *   from the cache even when an imported type changed underneath it. Delete
   *   `.eslintcache` when a local result looks impossible.
   *
   * - Scoped by `files` through `extends`, so no JS or typed rule ever runs
   *   against the JSON and YAML files below.
   */
  {
    extends: [
      jsPlugin.configs.recommended,
      tsConfigs.strictTypeChecked,
      tsConfigs.stylisticTypeChecked,
      perfectionistPlugin.configs["recommended-alphabetical"],
    ],
    files: ["**/*.mts", "**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      local: { rules: { "no-dotted-jsdoc-param": NO_DOTTED_JSDOC_PARAM } },
      tsdoc: tsdocPlugin,
    },
    rules: {
      // The stylistic preset defaults to `interface`; the repo prefers `type`.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "separate-type-imports", prefer: "type-imports" },
      ],

      /*
       * A boolean variable or parameter reads as a question: `isEmpty`,
       * `hasKey`, `shouldTrim`, and a module-level constant is
       * `SCREAMING_SNAKE_CASE`.
       *
       * - Destructured bindings are exempt, since their name is the source
       *   object's key and renaming it at the binding site only hides that.
       *
       * - An entry with `types` outranks one without, and among the rest the
       *   one with the most modifiers wins: so a boolean constant keeps the
       *   `isX` form, and the destructured exemption repeats `const` and
       *   `global` to outrank the constant entry.
       *
       * - A module-level function is a `function` declaration, which this rule
       *   doesn't reach, rather than an arrow bound to a constant.
       */
      "@typescript-eslint/naming-convention": [
        "error",
        {
          format: ["PascalCase"],
          prefix: ["can", "has", "is", "should"],
          selector: ["parameter", "variable"],
          types: ["boolean"],
        },
        {
          format: null,
          modifiers: ["destructured"],
          selector: ["parameter", "variable"],
        },
        {
          format: null,
          modifiers: ["const", "destructured", "global"],
          selector: "variable",
        },
        {
          format: ["UPPER_CASE"],
          modifiers: ["const", "global"],
          selector: "variable",
        },
      ],

      /*
       * Numbers interpolate safely; the rule's worth is catching `undefined`,
       * `null`, and `[object Object]` slipping into a string.
       *
       * - Without this, every number in a template needs a `String()` wrapper
       *   that changes nothing: `${count}` reads the same as
       *   `${String(count)}` and prints the same.
       */
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],

      // A brace-less guard reads fine until a second statement is added to it,
      // at which point that one runs unconditionally.
      curly: ["error", "all"],

      /*
       * A dotted `@param options.key` reaches no editor tooltip.
       *
       * - A local rule rather than a `no-restricted-syntax` selector, because
       *   a doc block is a comment, not an AST node a selector can reach.
       */
      "local/no-dotted-jsdoc-param": "error",

      // `Boolean(value)` over `!!value`, `Number(value)` over `+value`, and
      // `String(value)` over `"" + value`; autofixable.
      "no-implicit-coercion": "error",

      // Rewrite as a named helper whose guards read top to bottom, or a lookup
      // keyed by the discriminant.
      "no-nested-ternary": "error",

      "object-shorthand": ["error", "always"],

      // A named group says what it captured; `match[2]` makes the reader
      // count parentheses.
      "prefer-named-capture-group": "error",

      "tsdoc/syntax": "error",
    },
    /*
     * Every perfectionist rule sorts case-insensitively, so `fallback` sorts
     * before `Options`.
     *
     * - Where an order carries meaning (a `Set`'s iteration order, a module
     *   read top to bottom), disable the rule on that line with a comment
     *   saying why, rather than turning it off here.
     */
    settings: {
      perfectionist: { ignoreCase: true },
    },
  },

  /*
   * JSON keys stay alphabetized, like object keys in TypeScript.
   *
   * - `package.json` is excluded: it keeps the conventional `sort-package-json`
   *   order, which `prettier-plugin-packagejson` enforces instead.
   *
   * - `tsconfig.json` and VS Code's `.vscode/*.json` are JSONC — their tools
   *   read comments in them — so they get the JSONC preset, which allows them.
   */
  {
    extends: [jsoncPlugin.configs["flat/recommended-with-json"]],
    files: ["**/*.json"],
    ignores: ["**/package.json", "**/tsconfig.json", ".vscode/*.json"],
  },
  {
    extends: [jsoncPlugin.configs["flat/recommended-with-jsonc"]],
    files: ["**/*.jsonc", "**/tsconfig.json", ".vscode/*.json"],
  },
  {
    extends: [jsoncPlugin.configs["flat/prettier"]],
    files: ["**/*.json", "**/*.jsonc"],
    ignores: ["**/package.json"],
    rules: {
      "jsonc/sort-keys": ["error", "asc", { caseSensitive: false }],
    },
  },

  // YAML keys stay alphabetized too; `flat/prettier` defers formatting to
  // Prettier.
  {
    extends: [
      ymlPlugin.configs["flat/recommended"],
      ymlPlugin.configs["flat/prettier"],
    ],
    files: ["**/*.yaml", "**/*.yml"],
    rules: {
      "yml/sort-keys": ["error", "asc", { caseSensitive: false }],
    },
  },

  /*
   * GitHub's YAML files read in their documented order instead: a workflow
   * opens with `name` and `on`, a step with `name` and `uses`, and an issue
   * form with `name`, `description`, `title`, and `labels`.
   *
   * - Each mapping lists its well-known keys first, in that order; any other
   *   key follows, alphabetized.
   *
   * - The first `pathPattern` matching a mapping's path wins, so the
   *   alphabetical fallback comes last.
   */
  {
    files: [".github/**/*.yml"],
    rules: {
      "yml/sort-keys": [
        "error",
        // A workflow's or an action's top level.
        documentedOrder({
          keys: [
            "name",
            "description",
            "title",
            "labels",
            "on",
            "inputs",
            "outputs",
            "concurrency",
            "permissions",
            "env",
            "defaults",
            "jobs",
            "runs",
          ],
          pathPattern: "^$",
        }),
        documentedOrder({
          keys: [
            "name",
            "if",
            "needs",
            "runs-on",
            "permissions",
            "strategy",
            "outputs",
            "env",
            "steps",
          ],
          pathPattern: String.raw`^jobs(?:\.[^.[]+|\[[^\]]+\])$`,
        }),
        documentedOrder({
          keys: ["name", "id", "if", "uses", "with", "env", "shell", "run"],
          pathPattern: String.raw`\.steps\[\d+\]$`,
        }),
        documentedOrder({ keys: ["using", "steps"], pathPattern: "^runs$" }),
        documentedOrder({
          keys: ["cron", "timezone"],
          pathPattern: String.raw`^on\.schedule\[\d+\]$`,
        }),
        documentedOrder({ keys: [], pathPattern: ".*" }),
      ],
    },
  }
);

export default CONFIG;
