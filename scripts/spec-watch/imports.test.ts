import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/** The spec watch's own folder. */
const FOLDER = new URL(".", import.meta.url);

/** An import or export's module specifier. */
const SPECIFIER_PATTERN = /\bfrom\s+"(?<specifier>[^"]+)"/gu;

describe("the spec watch's imports", () => {
  test("never reach node_modules, since spec-watch.yml runs with no install", () => {
    // Given - every source file the workflow runs
    const files = readdirSync(FOLDER).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts")
    );

    // When - reading each one's module specifiers
    const bare = files.flatMap((file) =>
      [
        ...readFileSync(new URL(file, FOLDER), "utf8").matchAll(
          SPECIFIER_PATTERN
        ),
      ]
        .map((match) => match.groups?.specifier ?? "")
        .filter((specifier) => !/^(?:\.|node:)/u.test(specifier))
        .map((specifier) => `${file}: ${specifier}`)
    );

    // Then - only relative paths and Node's own modules
    expect(bare).toStrictEqual([]);
  });
});
