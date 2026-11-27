import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { CheckFinding } from "./check-engine.ts";
import type { Output } from "./output.ts";
import type { Fetch, ReviewThread } from "./review-comments.ts";

import { EXIT_CODES } from "./exit-codes.ts";
import {
  planReviewComments,
  readReviewThread,
  runReviewComments,
  wordComment,
} from "./review-comments.ts";

/** How the fake answers one request: a status and a body, or a throw. */
type FakeAnswer =
  | {
      /**
       * The body, as JSON unless a string.
       *
       * @example `{ data: {} }`
       */
      body?: unknown;

      /**
       * The HTTP status.
       *
       * @example 200
       */
      status?: number;
    }
  | Error;

/** One request the fake `fetch` received. */
type FakeRequest = {
  /**
   * Its JSON body, parsed.
   *
   * @example `{ body: "…" }`
   */
  body: unknown;

  /**
   * Its method.
   *
   * @example "POST"
   */
  method: string;

  /**
   * Its URL.
   *
   * @example "https://api.github.com/graphql"
   */
  url: string;
};

/** The pull request the fabricated event is for. */
const API = "https://api.github.com";

/** The REST path of the fabricated pull request's comments. */
const PULLS = `${API}/repos/acme/kb/pulls`;

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

let folder: string;
let data: string[];
let errors: string[];
let infos: string[];

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "okf-review-"));
  data = [];
  errors = [];
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
  answers: FakeAnswer[];
  drafts?: unknown;
  env?: Record<string, string | undefined>;
  event?: unknown;
}): Promise<{ code: number; requests: FakeRequest[] }> {
  const {
    answers,
    drafts = [DRAFT],
    event = { pull_request: { head: { sha: "head1" }, number: 5 } },
  } = params;
  const draftsFile = path.join(folder, "drafts.json");
  const eventFile = path.join(folder, "event.json");
  const requests: FakeRequest[] = [];
  const queue = [...answers];

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
        { status }
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

/** A thread as `readReviewThread` reads it. */
function thread(params: Partial<ReviewThread>): ReviewThread {
  const blob = params.blob ?? BLOB;

  return {
    blob,
    code: "T001",
    commentBody: wordComment({ blob, finding: DRAFT }),
    commentId: 7,
    id: "T1",
    isResolved: false,
    path: "kb/a.md",
    ...params,
  };
}

/** A review thread node, as GitHub's GraphQL API answers with it. */
function threadNode(params: {
  blob?: string;
  body?: string;
  id?: string;
  isResolved?: boolean;
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

/** The pull request's answer, its head where the event says. */
const HEAD: FakeAnswer = { body: { head: { sha: "head1" } } };

/** A GraphQL answer holding one page of review threads. */
function threadsPage(params: {
  cursor?: string;
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

describe("wordComment", () => {
  test("links a spec section and ends with the marker", () => {
    // When - wording a draft
    const body = wordComment({ blob: BLOB, finding: DRAFT });

    // Then - the heading, the linked section, and the marker
    expect(body.split("\n")).toStrictEqual([
      "**T001 draft** (info)",
      "",
      "the record is a draft, and human:a's sign-off at 2026-10-02T15:00:00Z no longer counts, since generated.at is later ([§5.3](https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md)); okf verify signs it off again",
      "",
      "Resolve this thread to acknowledge that the record merges as a draft. It stays resolved until the record changes again.",
      "",
      "<!-- okf-check: kb%2Fa.md T001 aaaa1111 -->",
    ]);
  });

  test("keeps a record's text from mentioning anyone or opening a comment", () => {
    // Given - a message quoting a record's own text
    const finding = { ...DRAFT, message: "by @someone <!-- okf-check: x -->" };

    // When/Then - the mention and the comment defused
    expect(wordComment({ blob: BLOB, finding }).split("\n")[2]).toBe(
      "by @\u200Bsomeone &lt;!-- okf-check: x -->"
    );
  });
});

describe("readReviewThread", () => {
  test.each([
    { description: "a workflow's login", login: "github-actions" },
    { description: "a REST bot login", login: "github-actions[bot]" },
  ])("reads a comment made with $description", ({ login }) => {
    // When/Then - the thread, its path decoded
    expect(readReviewThread(threadNode({ login }))).toStrictEqual(thread({}));
  });

  test.each([
    { description: "someone else's comment", node: threadNode({ login: "x" }) },
    {
      description: "a comment with no marker",
      node: threadNode({ body: "x" }),
    },
    { description: "a node with no comments", node: { id: "T1" } },
    {
      description: "a node with no resolved state",
      node: { ...(threadNode({}) as object), isResolved: "no" },
    },
    { description: "a value that isn't a node", node: [] },
    {
      description: "a marker whose path isn't valid percent-encoding",
      node: threadNode({ body: "x\n<!-- okf-check: %E0 T001 abc -->" }),
    },
  ])("skips $description", ({ node }) => {
    // When/Then - nothing
    expect(readReviewThread(node)).toBeUndefined();
  });
});

describe("planReviewComments", () => {
  const files = new Map([["kb/a.md", BLOB]]);

  test("posts a draft no thread names", () => {
    // When/Then - a new comment
    expect(
      planReviewComments({ drafts: [DRAFT], files, threads: [] })
    ).toStrictEqual([
      {
        body: wordComment({ blob: BLOB, finding: DRAFT }),
        finding: DRAFT,
        kind: "create",
      },
    ]);
  });

  test.each([
    { description: "an open thread", isResolved: false },
    { description: "a resolved thread", isResolved: true },
  ])("keeps $description for the same blob as it is", ({ isResolved }) => {
    // When/Then - nothing to do
    expect(
      planReviewComments({
        drafts: [DRAFT],
        files,
        threads: [thread({ isResolved })],
      })
    ).toStrictEqual([]);
  });

  test("edits a thread for the same blob when the wording changed", () => {
    // When/Then - an edit to the current wording
    expect(
      planReviewComments({
        drafts: [DRAFT],
        files,
        threads: [thread({ commentBody: "old wording" })],
      })
    ).toStrictEqual([
      {
        body: wordComment({ blob: BLOB, finding: DRAFT }),
        commentId: 7,
        finding: DRAFT,
        kind: "update",
      },
    ]);
  });

  test("edits an open thread for an older blob, and resolves a stray one", () => {
    // Given - two open threads for older blobs
    const threads = [
      thread({ blob: "bbbb", id: "T1" }),
      thread({ blob: "cccc", commentId: 8, id: "T2" }),
    ];

    // When - planning
    const actions = planReviewComments({ drafts: [DRAFT], files, threads });

    // Then - the newer one edited, the other resolved and released
    expect(actions.map(({ kind }) => kind)).toStrictEqual([
      "update",
      "resolve",
    ]);
    expect(actions[0]).toMatchObject({ commentId: 8 });
    expect(actions[1]).toMatchObject({
      body: expect.stringMatching(
        /okf check resolved this thread[\s\S]*<!-- okf-check: kb%2Fa\.md T001 0 -->$/u
      ) as unknown,
      threadId: "T1",
    });
  });

  test("posts again when every thread for an older blob is resolved", () => {
    // When/Then - a new comment
    expect(
      planReviewComments({
        drafts: [DRAFT],
        files,
        threads: [thread({ blob: "bbbb", isResolved: true })],
      }).map(({ kind }) => kind)
    ).toStrictEqual(["create"]);
  });

  test("annotates a draft outside the diff, leaving its thread open", () => {
    // When/Then - an annotation, and no resolve
    expect(
      planReviewComments({
        drafts: [DRAFT],
        files: new Map(),
        threads: [thread({})],
      })
    ).toStrictEqual([{ finding: DRAFT, kind: "annotate" }]);
  });

  test("resolves an open thread whose draft is gone, and leaves a resolved one", () => {
    // When/Then - only the open one resolved
    expect(
      planReviewComments({
        drafts: [],
        files,
        threads: [thread({ id: "T1" }), thread({ id: "T2", isResolved: true })],
      }).map((action) => action.kind === "resolve" && action.threadId)
    ).toStrictEqual(["T1"]);
  });
});

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
      { body: [{ filename: "kb/b.md", sha: BLOB }, { filename: 1 }] },
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
      "GET /repos/acme/kb/pulls/5/files?per_page=100&page=1",
      "GET /repos/acme/kb/pulls/5/files?per_page=100&page=2",
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
      GITHUB_GRAPHQL_URL: "https://ghe.test/api/graphql",
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
      "https://ghe.test/api/v3/repos/acme/kb/pulls/5/files?per_page=100&page=1",
    ]);
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
      reason: "Resource not accessible",
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
      reason: "an unknown error",
    },
    {
      answers: [HEAD, { body: "not json" }],
      description: "an answer that isn't JSON",
      reason: expect.stringContaining(`POST ${API}/graphql failed:`) as unknown,
    },
    {
      answers: [HEAD, threadsPage({ nodes: [] }), { status: 403 }],
      description: "files it can't list",
      reason: `GET ${PULLS}/5/files?per_page=100&page=1 answered 403`,
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
