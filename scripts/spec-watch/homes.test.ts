import { describe, expect, test } from "vitest";

import type { FakeRoute } from "#test/spec-watch";

import { API, createFakeFetch, PIN } from "#test/spec-watch";

import type { GitHubClient } from "./github.ts";
import type { Notice } from "./notices.ts";

import { createGitHubClient } from "./github.ts";
import {
  readLinkedHomes,
  readPublicCandidates,
  readSiblingHomes,
} from "./homes.ts";

/** The URL of the owner's newest repos. */
const SIBLINGS_URL = `${API}/users/acme/repos?sort=created&direction=desc&per_page=100`;

/** When the fabricated pin's commit landed. */
const SINCE = Date.parse("2026-08-21T10:00:00Z");

/** A client whose fake `fetch` answers only the given routes. */
function makeClient(routes: FakeRoute[]): GitHubClient {
  const { fetch } = createFakeFetch(routes);

  return createGitHubClient({ fetch, token: "fake-token" });
}

/** A README notice in the home, linking to the given repos. */
function makeNotice(repos: string[]): Notice {
  return { file: "README", line: "Deprecated.", repos };
}

/** The routes that answer a repo's spec, at the pin's path, and its README. */
function makeRepoRoutes({
  readme = "# Repo\n",
  repo,
  version,
}: {
  /** The repo's README. */
  readme?: string;

  /** The repo, as `<owner>/<name>`. */
  repo: string;

  /** Its spec's version, or `undefined` for a repo with no spec. */
  version: string | undefined;
}): FakeRoute[] {
  const specUrl = `${API}/repos/${repo}/contents/okf/SPEC.md`;

  return version === undefined
    ? [
        { status: 404, url: specUrl },
        { status: 404, url: `${API}/repos/${repo}/contents/SPEC.md` },
      ]
    : [
        { body: `**Version ${version}**\n`, url: specUrl },
        { body: readme, url: `${API}/repos/${repo}/readme` },
      ];
}

describe("readPublicCandidates", () => {
  test("reads each public candidate's spec, and skips the rest", async () => {
    // Given - a public candidate with a spec, a private one, and one gone
    const pin = {
      ...PIN,
      candidates: ["acme/public", "acme/private", "acme/gone"],
    };
    const client = makeClient([
      { body: { private: false }, url: `${API}/repos/acme/public` },
      ...makeRepoRoutes({ repo: "acme/public", version: "0.3" }),
      { body: { private: true }, url: `${API}/repos/acme/private` },
      { status: 404, url: `${API}/repos/acme/gone` },
    ]);

    // When - reading them
    const answer = await readPublicCandidates({ client, pin });

    // Then - the public one, with its spec
    expect(answer).toStrictEqual({
      isOk: true,
      publicCandidates: [
        {
          repo: "acme/public",
          spec: { path: "okf/SPEC.md", version: "0.3" },
        },
      ],
    });
  });

  test("fails when a candidate's spec can't be read", async () => {
    // Given - a public candidate whose spec answers 500
    const client = makeClient([
      { body: { private: false }, url: `${API}/repos/acme/next-home` },
      { status: 500, url: `${API}/repos/acme/next-home/contents/okf/SPEC.md` },
    ]);

    // When - reading it
    const answer = await readPublicCandidates({ client, pin: PIN });

    // Then - the read's failure
    expect(answer).toMatchObject({ isOk: false });
  });
});

describe("readLinkedHomes", () => {
  test("follows each found home's README, from move to move", async () => {
    // Given - the home links to a first move and to a repo with no spec;
    // the first move links to a second, and back to the home
    const client = makeClient([
      ...makeRepoRoutes({
        readme:
          "> Deprecated: moved to\n> https://github.com/acme/second\n\nNot a notice: https://github.com/acme/ignored\n",
        repo: "acme/first",
        version: "0.3",
      }),
      ...makeRepoRoutes({ repo: "acme/none", version: undefined }),
      ...makeRepoRoutes({
        readme: "Deprecated: see https://github.com/ACME/SPEC.\n",
        repo: "acme/second",
        version: "0.4",
      }),
    ]);

    // When - reading the linked homes
    const answer = await readLinkedHomes({
      client,
      home: "acme/spec",
      known: ["acme/spec"],
      notices: [makeNotice(["acme/first", "acme/none", "acme/first"])],
      pin: PIN,
    });

    // Then - both moves, each with the repo that links to it
    expect(answer).toStrictEqual([
      {
        linkedFrom: "acme/spec",
        repo: "acme/first",
        spec: { path: "okf/SPEC.md", version: "0.3" },
      },
      {
        linkedFrom: "acme/first",
        repo: "acme/second",
        spec: { path: "okf/SPEC.md", version: "0.4" },
      },
    ]);
  });

  test("finds a home with no README, and follows nothing from it", async () => {
    // Given - a linked repo with a spec and no README
    const client = makeClient([
      {
        body: "**Version 0.3**\n",
        url: `${API}/repos/acme/first/contents/okf/SPEC.md`,
      },
      { status: 404, url: `${API}/repos/acme/first/readme` },
    ]);

    // When - reading the linked homes
    const answer = await readLinkedHomes({
      client,
      home: "acme/spec",
      known: [],
      notices: [makeNotice(["acme/first"])],
      pin: PIN,
    });

    // Then - the one home
    expect(answer).toMatchObject([{ repo: "acme/first" }]);
  });

  test("reads at most ten linked repos", async () => {
    // Given - a notice linking to eleven repos with no spec
    const repos = Array.from({ length: 11 }, (_, index) => `acme/r${index}`);
    const { fetch, requests } = createFakeFetch(
      repos.flatMap((repo) => makeRepoRoutes({ repo, version: undefined }))
    );

    // When - reading the linked homes
    const answer = await readLinkedHomes({
      client: createGitHubClient({ fetch, token: "fake-token" }),
      home: "acme/spec",
      known: ["acme/spec"],
      notices: [makeNotice(repos)],
      pin: PIN,
    });

    // Then - none found, and the eleventh never read
    expect(answer).toStrictEqual([]);
    expect(requests.some((request) => request.url.includes("acme/r10"))).toBe(
      false
    );
  });

  test("skips a repo GitHub won't serve, and a README it won't serve", async () => {
    // Given - a blocked repo, and a found home whose README answers 500
    const client = makeClient([
      { status: 451, url: `${API}/repos/acme/blocked/contents/okf/SPEC.md` },
      {
        body: "**Version 0.3**\n",
        url: `${API}/repos/acme/first/contents/okf/SPEC.md`,
      },
      { status: 500, url: `${API}/repos/acme/first/readme` },
    ]);

    // When - reading the linked homes
    const answer = await readLinkedHomes({
      client,
      home: "acme/spec",
      known: [],
      notices: [makeNotice(["acme/blocked", "acme/first"])],
      pin: PIN,
    });

    // Then - the home that could be read, and nothing followed from it
    expect(answer).toMatchObject([{ repo: "acme/first" }]);
  });
});

