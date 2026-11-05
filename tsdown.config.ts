import type { UserConfig } from "tsdown";

import { defineConfig } from "tsdown";

/*
 * ESM only, for Node: the package is a CLI plus the frontmatter functions it
 * uses, and every consumer runs it under Node 22 or later.
 *
 * - `bin.ts` is its own entry, so the `bin` file is the one carrying the
 *   shebang and the top-level `await`.
 *
 * - Declarations come from tsc, not Oxc: Oxc widens a `const` literal's type.
 */
const CONFIG: UserConfig = defineConfig({
  dts: { generator: "tsc" },
  entry: ["src/bin.ts", "src/index.ts"],
  // `"type": "module"` already makes `.js` ESM, the name `exports` uses.
  fixedExtension: false,
  format: "esm",
  platform: "node",
  target: "node22",
});

export default CONFIG;
