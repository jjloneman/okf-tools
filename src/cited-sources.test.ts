import { describe, expect, test } from "vitest";

import { record } from "#test/repo";

import { readCheckedFile } from "./check-engine.ts";
import { readCitedSources } from "./cited-sources.ts";
import { readParsed } from "./spec-rules.ts";

/** Read the cited sources of `kb/notes/a.md`, as `resource -> path`. */
function readPaths(lines: readonly string[]): string[] {
  const parsed = readParsed(
    readCheckedFile({
      bundleDir: "kb",
      doesExist: () => true,
      filePath: "kb/notes/a.md",
      text: record(["type: Decision", ...lines]),
    })
  );

  return (parsed === undefined ? [] : readCitedSources(parsed)).map(
    ({ path, resource }) => `${resource} -> ${path}`
  );
}

describe("readCitedSources", () => {
  test("resolves each path from the record's folder or the bundle root", () => {
    // Given/When - a relative path, a root-relative one, and a folder
    const paths = readPaths([
      "sources:",
      "  - { id: a, resource: ../../src/a.ts }",
      "  - { id: b, resource: /b.md }",
      "  - { id: c, resource: ../../src/ }",
    ]);

    // Then - each from the repo root
    expect(paths).toStrictEqual([
      "../../src/a.ts -> src/a.ts",
      "/b.md -> kb/b.md",
      "../../src/ -> src",
    ]);
  });

  test("reads a bare mapping as one entry", () => {
    // When/Then - the one entry
    expect(readPaths(["sources: { resource: ../c.md }"])).toStrictEqual([
      "../c.md -> kb/c.md",
    ]);
  });

  test.each([
    { description: "a URL", resource: "https://example.com/a" },
    { description: "a network path", resource: "//example.com/a" },
    { description: "a fragment alone", resource: "'#intro'" },
    { description: "a scope descriptor", resource: "'the whole repo'" },
    { description: "a path that leaves the repo", resource: "../../../a.ts" },
    { description: "the repo root", resource: "../.." },
  ])("skips $description", ({ resource }) => {
    // When/Then - nothing
    expect(readPaths([`sources: [{ resource: ${resource} }]`])).toStrictEqual(
      []
    );
  });

  test("skips an entry with no resource", () => {
    // When/Then - nothing
    expect(readPaths(["sources: [{ id: a }, plain]"])).toStrictEqual([]);
  });
});
