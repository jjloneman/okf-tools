import { describe, expect, test } from "vitest";

import type { FakeRoute } from "#test/spec-watch";

import { API, createFakeFetch } from "#test/spec-watch";

import { createGitHubClient } from "./github.ts";
import { readReleases } from "./releases.ts";

/** The URL of the first page of releases. */
const RELEASES_URL = `${API}/repos/acme/spec/releases?per_page=100&page=1`;

/** The URL of the first page of tags. */
const TAGS_URL = `${API}/repos/acme/spec/tags?per_page=100&page=1`;

/** Read the fabricated repo's releases through a fake `fetch`. */
function read(routes: FakeRoute[]): ReturnType<typeof readReleases> {
  const { fetch } = createFakeFetch(routes);

  return readReleases({
    client: createGitHubClient({ fetch, token: "fake-token" }),
    repo: "acme/spec",
  });
}

describe("readReleases", () => {
  test("reads the releases, and the tags no release is published from", async () => {
    // Given - two releases, one untitled, one with no tag, and three tags
    const routes: FakeRoute[] = [
      {
        body: [
          { name: "OKF v0.3", tag_name: "v0.3" },
          { tag_name: "v0.3-rc" },
          { name: "No tag" },
        ],
        url: RELEASES_URL,
      },
      {
        body: [{ name: "v0.3" }, { name: "v0.3-rc" }, { name: "v0.2" }, {}],
        url: TAGS_URL,
      },
    ];

    // When - reading them
    const answer = await read(routes);

    // Then - both tagged releases, and the one tag left over
    expect(answer).toStrictEqual({
      isOk: true,
      releases: [
        { name: "OKF v0.3", tag: "v0.3" },
        { name: "", tag: "v0.3-rc" },
      ],
      tags: ["v0.2"],
    });
  });

  test.each([
    {
      description: "the releases",
      reason: `GET ${RELEASES_URL.slice(API.length)} answered 500`,
      routes: [{ status: 500, url: RELEASES_URL }],
    },
    {
      description: "the tags",
      reason: `GET ${TAGS_URL.slice(API.length)} answered 500`,
      routes: [
        { body: [], url: RELEASES_URL },
        { status: 500, url: TAGS_URL },
      ],
    },
  ])("fails when $description fail", async ({ reason, routes }) => {
    // Given - one read that fails

    // When - reading them
    const answer = await read(routes);

    // Then - that read's reason
    expect(answer).toStrictEqual({ isOk: false, reason });
  });
});
