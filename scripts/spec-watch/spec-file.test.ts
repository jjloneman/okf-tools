import { describe, expect, test } from "vitest";

import type { FakeRoute } from "#test/spec-watch";

import { API, createFakeFetch, PIN } from "#test/spec-watch";

import type { SpecPin } from "./pin.ts";

import { createGitHubClient } from "./github.ts";
import { readSpecFile, readVersion } from "./spec-file.ts";

/** The URL of a file in the fabricated other repo. */
function fileUrl(path: string): string {
  return `${API}/repos/acme/other/contents/${path}`;
}

/** Read the other repo's spec through a fake `fetch`. */
function read({
  pin = PIN,
  routes,
}: {
  /** The pin, whose `path` is tried first. */
  pin?: SpecPin;

  /** The routes the fake `fetch` answers. */
  routes: FakeRoute[];
}): ReturnType<typeof readSpecFile> {
  const { fetch } = createFakeFetch(routes);

  return readSpecFile({
    client: createGitHubClient({ fetch, token: "fake-token" }),
    pin,
    repo: "acme/other",
  });
}

describe("readSpecFile", () => {
  test.each([
    {
      description: "at the pin's path",
      expected: { path: "okf/SPEC.md", version: "0.3" },
      routes: [{ body: "**Version 0.3**\n", url: fileUrl("okf/SPEC.md") }],
    },
    {
      description: "at the root, when the pin's path has none",
      expected: { path: "SPEC.md", version: "0.4 (draft)" },
      routes: [
        { status: 404, url: fileUrl("okf/SPEC.md") },
        { body: "**Version 0.4 (draft)**\n", url: fileUrl("SPEC.md") },
      ],
    },
    {
      description: "nothing, when no file has a version line",
      expected: undefined,
      routes: [
        { body: "# Unrelated\n", url: fileUrl("okf/SPEC.md") },
        { status: 404, url: fileUrl("SPEC.md") },
      ],
    },
  ])("reads a spec $description", async ({ expected, routes }) => {
    // Given - the other repo's files

    // When - reading its spec
    const answer = await read({ routes });

    // Then - the spec found, or none
    expect(answer).toStrictEqual({ isOk: true, spec: expected });
  });

  test("tries the root once when the pin's spec is at the root", async () => {
    // Given - a pin at the root, and a repo with no spec
    const pin = { ...PIN, path: "SPEC.md" };
    const routes = [{ status: 404, url: fileUrl("SPEC.md") }];

    // When - reading its spec
    const answer = await read({ pin, routes });

    // Then - none, after one read
    expect(answer).toStrictEqual({ isOk: true, spec: undefined });
  });

  test("fails when a read fails", async () => {
    // Given - a file that answers 500
    const routes = [{ status: 500, url: fileUrl("okf/SPEC.md") }];

    // When - reading its spec
    const answer = await read({ routes });

    // Then - the read's failure
    expect(answer).toStrictEqual({
      isOk: false,
      reason: "GET /repos/acme/other/contents/okf/SPEC.md answered 500",
    });
  });
});

describe("readVersion", () => {
  test.each([
    {
      description: "a version line",
      expected: "0.3",
      text: "# Spec\n**Version 0.3 **\n",
    },
    { description: "no version line", expected: undefined, text: "# Spec\n" },
  ])("reads $description", ({ expected, text }) => {
    // Given - a spec's text

    // When - reading its version
    const version = readVersion(text);

    // Then - the trimmed version, or undefined
    expect(version).toBe(expected);
  });
});
