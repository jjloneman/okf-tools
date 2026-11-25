/*
 * A fake `fetch` and fabricated upstream state for the spec watch's tests.
 *
 * - The fake answers only the requests a test lists, and throws for any other,
 *   so a test can never reach the real network.
 *
 * - Every repo, SHA, and title here is made up.
 */
import type { SpecPin } from "../scripts/spec-watch/pin.ts";

/** A fake `fetch`, with the requests it received. */
export type FakeFetch = {
  /**
   * The `fetch` to inject.
   *
   * @example `createGitHubClient({ fetch: fake.fetch, token: "t" })`
   */
  fetch: typeof fetch;

  /**
   * Every request received, in order.
   *
   * @example `[{ method: "GET", url: "https://api.github.com/repos/a/b" }]`
   */
  requests: FakeRequest[];
};

/** One request the fake `fetch` received. */
export type FakeRequest = {
  /**
   * The request's body, when it sent a string.
   *
   * @example `'{"title":"t"}'`
   */
  body: string | undefined;

  /**
   * The request's headers, with lowercase names.
   *
   * @example `{ accept: "application/vnd.github+json" }`
   */
  headers: Record<string, string>;

  /**
   * The request method.
   *
   * @example "GET"
   */
  method: string;

  /**
   * The full URL requested.
   *
   * @example "https://api.github.com/repos/acme/spec"
   */
  url: string;
};

/** One answer the fake `fetch` gives, to the request it matches. */
export type FakeRoute = {
  /**
   * The body to answer with: a string as it is, anything else as JSON.
   *
   * @example `{ full_name: "acme/spec" }`
   */
  body?: unknown;

  /**
   * An error to throw instead of answering, as a network failure would.
   *
   * @example `new Error("socket hang up")`
   */
  error?: Error;

  /**
   * The request method it matches.
   *
   * @example "POST"
   */
  method?: "GET" | "POST";

  /**
   * The status to answer with.
   *
   * @example 404
   */
  status?: number;

  /**
   * The full URL it matches.
   *
   * @example "https://api.github.com/repos/acme/spec"
   */
  url: string;
};

/** The GitHub REST API's root, which every client path is joined to. */
export const API = "https://api.github.com";

/** The pinned commit of the fabricated spec. */
export const PIN_SHA = "1111111111111111111111111111111111111111";

/** A newer commit to the fabricated spec. */
export const HEAD_SHA = "2222222222222222222222222222222222222222";

/** A fabricated pin, as `spec/upstream.json` would hold it. */
export const PIN: SpecPin = {
  candidates: ["acme/next-home"],
  path: "okf/SPEC.md",
  repo: "acme/spec",
  sha: PIN_SHA,
  version: "0.2",
};

/** Build a fake `fetch` that answers only the given routes. */
export function createFakeFetch(routes: FakeRoute[]): FakeFetch {
  const requests: FakeRequest[] = [];

  /** Answer one request from the first route that matches it. */
  function fakeFetch(
    ...[input, init]: Parameters<typeof fetch>
  ): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";

    requests.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: Object.fromEntries(new Headers(init?.headers)),
      method,
      url,
    });

    const route = routes.find(
      (candidate) =>
        candidate.url === url && (candidate.method ?? "GET") === method
    );

    if (route === undefined) {
      return Promise.reject(new Error(`No fake route for ${method} ${url}`));
    }

    if (route.error !== undefined) {
      return Promise.reject(route.error);
    }

    const text =
      typeof route.body === "string" ? route.body : JSON.stringify(route.body);

    return Promise.resolve(new Response(text, { status: route.status ?? 200 }));
  }

  return { fetch: fakeFetch, requests };
}

/*
 * The routes that answer every read of a fabricated upstream.
 *
 * - The spec's commits are `headSha`, then `pinSha` when they differ; the spec
 *   at `headSha` reads `version`, and at `pinSha` the pin's `0.2`.
 *
 * - The READMEs never change, no pull request, release, or tag exists, the
 *   one candidate home is private, and the owner has no newer repo.
 */
export function createUpstreamRoutes({
  headSha,
  pinSha,
  version,
}: {
  /** The newest commit to the spec. */
  headSha: string;

  /** The SHA the run pins, which may be an override. */
  pinSha: string;

  /** The version line of the spec at `headSha`. */
  version: string;
}): FakeRoute[] {
  const commitShas = headSha === pinSha ? [headSha] : [headSha, pinSha];
  const specUrl = `${API}/repos/acme/spec/contents/okf/SPEC.md`;
  const folderReadmeUrl = `${API}/repos/acme/spec/readme/okf`;

  return [
    {
      body: { archived: false, full_name: "acme/spec" },
      url: `${API}/repos/acme/spec`,
    },
    {
      body: commitShas.map((sha) => ({
        commit: {
          author: { date: "2026-08-21T10:00:00Z" },
          committer: { date: "2026-08-21T10:00:00Z" },
          message: `Update the spec at ${sha.slice(0, 7)}`,
        },
        html_url: `https://github.com/acme/spec/commit/${sha}`,
        sha,
      })),
      url: `${API}/repos/acme/spec/commits?path=okf%2FSPEC.md&per_page=100`,
    },
    { body: `**Version ${version}**\n`, url: `${specUrl}?ref=${headSha}` },
    { body: "**Version 0.2**\n", url: `${specUrl}?ref=${pinSha}` },
    { body: "# Spec\n", url: `${API}/repos/acme/spec/readme` },
    { body: "# Spec\n", url: `${API}/repos/acme/spec/readme?ref=${pinSha}` },
    { body: "# Folder\n", url: folderReadmeUrl },
    { body: "# Folder\n", url: `${folderReadmeUrl}?ref=${pinSha}` },
    {
      body: [],
      url: `${API}/repos/acme/spec/releases?per_page=100&page=1`,
    },
    { body: [], url: `${API}/repos/acme/spec/tags?per_page=100&page=1` },
    {
      body: [],
      url: `${API}/users/acme/repos?sort=created&direction=desc&per_page=100`,
    },
    {
      body: [],
      url: `${API}/repos/acme/spec/pulls?state=open&per_page=100&page=1`,
    },
    { body: { private: true }, url: `${API}/repos/acme/next-home` },
  ];
}
