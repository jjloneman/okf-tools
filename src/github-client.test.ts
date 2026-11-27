import { describe, expect, test } from "vitest";

import type { Fetch, GitHubClient } from "./github-client.ts";

import { createGitHubClient } from "./github-client.ts";

/** How the fake answers one request: a status and a body, or a throw. */
type FakeAnswer =
  | {
      /**
       * The body: a string as it is, anything else as JSON.
       *
       * @example `{ head: { sha: "head1" } }`
       */
      body?: unknown;

      /** The HTTP status. @example 404 */
      status?: number;
    }
  | Error;

/** One request the fake `fetch` received. */
type FakeRequest = {
  /** Its JSON body, parsed, or nothing for a `GET`. @example `{ body: "…" }` */
  body: unknown;

  /**
   * Its method and URL.
   *
   * @example "GET https://api.github.com/repos/acme/kb/pulls/5"
   */
  line: string;
};

/** Build a client on pull request 5 of `acme/kb`, against a fake GitHub. */
function fakeClient(answers: FakeAnswer[]): {
  client: GitHubClient;
  requests: FakeRequest[];
} {
  const queue = [...answers];
  const requests: FakeRequest[] = [];
  const fetch: Fetch = (input, init) => {
    const body = init?.body;

    requests.push({
      body: typeof body === "string" ? (JSON.parse(body) as unknown) : body,
      line: `${init?.method ?? "GET"} ${input instanceof Request ? input.url : String(input)}`,
    });

    const answer = queue.shift() ?? {};

    if (answer instanceof Error) {
      return Promise.reject(answer);
    }

    const { body: answerBody = {}, status = 200 } = answer;

    return Promise.resolve(
      new Response(
        typeof answerBody === "string"
          ? answerBody
          : JSON.stringify(answerBody),
        { headers: { "content-type": "application/json" }, status }
      )
    );
  };

  return {
    client: createGitHubClient({
      apiUrl: "https://api.github.com",
      commitId: "head1",
      fetch,
      number: 5,
      owner: "acme",
      repo: "kb",
      token: "t",
    }),
    requests,
  };
}

describe("createGitHubClient", () => {
  test("posts a file-level comment on the head commit", async () => {
    // Given - a client
    const { client, requests } = fakeClient([{ status: 201 }]);

    // When - posting
    const outcome = await client.createFileComment({
      body: "hi",
      path: "kb/a.md",
    });

    // Then - one POST naming the file and the head
    expect(outcome).toStrictEqual({ isOk: true, value: undefined });
    expect(requests).toStrictEqual([
      {
        body: {
          body: "hi",
          commit_id: "head1",
          path: "kb/a.md",
          subject_type: "file",
        },
        line: "POST https://api.github.com/repos/acme/kb/pulls/5/comments",
      },
    ]);
  });

  test("edits a comment and resolves a thread", async () => {
    // Given - a client
    const { client, requests } = fakeClient([{}, { body: { data: {} } }]);

    // When - editing, then resolving
    await client.updateComment({ body: "new", commentId: 7 });
    await client.resolveThread("T1");

    // Then - a PATCH, then the mutation with the thread's ID
    expect(requests.map(({ line }) => line)).toStrictEqual([
      "PATCH https://api.github.com/repos/acme/kb/pulls/comments/7",
      "POST https://api.github.com/graphql",
    ]);
    expect(requests[1]?.body).toMatchObject({ variables: { id: "T1" } });
  });

  test("reads the head, and every page of files, skipping one with no blob", async () => {
    // Given - a full page of files, then a short one
    const { client, requests } = fakeClient([
      { body: { head: { sha: "head2" } } },
      {
        body: Array.from({ length: 100 }, (_, index) => ({
          filename: `x/${index}.md`,
          sha: "dddd",
        })),
      },
      { body: [{ filename: "kb/big.md", sha: null }] },
    ]);

    // When - reading both
    const head = await client.readHeadSha();
    const files = await client.listFiles();

    // Then - the head, a hundred files, and two pages read
    expect(head).toStrictEqual({ isOk: true, value: "head2" });
    expect(files.isOk && files.value.size).toBe(100);
    expect(requests.map(({ line }) => line).slice(1)).toStrictEqual([
      "GET https://api.github.com/repos/acme/kb/pulls/5/files?page=1&per_page=100",
      "GET https://api.github.com/repos/acme/kb/pulls/5/files?page=2&per_page=100",
    ]);
  });

  test("reads every page of review threads", async () => {
    // Given - two pages
    const page = (nodes: unknown[], cursor?: string): FakeAnswer => ({
      body: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes,
                pageInfo: {
                  endCursor: cursor ?? null,
                  hasNextPage: cursor !== undefined,
                },
              },
            },
          },
        },
      },
    });
    const { client, requests } = fakeClient([
      page([{ id: "T1" }], "c1"),
      page([{ id: "T2" }]),
    ]);

    // When - reading them
    const threads = await client.readReviewThreads();

    // Then - both nodes, the second page read from the cursor
    expect(threads).toStrictEqual({
      isOk: true,
      value: [{ id: "T1" }, { id: "T2" }],
    });
    expect(requests[1]?.body).toMatchObject({ variables: { cursor: "c1" } });
  });

  test.each([
    {
      answers: [{ body: { message: "Not Found" }, status: 404 }],
      call: (client: GitHubClient) => client.readHeadSha(),
      description: "a refused request, with GitHub's message",
      reason:
        "GET https://api.github.com/repos/acme/kb/pulls/5 answered 404: Not Found",
    },
    {
      answers: [{ body: "<html>Bad gateway</html>", status: 502 }],
      call: (client: GitHubClient) => client.readHeadSha(),
      description: "an error page that isn't JSON",
      reason: "GET https://api.github.com/repos/acme/kb/pulls/5 answered 502",
    },
    {
      answers: [new Error("socket hang up")],
      call: (client: GitHubClient) => client.readHeadSha(),
      description: "a network failure",
      reason:
        "GET https://api.github.com/repos/acme/kb/pulls/5 failed: socket hang up",
    },
    {
      answers: [{ body: { errors: [{ message: "Bad" }, {}] } }],
      call: (client: GitHubClient) => client.readReviewThreads(),
      description: "a failed query",
      reason: "GraphQL query failed: Bad; an unknown error",
    },
    {
      answers: [{ body: { errors: [{ message: "Resource not accessible" }] } }],
      call: (client: GitHubClient) => client.resolveThread("T1"),
      description: "a failed mutation",
      reason: "GraphQL mutation failed: Resource not accessible",
    },
    {
      answers: [{ body: { data: { repository: { pullRequest: null } } } }],
      call: (client: GitHubClient) => client.readReviewThreads(),
      description: "an answer without the threads",
      reason: "GitHub answered without the pull request's review threads",
    },
  ])("says why on $description", async ({ answers, call, reason }) => {
    // When - the call fails
    const { client } = fakeClient(answers);

    // Then - the reason
    expect(await call(client)).toStrictEqual({ isOk: false, reason });
  });
});
