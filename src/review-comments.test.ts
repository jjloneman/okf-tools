import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { CheckFinding } from "./check-engine.ts";
import type { Fetch } from "./github-client.ts";
import type { Output } from "./output.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import { runReviewComments } from "./review-comments.ts";
import { wordComment } from "./review-plan.ts";

/** How the fake answers one request: a status and a body, or a throw. */
type FakeAnswer =
  | {
      /** The body, as JSON unless a string. @example `{ data: {} }` */
      body?: unknown;

      /** The HTTP status. @example 200 */
      status?: number;
    }
  | Error;

/** One request the fake `fetch` received. */
type FakeRequest = {
  /** Its JSON body, parsed. @example `{ body: "…" }` */
  body: unknown;

  /** Its method. @example "POST" */
  method: string;

  /** Its URL. @example "https://api.github.com/graphql" */
  url: string;
};

/** GitHub's REST API root. */
const API = "https://api.github.com";

/** A blob the fabricated record holds at the head. */
const BLOB = "aaaa1111";

/** A draft finding on the fabricated record. */
const DRAFT: CheckFinding = {
  code: "T001",
  line: 3,
  message:
    "the record is a draft, and human:a's sign-off at 2026-10-02T15:00:00Z no longer counts, since generated.at is later (§5.3); okf verify signs it off again",
  path: "kb/a.md",
  rule: "draft",
  severity: "info",
};

/** The pull request's answer, its head where the event says. */
const HEAD: FakeAnswer = { body: { head: { sha: "head1" } } };

/** The REST path of the fabricated pull request's comments and files. */
const PULLS = `${API}/repos/acme/kb/pulls`;

let data: string[];
let errors: string[];
let folder: string;
let infos: string[];

beforeEach(() => {
  data = [];
  errors = [];
  folder = mkdtempSync(path.join(tmpdir(), "okf-review-"));
  infos = [];
});

afterEach(() => {
  rmSync(folder, { force: true, recursive: true });
});

/**
 * Run `okf review-comments` against a fake GitHub, which answers each
 * request in turn from the list, and return the requests.
 */
async function runAgainst(params: {
  /** GitHub's answers, in the order it gets the requests. @example `[HEAD]` */
  answers: FakeAnswer[];

  /** What the drafts file holds. @example `[DRAFT]` */
  drafts?: unknown;

  /** The job's environment, over a token and repo. @example `{}` */
  env?: Record<string, string | undefined>;

  /** The event the run is for. @example `{ push: {} }` */
  event?: unknown;
}): Promise<{ code: number; requests: FakeRequest[] }> {
  const {
    answers,
    drafts = [DRAFT],
    event = { pull_request: { head: { sha: "head1" }, number: 5 } },
  } = params;
  const draftsFile = path.join(folder, "drafts.json");
  const eventFile = path.join(folder, "event.json");
  const queue = [...answers];
  const requests: FakeRequest[] = [];

  writeFileSync(draftsFile, JSON.stringify(drafts));
  writeFileSync(eventFile, JSON.stringify(event));

  const fetch: Fetch = (input, init) => {
    const body = init?.body;

    requests.push({
      body: typeof body === "string" ? (JSON.parse(body) as unknown) : body,
      method: init?.method ?? "GET",
      url: input instanceof Request ? input.url : String(input),
    });

    const answer = queue.shift() ?? { status: 500 };

    if (answer instanceof Error) {
      return Promise.reject(answer);
    }

    const { body: answerBody, status = 200 } = answer;

    return Promise.resolve(
      new Response(
        typeof answerBody === "string" || answerBody === undefined
          ? (answerBody ?? "")
          : JSON.stringify(answerBody),
        { headers: { "content-type": "application/json" }, status }
      )
    );
  };
  const output: Output = {
    data: (text) => data.push(text),
    error: (message) => errors.push(message),
    info: (message) => infos.push(message),
  };
  const code = await runReviewComments({
    draftsFile,
    env: {
      GITHUB_EVENT_PATH: eventFile,
      GITHUB_REPOSITORY: "acme/kb",
      GITHUB_TOKEN: "t",
      ...params.env,
    },
    fetch,
    output,
  });

  return { code, requests };
}

