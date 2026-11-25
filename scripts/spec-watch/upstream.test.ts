import { describe, expect, test } from "vitest";

import type { FakeRoute } from "#test/spec-watch";

import {
  API,
  createFakeFetch,
  createUpstreamRoutes,
  HEAD_SHA,
  PIN,
  PIN_SHA,
} from "#test/spec-watch";

import type { SpecPin } from "./pin.ts";

import { createGitHubClient } from "./github.ts";
import { findNewNotices, readUpstream, readVersion } from "./upstream.ts";

/** The URL of the commits list the watch reads. */
const COMMITS_URL = `${API}/repos/acme/spec/commits?path=okf%2FSPEC.md&per_page=100`;

/** The URL of the spec's contents, before its `ref`. */
const SPEC_URL = `${API}/repos/acme/spec/contents/okf/SPEC.md`;

/** The URL of the first page of open pull requests. */
const PULLS_URL = `${API}/repos/acme/spec/pulls?state=open&per_page=100&page=1`;

/** One entry of the commits list, as GitHub answers it. */
function makeCommit(sha: string): unknown {
  return {
    commit: {
      author: { date: "2026-08-21T10:00:00Z" },
      message: `Update the spec\n\nA longer body.`,
    },
    html_url: `https://github.com/acme/spec/commit/${sha}`,
    sha,
  };
}

/** Read upstream through a fake `fetch` that answers only the given routes. */
function read({
  pin = PIN,
  routes,
}: {
  /** The pin to compare against. */
  pin?: SpecPin;

  /** The routes the fake `fetch` answers, the first match winning. */
  routes: FakeRoute[];
}): ReturnType<typeof readUpstream> {
  const { fetch } = createFakeFetch(routes);

  return readUpstream({
    client: createGitHubClient({ fetch, token: "fake-token" }),
    pin,
  });
}

