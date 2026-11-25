/*
 * The spec watch's entry, which `.github/workflows/spec-watch.yml` runs under
 * Node's type stripping: erasable syntax only, and `.ts` import specifiers.
 */
import path from "node:path";

import { runSpecWatch } from "./watch.ts";

process.exitCode = await runSpecWatch({
  env: process.env,
  fetch,
  pinPath: path.resolve(import.meta.dirname, "../../spec/upstream.json"),
  printer: {
    error: (line) => {
      console.error(line);
    },
    info: (line) => {
      console.log(line);
    },
  },
});
