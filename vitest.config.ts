import type { ViteUserConfig } from "vitest/config";

import { defineConfig } from "vitest/config";

const CONFIG: ViteUserConfig = defineConfig({
  test: {
    /*
     * An explicit `include` counts untested files against coverage instead of
     * leaving them out of the report.
     *
     * - `text` is listed twice: the bare entry prints to the log, and the one
     *   given a `file` writes the per-file table to `coverage/`.
     */
    coverage: {
      exclude: ["{scripts,src}/**/*.test.ts"],
      include: ["{scripts,src}/**/*.ts"],
      provider: "v8",
      reporter: [
        "html",
        "json",
        "json-summary",
        "text",
        ["text", { file: "coverage.txt" }],
      ],
      thresholds: { 100: true },
    },
    environment: "node",
    include: ["{scripts,src}/**/*.test.ts"],
  },
});

export default CONFIG;