describe("readUpstream", () => {
  test("reads an unchanged upstream", async () => {
    // Given - upstream still at the pin
    const routes = createUpstreamRoutes({
      headSha: PIN_SHA,
      pinSha: PIN_SHA,
      version: "0.2",
    });

    // When - reading it
    const answer = await read({ routes });

    // Then - nothing differs from the pin
    expect(answer).toStrictEqual({
      isOk: true,
      upstream: {
        commits: [],
        fullName: "acme/spec",
        headSha: PIN_SHA,
        isArchived: false,
        isPinFound: true,
        isSpecMissing: false,
        notices: [],
        publicCandidates: [],
        pullRequests: [],
        version: "0.2",
      },
    });
  });

  test("reads every kind of change", async () => {
    // Given - a renamed, archived repo with a new commit, notices, pull
    // requests, and a public candidate
    const pin = { ...PIN, candidates: ["acme/next-home", "acme/other-home"] };
    const routes: FakeRoute[] = [
      {
        body: { archived: true, full_name: "acme/spec-renamed" },
        url: `${API}/repos/acme/spec`,
      },
      {
        body: [makeCommit(HEAD_SHA), makeCommit(PIN_SHA)],
        url: COMMITS_URL,
      },
      {
        body: "**Version 0.3**\nThe spec has moved to acme/next-home.\n",
        url: `${SPEC_URL}?ref=${HEAD_SHA}`,
      },
      { body: "**Version 0.2**\n", url: `${SPEC_URL}?ref=${PIN_SHA}` },
      {
        body: "# Spec\nThis repo is archived.\n  Deprecated: see below.\nDeprecated: see below.\n",
        url: `${API}/repos/acme/spec/readme`,
      },
      {
        body: "# Spec\nThis repo is archived.\n",
        url: `${API}/repos/acme/spec/readme?ref=${PIN_SHA}`,
      },
      {
        body: [
          { number: 9, title: "Touch the spec" },
          { title: "No number" },
          { number: 5, title: "Touch the README" },
          { number: 4, title: "Rename the spec" },
        ],
        url: PULLS_URL,
      },
      {
        body: [{ filename: "README.md" }, { filename: "okf/SPEC.md" }],
        url: `${API}/repos/acme/spec/pulls/9/files?per_page=100&page=1`,
      },
      {
        body: [{ filename: "README.md" }],
        url: `${API}/repos/acme/spec/pulls/5/files?per_page=100&page=1`,
      },
      {
        body: [{ filename: "okf/NEW.md", previous_filename: "okf/SPEC.md" }],
        url: `${API}/repos/acme/spec/pulls/4/files?per_page=100&page=1`,
      },
      { body: { private: false }, url: `${API}/repos/acme/next-home` },
      { status: 404, url: `${API}/repos/acme/other-home` },
    ];

    // When - reading it
    const answer = await read({ pin, routes });

    // Then - each change, with pull requests by number
    expect(answer).toStrictEqual({
      isOk: true,
      upstream: {
        commits: [
          {
            date: "2026-08-21T10:00:00Z",
            sha: HEAD_SHA,
            subject: "Update the spec",
            url: `https://github.com/acme/spec/commit/${HEAD_SHA}`,
          },
        ],
        fullName: "acme/spec-renamed",
        headSha: HEAD_SHA,
        isArchived: true,
        isPinFound: true,
        isSpecMissing: false,
        notices: [
          { file: "README", line: "Deprecated: see below." },
          { file: "SPEC", line: "The spec has moved to acme/next-home." },
        ],
        publicCandidates: ["acme/next-home"],
        pullRequests: [
          { number: 4, title: "Rename the spec" },
          { number: 9, title: "Touch the spec" },
        ],
        version: "0.3",
      },
    });
  });

  test("lists every commit, and reads missing fields as empty, when the pin isn't found", async () => {
    // Given - commits that don't reach the pin, one with no fields, and an
    // untitled pull request
    const routes: FakeRoute[] = [
      { body: [makeCommit(HEAD_SHA), {}], url: COMMITS_URL },
      { body: [{ number: 3 }], url: PULLS_URL },
      {
        body: [{ filename: "okf/SPEC.md" }],
        url: `${API}/repos/acme/spec/pulls/3/files?per_page=100&page=1`,
      },
      ...createUpstreamRoutes({
        headSha: HEAD_SHA,
        pinSha: PIN_SHA,
        version: "0.2",
      }),
    ];

    // When - reading it
    const answer = await read({ routes });

    // Then - both commits, the pin not found, and empty fields
    expect(answer).toMatchObject({
      isOk: true,
      upstream: {
        commits: [
          { sha: HEAD_SHA, subject: "Update the spec" },
          { date: "", sha: "", subject: "", url: "" },
        ],
        isPinFound: false,
        pullRequests: [{ number: 3, title: "" }],
      },
    });
  });

  test("reads a spec with no commits as missing, and a bare repo with defaults", async () => {
    // Given - a repo answering no fields, no commits, and no README
    const routes: FakeRoute[] = [
      { body: {}, url: `${API}/repos/acme/spec` },
      { body: [], url: COMMITS_URL },
      { status: 404, url: `${SPEC_URL}?ref=${PIN_SHA}` },
      { status: 404, url: `${API}/repos/acme/spec/readme` },
      { status: 404, url: `${API}/repos/acme/spec/readme?ref=${PIN_SHA}` },
      { body: [], url: PULLS_URL },
      { body: {}, url: `${API}/repos/acme/next-home` },
    ];

    // When - reading it
    const answer = await read({ routes });

    // Then - the pin's name, not archived, the spec missing with no version
    expect(answer).toStrictEqual({
      isOk: true,
      upstream: {
        commits: [],
        fullName: "acme/spec",
        headSha: undefined,
        isArchived: false,
        isPinFound: false,
        isSpecMissing: true,
        notices: [],
        publicCandidates: [],
        pullRequests: [],
        version: undefined,
      },
    });
  });

  test.each([
    {
      description: "a public candidate",
      expectedCandidates: ["acme/next-home"],
      routes: [
        { body: { private: false }, url: `${API}/repos/acme/next-home` },
      ],
    },
    {
      description: "a private candidate",
      expectedCandidates: [],
      routes: [{ body: { private: true }, url: `${API}/repos/acme/next-home` }],
    },
    {
      description: "a candidate that doesn't exist",
      expectedCandidates: [],
      routes: [{ status: 404, url: `${API}/repos/acme/next-home` }],
    },
  ])(
    "reads a repo that is gone, with $description",
    async ({ expectedCandidates, routes }) => {
      // Given - the repo answers 404
      const allRoutes: FakeRoute[] = [
        { status: 404, url: `${API}/repos/acme/spec` },
        ...routes,
      ];

      // When - reading it
      const answer = await read({ routes: allRoutes });

      // Then - the gone state, with the candidates read
      expect(answer).toStrictEqual({
        isOk: true,
        upstream: {
          commits: [],
          fullName: undefined,
          headSha: undefined,
          isArchived: false,
          isPinFound: false,
          isSpecMissing: false,
          notices: [],
          publicCandidates: expectedCandidates,
          pullRequests: [],
          version: undefined,
        },
      });
    }
  );

  test("fails when the repo is gone and a candidate read fails", async () => {
    // Given - the repo answers 404, and its candidate answers 500
    const routes: FakeRoute[] = [
      { status: 404, url: `${API}/repos/acme/spec` },
      { status: 500, url: `${API}/repos/acme/next-home` },
    ];

    // When - reading it
    const answer = await read({ routes });

    // Then - the candidate's failure
    expect(answer).toStrictEqual({
      isOk: false,
      reason: "GET /repos/acme/next-home answered 500",
    });
  });

  test.each([
    {
      description: "the repo",
      reason: "GET /repos/acme/spec answered 500",
      route: { status: 500, url: `${API}/repos/acme/spec` },
    },
    {
      description: "the commits",
      reason: `GET ${COMMITS_URL.slice(API.length)} answered 500`,
      route: { status: 500, url: COMMITS_URL },
    },
    {
      description: "the commits, when they aren't a list",
      reason: `GET ${COMMITS_URL.slice(API.length)} didn't answer with a list`,
      route: { body: {}, url: COMMITS_URL },
    },
    {
      description: "a file",
      reason: `GET /repos/acme/spec/contents/okf/SPEC.md?ref=${HEAD_SHA} answered 500`,
      route: { status: 500, url: `${SPEC_URL}?ref=${HEAD_SHA}` },
    },
    {
      description: "the pull requests",
      reason: `GET ${PULLS_URL.slice(API.length)} answered 500`,
      route: { status: 500, url: PULLS_URL },
    },
    {
      description: "a pull request's files",
      reason:
        "GET /repos/acme/spec/pulls/9/files?per_page=100&page=1 answered 500",
      route: {
        status: 500,
        url: `${API}/repos/acme/spec/pulls/9/files?per_page=100&page=1`,
      },
    },
    {
      description: "a candidate",
      reason: "GET /repos/acme/next-home answered 500",
      route: { status: 500, url: `${API}/repos/acme/next-home` },
    },
  ])("fails when $description fails", async ({ reason, route }) => {
    // Given - one read that fails, and one open pull request
    const routes: FakeRoute[] = [
      route,
      { body: [{ number: 9, title: "Touch the spec" }], url: PULLS_URL },
      {
        body: [],
        url: `${API}/repos/acme/spec/pulls/9/files?per_page=100&page=1`,
      },
      ...createUpstreamRoutes({
        headSha: HEAD_SHA,
        pinSha: PIN_SHA,
        version: "0.3",
      }),
    ];

    // When - reading upstream
    const answer = await read({ routes });

    // Then - that read's reason
    expect(answer).toStrictEqual({ isOk: false, reason });
  });
});

describe("findNewNotices", () => {
  test("finds only notice lines that weren't there at the pin, once each", () => {
    // Given - a file that gained a notice twice, and kept an old one
    const pinText = "# Spec\n`deprecated` is a status.\n";
    const headText =
      "# Spec\n`deprecated` is a status.\nNo longer maintained.\n No longer maintained.\nPlain line.\n";

    // When - finding the new notices
    const notices = findNewNotices({ file: "SPEC", headText, pinText });

    // Then - the new one, once
    expect(notices).toStrictEqual([
      { file: "SPEC", line: "No longer maintained." },
    ]);
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