/** A review thread node, as GitHub's GraphQL API answers with it. */
function threadNode(params: {
  /** The blob its marker names. @example "aaaa1111" */
  blob?: string;

  /** Its first comment's text, when not the draft's. @example "x" */
  body?: string;

  /** Its node ID. @example "T2" */
  id?: string;

  /** Whether it's resolved. @example true */
  isResolved?: boolean;

  /** Who made its first comment. @example "github-actions" */
  login?: string;
}): unknown {
  const {
    blob = BLOB,
    body = wordComment({ blob, finding: DRAFT }),
    id = "T1",
    isResolved = false,
    login = "github-actions",
  } = params;

  return {
    comments: { nodes: [{ author: { login }, body, databaseId: 7 }] },
    id,
    isResolved,
  };
}

/** A GraphQL answer holding one page of review threads. */
function threadsPage(params: {
  /** The next page's cursor, when there is one. @example "c1" */
  cursor?: string;

  /** The page's thread nodes. @example `[threadNode({})]` */
  nodes: unknown[];
}): FakeAnswer {
  return {
    body: {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: params.nodes,
              pageInfo: {
                endCursor: params.cursor ?? null,
                hasNextPage: params.cursor !== undefined,
              },
            },
          },
        },
      },
    },
  };
}

describe("runReviewComments", () => {
  test("posts, edits and resolves, reading every page", async () => {
    // Given - two pages of threads: an old one to edit, then a gone one
    const answers: FakeAnswer[] = [
      HEAD,
      threadsPage({ cursor: "c1", nodes: [threadNode({ blob: "bbbb" })] }),
      threadsPage({
        nodes: [
          threadNode({ id: "T2" }),
          threadNode({ id: "T3", login: "someone" }),
        ],
      }),
      {
        body: [
          ...Array.from({ length: 99 }, (_, index) => ({
            filename: `x/${index}.md`,
            sha: "dddd",
          })),
          { filename: "kb/a.md", sha: "eeee" },
        ],
      },
      {
        body: [
          { filename: "kb/b.md", sha: BLOB },
          { filename: "kb/big.md", sha: null },
        ],
      },
      { body: {} },
      { body: { id: 9 } },
      { body: {} },
      { body: { data: {} } },
    ];
    const drafts = [DRAFT, { ...DRAFT, path: "kb/b.md" }];

    // When - running
    const { code, requests } = await runAgainst({ answers, drafts });

    // Then - one edit, one new comment, one release and resolve
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([]);
    expect(infos).toStrictEqual([
      "1 posted, 1 edited, 1 resolved, 0 annotated.",
    ]);
    expect(
      requests.map(({ method, url }) => `${method} ${url.replace(API, "")}`)
    ).toStrictEqual([
      "GET /repos/acme/kb/pulls/5",
      "POST /graphql",
      "POST /graphql",
      "GET /repos/acme/kb/pulls/5/files?page=1&per_page=100",
      "GET /repos/acme/kb/pulls/5/files?page=2&per_page=100",
      "PATCH /repos/acme/kb/pulls/comments/7",
      "POST /repos/acme/kb/pulls/5/comments",
      "PATCH /repos/acme/kb/pulls/comments/7",
      "POST /graphql",
    ]);
    expect(requests[2]?.body).toMatchObject({ variables: { cursor: "c1" } });
    expect(requests[6]?.body).toStrictEqual({
      body: wordComment({ blob: BLOB, finding: drafts[1] ?? DRAFT }),
      commit_id: "head1",
      path: "kb/b.md",
      subject_type: "file",
    });
    expect(requests[8]?.body).toMatchObject({ variables: { id: "T1" } });
  });

  test("reads GitHub's URLs from the environment", async () => {
    // Given - an enterprise host
    const env = {
      GITHUB_API_URL: "https://ghe.test/api/v3",
    };

    // When - running with no drafts
    const { requests } = await runAgainst({
      answers: [HEAD, threadsPage({ nodes: [] }), { body: [] }],
      drafts: [],
      env,
    });

    // Then - both hosts used
    expect(requests.map(({ url }) => url)).toStrictEqual([
      "https://ghe.test/api/v3/repos/acme/kb/pulls/5",
      "https://ghe.test/api/graphql",
      "https://ghe.test/api/v3/repos/acme/kb/pulls/5/files?page=1&per_page=100",
    ]);
  });

  test("links a draft's cited sources into the diff, on the job's server", async () => {
    // Given - a draft naming a source the pull request changes, beside an
    // entry that isn't a source, on an enterprise host
    const drafts = [
      {
        ...DRAFT,
        message:
          "the record is a draft; its source ../src/a.ts changed; okf verify signs it off",
        sources: [{ path: "src/a.ts", resource: "../src/a.ts" }, { path: 1 }],
      },
    ];
    const answers: FakeAnswer[] = [
      HEAD,
      threadsPage({ nodes: [] }),
      {
        body: [
          { filename: "kb/a.md", sha: BLOB },
          { filename: "src/a.ts", sha: "cccc" },
        ],
      },
      { body: { id: 9 } },
    ];

    // When - running
    const { requests } = await runAgainst({
      answers,
      drafts,
      env: { GITHUB_SERVER_URL: "https://ghe.test" },
    });

    // Then - the source linked by its path's SHA-256, the other dropped
    expect(requests[3]?.body).toMatchObject({
      body: expect.stringContaining(
        "> - Its source [`../src/a.ts`](https://ghe.test/acme/kb/pull/5/files#diff-072fc23b941d05af2383888f292b78e406e0e82a4a3f8ee698113dd9bcc79e5f) changed."
      ) as unknown,
    });
  });

  test("annotates a draft whose comment GitHub refuses", async () => {
    // Given - a refused comment
    const answers: FakeAnswer[] = [
      HEAD,
      threadsPage({ nodes: [] }),
      { body: [{ filename: "kb/a.md", sha: BLOB }] },
      { body: { message: "Validation Failed" }, status: 422 },
    ];

    // When - running
    const { code } = await runAgainst({ answers });

    // Then - why, and the annotation
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      `Couldn't post a review comment on kb/a.md, so it's an annotation instead: POST ${PULLS}/5/comments answered 422: Validation Failed`,
    ]);
    expect(data).toStrictEqual([
      expect.stringMatching(
        /^::notice file=kb\/a\.md,line=3,title=T001 draft::/u
      ),
    ]);
  });

  test("annotates a draft whose edit GitHub refuses", async () => {
    // Given - an open thread for an older blob, whose edit fails
    const answers: FakeAnswer[] = [
      HEAD,
      threadsPage({ nodes: [threadNode({ blob: "bbbb" })] }),
      { body: [{ filename: "kb/a.md", sha: BLOB }] },
      { status: 404 },
    ];

    // When - running
    await runAgainst({ answers });

    // Then - why, and the annotation
    expect(errors).toStrictEqual([
      `Couldn't post a review comment on kb/a.md, so it's an annotation instead: PATCH ${PULLS}/comments/7 answered 404`,
    ]);
    expect(data).toHaveLength(1);
  });

  test("annotates a draft outside the diff", async () => {
    // When - the pull request doesn't change the record
    await runAgainst({
      answers: [HEAD, threadsPage({ nodes: [] }), { body: [] }],
    });

    // Then - the annotation alone
    expect(errors).toStrictEqual([]);
    expect(data).toHaveLength(1);
    expect(infos).toStrictEqual([
      "0 posted, 0 edited, 0 resolved, 1 annotated.",
    ]);
  });

  test.each([
    {
      answers: [
        HEAD,
        threadsPage({ nodes: [threadNode({})] }),
        { body: [] },
        { status: 500 },
      ],
      description: "the edit that releases it fails",
      reason: `PATCH ${PULLS}/comments/7 answered 500`,
    },
    {
      answers: [
        HEAD,
        threadsPage({ nodes: [threadNode({})] }),
        { body: [] },
        {},
        { body: { errors: [{ message: "Resource not accessible" }] } },
      ],
      description: "GitHub refuses to resolve it",
      reason: "GraphQL mutation failed: Resource not accessible",
    },
  ])("says so when $description", async ({ answers, reason }) => {
    // When - a gone draft's thread can't be resolved
    const { code } = await runAgainst({ answers, drafts: [] });

    // Then - why, and still a pass
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      `Couldn't resolve the review thread on kb/a.md: ${reason}`,
    ]);
  });

  test.each([
    {
      answers: [HEAD, new Error("socket hang up")],
      description: "a network failure",
      reason: `POST ${API}/graphql failed: socket hang up`,
    },
    {
      answers: [HEAD, { body: { message: "Bad credentials" }, status: 401 }],
      description: "a refused query",
      reason: `POST ${API}/graphql answered 401: Bad credentials`,
    },
    {
      answers: [{ body: "<html>Bad gateway</html>", status: 502 }],
      description: "an error page that isn't JSON",
      reason: `GET ${PULLS}/5 answered 502`,
    },
    {
      answers: [{ body: { head: { sha: "head2" } } }],
      description: "a head that moved on",
      reason:
        "The pull request's head moved on from head1, so a newer run posts its drafts",
    },
    {
      answers: [
        HEAD,
        { body: { data: { repository: { pullRequest: null } } } },
      ],
      description: "an answer without the threads",
      reason: "GitHub answered without the pull request's review threads",
    },
    {
      answers: [HEAD, { body: { errors: [{}] } }],
      description: "a GraphQL error with no message",
      reason: "GraphQL query failed: an unknown error",
    },
    {
      answers: [HEAD, threadsPage({ nodes: [] }), { status: 403 }],
      description: "files it can't list",
      reason: `GET ${PULLS}/5/files?page=1&per_page=100 answered 403`,
    },
  ])("annotates every draft on $description", async ({ answers, reason }) => {
    // When - the pull request can't be read
    const { code } = await runAgainst({ answers });

    // Then - why, and the annotation
    expect(code).toBe(EXIT_CODES.ok);
    expect(errors).toStrictEqual([
      typeof reason === "string"
        ? `${reason}; each draft is an annotation instead.`
        : reason,
    ]);
    expect(data).toHaveLength(1);
  });

  test.each([
    {
      description: "no token",
      env: { GITHUB_TOKEN: undefined },
      reason:
        "GITHUB_TOKEN and GITHUB_REPOSITORY must be set; each draft is an annotation instead.",
    },
    {
      description: "no repository",
      env: { GITHUB_REPOSITORY: undefined },
      reason:
        "GITHUB_TOKEN and GITHUB_REPOSITORY must be set; each draft is an annotation instead.",
    },
    {
      description: "no event",
      env: { GITHUB_EVENT_PATH: undefined },
      reason: expect.stringMatching(
        /^Couldn't read the event at GITHUB_EVENT_PATH: .*; each draft is an annotation instead\.$/u
      ) as unknown,
    },
    {
      description: "an event for no pull request",
      env: {},
      event: { push: {} },
      reason:
        "The run isn't for a pull request; each draft is an annotation instead.",
    },
  ])("annotates every draft with $description", async (row) => {
    // When - the run can't reach the pull request
    const { requests } = await runAgainst({
      answers: [],
      env: row.env,
      event: row.event,
    });

    // Then - no request, and why
    expect(requests).toStrictEqual([]);
    expect(errors).toStrictEqual([row.reason]);
  });

  test.each([
    { description: "isn't a list", drafts: { code: "T001" } },
    { description: "holds something else", drafts: [{ code: "T001" }] },
  ])("fails on a drafts file that $description", async ({ drafts }) => {
    // When - running
    const { code, requests } = await runAgainst({ answers: [], drafts });

    // Then - a failure, and no request
    expect(code).toBe(EXIT_CODES.failure);
    expect(requests).toStrictEqual([]);
    expect(errors).toStrictEqual([
      expect.stringMatching(/isn't a list of findings/u),
    ]);
  });

  test("fails on a drafts file it can't read", async () => {
    // When - naming a file that doesn't exist
    const code = await runReviewComments({
      draftsFile: path.join(folder, "missing.json"),
      env: {},
      fetch: () => Promise.reject(new Error("unused")),
      output: {
        data: (text) => data.push(text),
        error: (message) => errors.push(message),
        info: (message) => infos.push(message),
      },
    });

    // Then - a failure saying why
    expect(code).toBe(EXIT_CODES.failure);
    expect(errors).toStrictEqual([
      expect.stringMatching(/^Couldn't read .*missing\.json: /u),
    ]);
  });
});