describe("readSiblingHomes", () => {
  test("reads the owner's repos created since the pin that hold a spec", async () => {
    // Given - a new repo with a spec, a new one without, an old one, a known
    // one, and one with no name
    const client = makeClient([
      {
        body: [
          { created_at: "2026-09-01T00:00:00Z", full_name: "acme/new" },
          { created_at: "2026-09-01T00:00:00Z", full_name: "acme/none" },
          { created_at: "2026-01-01T00:00:00Z", full_name: "acme/old" },
          { created_at: "2026-09-01T00:00:00Z", full_name: "Acme/Spec" },
          { created_at: "2026-09-01T00:00:00Z" },
          { full_name: "acme/undated" },
        ],
        url: SIBLINGS_URL,
      },
      ...makeRepoRoutes({ repo: "acme/new", version: "0.3" }),
      ...makeRepoRoutes({ repo: "acme/none", version: undefined }),
    ]);

    // When - reading the sibling homes
    const answer = await readSiblingHomes({
      client,
      home: "acme/spec",
      known: ["acme/spec"],
      pin: PIN,
      since: SINCE,
    });

    // Then - the new repo with a spec
    expect(answer).toStrictEqual({
      homes: [
        {
          linkedFrom: undefined,
          repo: "acme/new",
          spec: { path: "okf/SPEC.md", version: "0.3" },
        },
      ],
      isOk: true,
    });
  });

  test("counts every repo when the pin's date is unknown", async () => {
    // Given - an old repo with a spec, and one GitHub won't serve
    const client = makeClient([
      {
        body: [
          { created_at: "2020-01-01T00:00:00Z", full_name: "acme/old" },
          { created_at: "2020-01-01T00:00:00Z", full_name: "acme/blocked" },
        ],
        url: SIBLINGS_URL,
      },
      ...makeRepoRoutes({ repo: "acme/old", version: "0.2" }),
      { status: 451, url: `${API}/repos/acme/blocked/contents/okf/SPEC.md` },
    ]);

    // When - reading the sibling homes with no date
    const answer = await readSiblingHomes({
      client,
      home: "acme/spec",
      known: [],
      pin: PIN,
      since: undefined,
    });

    // Then - the old repo, and the blocked one skipped
    expect(answer).toMatchObject({ homes: [{ repo: "acme/old" }], isOk: true });
  });

  test("reads the repos of the home's owner now, after a transfer", async () => {
    // Given - the home now under another owner, with a new repo beside it
    const client = makeClient([
      {
        body: [{ created_at: "2026-09-01T00:00:00Z", full_name: "okf/new" }],
        url: `${API}/users/okf/repos?sort=created&direction=desc&per_page=100`,
      },
      ...makeRepoRoutes({ repo: "okf/new", version: "0.3" }),
    ]);

    // When - reading the sibling homes beside the transferred home
    const answer = await readSiblingHomes({
      client,
      home: "okf/spec",
      known: [],
      pin: PIN,
      since: SINCE,
    });

    // Then - the new repo beside it
    expect(answer).toMatchObject({ homes: [{ repo: "okf/new" }], isOk: true });
  });

  test("finds none when the owner is gone", async () => {
    // Given - the owner answers 404
    const client = makeClient([{ status: 404, url: SIBLINGS_URL }]);

    // When - reading the sibling homes
    const answer = await readSiblingHomes({
      client,
      home: "acme/spec",
      known: [],
      pin: PIN,
      since: SINCE,
    });

    // Then - none
    expect(answer).toStrictEqual({ homes: [], isOk: true });
  });

  test.each([
    {
      description: "the owner's repos fail",
      reason: `GET ${SIBLINGS_URL.slice(API.length)} answered 500`,
      routes: [{ status: 500, url: SIBLINGS_URL }],
    },
    {
      description: "the owner's repos aren't a list",
      reason: `GET ${SIBLINGS_URL.slice(API.length)} didn't answer with a list`,
      routes: [{ body: {}, url: SIBLINGS_URL }],
    },
  ])("fails when $description", async ({ reason, routes }) => {
    // Given - one read that fails

    // When - reading the sibling homes
    const answer = await readSiblingHomes({
      client: makeClient(routes),
      home: "acme/spec",
      known: [],
      pin: PIN,
      since: SINCE,
    });

    // Then - that read's reason
    expect(answer).toStrictEqual({ isOk: false, reason });
  });
});
