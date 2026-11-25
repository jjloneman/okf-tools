import { describe, expect, test } from "vitest";

import type { FakeRoute } from "#test/spec-watch";

import { API, createFakeFetch } from "#test/spec-watch";

import { createGitHubClient, encodePath } from "./github.ts";

/** A fabricated token. */
const TOKEN = "fake-token";

/** A client over a fake `fetch` that answers only the given routes. */
function createClient(routes: FakeRoute[]): {
  client: ReturnType<typeof createGitHubClient>;
  fake: ReturnType<typeof createFakeFetch>;
} {
  const fake = createFakeFetch(routes);

  return {
    client: createGitHubClient({ fetch: fake.fetch, token: TOKEN }),
    fake,
  };
}

/** The items of one page of a list, numbered from `start`. */
function makePage({
  count,
  start,
}: {
  /** How many items the page holds. */
  count: number;

  /** The first item's number. */
  start: number;
}): { number: number }[] {
  return Array.from({ length: count }, (_, index) => ({
    number: start + index,
  }));
}

describe("createGitHubClient", () => {
  describe("getJson", () => {
    test("reads a JSON resource with the token and API headers", async () => {
      // Given - a repo that answers
      const { client, fake } = createClient([
        { body: { full_name: "acme/spec" }, url: `${API}/repos/acme/spec` },
      ]);

      // When - reading it
      const answer = await client.getJson("/repos/acme/spec");

      // Then - the parsed body, asked for with the API's headers
      expect(answer).toStrictEqual({
        isOk: true,
        json: { full_name: "acme/spec" },
      });
      expect(fake.requests).toStrictEqual([
        {
          body: undefined,
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${TOKEN}`,
            "user-agent": "okf-tools-spec-watch",
            "x-github-api-version": "2022-11-28",
          },
          method: "GET",
          url: `${API}/repos/acme/spec`,
        },
      ]);
    });

    test("answers undefined for a 404", async () => {
      // Given - a repo that doesn't exist
      const { client } = createClient([
        {
          body: { message: "Not Found" },
          status: 404,
          url: `${API}/repos/acme/gone`,
        },
      ]);

      // When - reading it
      const answer = await client.getJson("/repos/acme/gone");

      // Then - an answer with nothing in it
      expect(answer).toStrictEqual({ isOk: true, json: undefined });
    });

    test.each([
      {
        description: "an unexpected status",
        reason: "GET /repos/acme/spec answered 500",
        route: { body: "oops", status: 500, url: `${API}/repos/acme/spec` },
      },
      {
        description: "a body that isn't JSON",
        reason: expect.stringMatching(
          /^GET \/repos\/acme\/spec answered with invalid JSON: /u
        ) as unknown,
        route: { body: "<html>", url: `${API}/repos/acme/spec` },
      },
      {
        description: "a network failure",
        reason: "GET /repos/acme/spec failed: socket hang up",
        route: {
          error: new Error("socket hang up"),
          url: `${API}/repos/acme/spec`,
        },
      },
    ])("fails on $description", async ({ reason, route }) => {
      // Given - a repo that answers badly
      const { client } = createClient([route]);

      // When - reading it
      const answer = await client.getJson("/repos/acme/spec");

      // Then - the reason
      expect(answer).toStrictEqual({ isOk: false, reason });
    });
  });

  describe("getText", () => {
    test("reads a file's raw text", async () => {
      // Given - a file that answers
      const { client, fake } = createClient([
        { body: "**Version 0.2**", url: `${API}/repos/acme/spec/readme` },
      ]);

      // When - reading it
      const answer = await client.getText("/repos/acme/spec/readme");

      // Then - the text, asked for raw
      expect(answer).toStrictEqual({ isOk: true, text: "**Version 0.2**" });
      expect(fake.requests[0]?.headers.accept).toBe(
        "application/vnd.github.raw"
      );
    });

    test("answers undefined for a 404", async () => {
      // Given - a file that doesn't exist
      const { client } = createClient([
        { status: 404, url: `${API}/repos/acme/spec/readme` },
      ]);

      // When - reading it
      const answer = await client.getText("/repos/acme/spec/readme");

      // Then - an answer with no text
      expect(answer).toStrictEqual({ isOk: true, text: undefined });
    });

    test.each([
      {
        description: "an unexpected status",
        reason: "GET /repos/acme/spec/readme answered 502",
        route: { status: 502, url: `${API}/repos/acme/spec/readme` },
      },
      {
        description: "a network failure",
        reason: "GET /repos/acme/spec/readme failed: socket hang up",
        route: {
          error: new Error("socket hang up"),
          url: `${API}/repos/acme/spec/readme`,
        },
      },
    ])("fails on $description", async ({ reason, route }) => {
      // Given - a file that answers badly
      const { client } = createClient([route]);

      // When - reading it
      const answer = await client.getText("/repos/acme/spec/readme");

      // Then - the reason
      expect(answer).toStrictEqual({ isOk: false, reason });
    });
  });

  describe("listAll", () => {
    test("appends the page to a path with a query, and stops at a short page", async () => {
      // Given - one short page
      const { client, fake } = createClient([
        {
          body: makePage({ count: 2, start: 1 }),
          url: `${API}/repos/acme/spec/pulls?state=open&per_page=100&page=1`,
        },
      ]);

      // When - listing it
      const answer = await client.listAll("/repos/acme/spec/pulls?state=open");

      // Then - its items, from one request
      expect(answer).toStrictEqual({
        isOk: true,
        items: makePage({ count: 2, start: 1 }),
      });
      expect(fake.requests).toHaveLength(1);
    });

    test("starts a query on a path without one, and reads every full page", async () => {
      // Given - a full page, then a short one
      const { client } = createClient([
        {
          body: makePage({ count: 100, start: 1 }),
          url: `${API}/repos/acme/spec/pulls/4/files?per_page=100&page=1`,
        },
        {
          body: makePage({ count: 1, start: 101 }),
          url: `${API}/repos/acme/spec/pulls/4/files?per_page=100&page=2`,
        },
      ]);

      // When - listing it
      const answer = await client.listAll("/repos/acme/spec/pulls/4/files");

      // Then - the items of both pages, in order
      expect(answer).toStrictEqual({
        isOk: true,
        items: makePage({ count: 101, start: 1 }),
      });
    });

    test("fails when every one of thirty-one pages is full", async () => {
      // Given - more full pages than the cap
      const routes = Array.from({ length: 31 }, (_, index) => ({
        body: makePage({ count: 100, start: index * 100 + 1 }),
        url: `${API}/repos/acme/spec/issues?per_page=100&page=${index + 1}`,
      }));
      const { client, fake } = createClient(routes);

      // When - listing it
      const answer = await client.listAll("/repos/acme/spec/issues");

      // Then - a failure rather than a partial list, after 31 requests
      expect(answer).toStrictEqual({
        isOk: false,
        reason: "GET /repos/acme/spec/issues has more than 31 pages",
      });
      expect(fake.requests).toHaveLength(31);
    });

    test("returns every item when the thirty-first page is short", async () => {
      // Given - thirty full pages, then a short one
      const routes = Array.from({ length: 31 }, (_, index) => ({
        body: makePage({
          count: index === 30 ? 5 : 100,
          start: index * 100 + 1,
        }),
        url: `${API}/repos/acme/spec/issues?per_page=100&page=${index + 1}`,
      }));
      const { client } = createClient(routes);

      // When - listing it
      const answer = await client.listAll("/repos/acme/spec/issues");

      // Then - all the items
      expect(answer).toStrictEqual({
        isOk: true,
        items: makePage({ count: 3005, start: 1 }),
      });
    });

    test("fails when a page fails", async () => {
      // Given - a page that answers 500
      const { client } = createClient([
        {
          status: 500,
          url: `${API}/repos/acme/spec/issues?per_page=100&page=1`,
        },
      ]);

      // When - listing it
      const answer = await client.listAll("/repos/acme/spec/issues");

      // Then - the page's reason
      expect(answer).toStrictEqual({
        isOk: false,
        reason: "GET /repos/acme/spec/issues?per_page=100&page=1 answered 500",
      });
    });

    test("fails when a page isn't a list", async () => {
      // Given - a page that answers 404, which reads as nothing
      const { client } = createClient([
        {
          status: 404,
          url: `${API}/repos/acme/spec/issues?per_page=100&page=1`,
        },
      ]);

      // When - listing it
      const answer = await client.listAll("/repos/acme/spec/issues");

      // Then - a reason naming the page
      expect(answer).toStrictEqual({
        isOk: false,
        reason:
          "GET /repos/acme/spec/issues?per_page=100&page=1 didn't answer with a list",
      });
    });
  });

  describe("postJson", () => {
    test("sends the body as JSON and reads the answer", async () => {
      // Given - an issue list that accepts a post
      const { client, fake } = createClient([
        {
          body: { number: 7 },
          method: "POST",
          status: 201,
          url: `${API}/repos/acme/tools/issues`,
        },
      ]);

      // When - posting an issue
      const answer = await client.postJson({
        body: { title: "t" },
        path: "/repos/acme/tools/issues",
      });

      // Then - the answer, and the body sent as JSON
      expect(answer).toStrictEqual({ isOk: true, json: { number: 7 } });
      expect(fake.requests[0]).toMatchObject({
        body: '{"title":"t"}',
        method: "POST",
      });
    });

    test.each([
      {
        description: "a 404, which a post never treats as an answer",
        reason: "POST /repos/acme/tools/issues answered 404",
        route: {
          method: "POST" as const,
          status: 404,
          url: `${API}/repos/acme/tools/issues`,
        },
      },
      {
        description: "an unexpected status",
        reason: "POST /repos/acme/tools/issues answered 422",
        route: {
          method: "POST" as const,
          status: 422,
          url: `${API}/repos/acme/tools/issues`,
        },
      },
      {
        description: "a network failure",
        reason: "POST /repos/acme/tools/issues failed: socket hang up",
        route: {
          error: new Error("socket hang up"),
          method: "POST" as const,
          url: `${API}/repos/acme/tools/issues`,
        },
      },
    ])("fails on $description", async ({ reason, route }) => {
      // Given - an issue list that answers badly
      const { client } = createClient([route]);

      // When - posting an issue
      const answer = await client.postJson({
        body: { title: "t" },
        path: "/repos/acme/tools/issues",
      });

      // Then - the reason
      expect(answer).toStrictEqual({ isOk: false, reason });
    });
  });
});

describe("encodePath", () => {
  test("encodes each segment and keeps the slashes", () => {
    // Given - a path with characters a URL can't hold
    const filePath = "okf/the spec#1.md";

    // When - encoding it
    const encoded = encodePath(filePath);

    // Then - each segment encoded
    expect(encoded).toBe("okf/the%20spec%231.md");
  });
});
