import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

import { useTestRepo } from "#test/repo";

import {
  formatVersion,
  readPackageVersion,
  SUPPORTED_SPEC_VERSION,
} from "./version.ts";

const { repo } = useTestRepo();

/** Read a field of a JSON file in this repo, from the repo root. */
function readJsonField(params: {
  /**
   * The field to read.
   *
   * @example "version"
   */
  field: string;

  /**
   * The file's path from this repo's root.
   *
   * @example "spec/upstream.json"
   */
  filePath: string;
}): unknown {
  const { field, filePath } = params;
  const parsed = JSON.parse(
    readFileSync(new URL(`../${filePath}`, import.meta.url), "utf8")
  ) as Record<string, unknown>;

  return parsed[field];
}

/** The URL of a file in the scratch repo. */
function scratchUrl(filePath: string): URL {
  return pathToFileURL(path.join(repo.root, filePath));
}

describe("SUPPORTED_SPEC_VERSION", () => {
  test("is the version spec/upstream.json pins", () => {
    // Given - the pinned upstream spec's version
    const pinned = readJsonField({
      field: "version",
      filePath: "spec/upstream.json",
    });

    // When/Then - the version okf migrate writes is the one pinned
    expect(SUPPORTED_SPEC_VERSION).toBe(pinned);
  });
});

describe("readPackageVersion", () => {
  test("reads the installed package's version by default", () => {
    // Given - this repo's own package.json
    const version = readJsonField({
      field: "version",
      filePath: "package.json",
    });

    // When/Then - the version it declares
    expect(readPackageVersion()).toBe(version);
  });

  test("reads the version of the package.json it's given", () => {
    // Given - a package.json with a version
    repo.write("pkg/package.json", JSON.stringify({ version: "9.8.7" }));

    // When/Then - that version
    expect(readPackageVersion(scratchUrl("pkg/package.json"))).toBe("9.8.7");
  });

  test.each([
    { description: "a version that isn't text", text: '{ "version": 1 }' },
    { description: "no version", text: '{ "name": "x" }' },
    { description: "JSON that isn't an object", text: '"1.0.0"' },
    { description: "null", text: "null" },
    { description: "invalid JSON", text: "{" },
  ])("reads $description as unknown", ({ text }) => {
    // Given - a package.json that holds no version
    repo.write("pkg/package.json", text);

    // When/Then - unknown
    expect(readPackageVersion(scratchUrl("pkg/package.json"))).toBe("unknown");
  });

  test("reads a missing file as unknown", () => {
    // Given/When/Then - a path with no file is an unknown version
    expect(readPackageVersion(scratchUrl("missing/package.json"))).toBe(
      "unknown"
    );
  });
});

describe("formatVersion", () => {
  test("names the package version and the OKF version it supports", () => {
    // Given - the installed version
    const version = readPackageVersion();

    // When/Then - both versions, on one line
    expect(formatVersion()).toBe(
      `okf-tools ${version} (OKF v${SUPPORTED_SPEC_VERSION})`
    );
  });
});
