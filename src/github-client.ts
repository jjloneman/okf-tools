/*
 * The GitHub calls `okf review-comments` makes, over `@octokit/core`.
 *
 * - Every call returns an `Outcome`: Octokit throws on an error status or
 *   a GraphQL error, and each throw becomes a reason.
 *
 * - REST answers are typed by Octokit from the endpoint; GraphQL answers
 *   aren't, so `readThreadsPage` narrows each field it reads.
 */
import { Octokit } from "@octokit/core";

import type { Outcome } from "./outcome.ts";

import { readArray, readPath } from "./json.ts";
import { describeError } from "./output.ts";

/** The `fetch` the client calls GitHub with, injected so tests can answer. */
export type Fetch = typeof globalThis.fetch;

/** The calls `okf review-comments` makes on one pull request. */
export type GitHubClient = {
  /**
   * Post a file-level review comment on the pull request's head.
   *
   * @example `client.createFileComment({ body: "…", path: "docs/a.md" })`
   */
  createFileComment: (comment: NewComment) => Promise<Outcome<void>>;

  /** List each changed file's blob. @example `client.listFiles()` */
  listFiles: () => Promise<Outcome<Map<string, string>>>;

  /** Read the pull request's head commit. @example `client.readHeadSha()` */
  readHeadSha: () => Promise<Outcome<string>>;

  /**
   * Read every review thread's first comment, a page at a time.
   *
   * @example `client.readReviewThreads()`
   */
  readReviewThreads: () => Promise<Outcome<unknown[]>>;

  /**
   * Resolve a review thread by its GraphQL node ID.
   *
   * @example `client.resolveThread("PRRT_kwDO…")`
   */
  resolveThread: (threadId: string) => Promise<Outcome<void>>;

  /**
   * Replace a review comment's text.
   *
   * @example `client.updateComment({ body: "…", commentId: 7 })`
   */
  updateComment: (edit: CommentEdit) => Promise<Outcome<void>>;
};

/** Which pull request the client works on, and how it reaches GitHub. */
export type GitHubTarget = {
  /** The REST API's root. @example "https://api.github.com" */
  apiUrl: string;

  /** The head commit a new comment is made on. @example "4c2a9f0e8b1d" */
  commitId: string;

  /** The `fetch` to call. @example `globalThis.fetch` */
  fetch: Fetch;

  /** The pull request's number. @example 147 */
  number: number;

  /** The repo's owner. @example "jjloneman" */
  owner: string;

  /** The repo's name. @example "okf-tools" */
  repo: string;

  /** The job's token. @example "ghs_…" */
  token: string;
};

/** A comment's new text. */
type CommentEdit = {
  /** The comment's new text. @example "**📝 `T001` draft** · info" */
  body: string;

  /** The comment's REST ID. @example 7 */
  commentId: number;
};

/** A new comment on one file. */
type NewComment = {
  /** The comment's text. @example "**📝 `T001` draft** · info" */
  body: string;

  /** The file it's on, from the repo root. @example "docs/a.md" */
  path: string;
};

/** What every call needs: the client, and the pull request it's on. */
type Session = {
  /** The Octokit client, holding the token. @example `new Octokit(…)` */
  octokit: Octokit;

  /** The pull request. @example `{ number: 147, owner: "jjloneman", … }` */
  target: GitHubTarget;
};

/** GitHub lists at most 3,000 files of a pull request: 30 pages. */
const MAX_FILE_PAGES = 30;

/** The page size GitHub's lists take at most. */
const PAGE_SIZE = 100;

/** The mutation that resolves a review thread. */
const RESOLVE_MUTATION = /* GraphQL */ `
  mutation ($id: ID!) {
    resolveReviewThread(input: { threadId: $id }) {
      thread {
        id
      }
    }
  }
`;

/** The query for a page of a pull request's review threads. */
const THREADS_QUERY = /* GraphQL */ `
  query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo {
            endCursor
            hasNextPage
          }
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes {
                author {
                  login
                }
                body
                databaseId
              }
            }
          }
        }
      }
    }
  }
`;

/** One page of review threads. */
type ThreadsPage = {
  /** The next page's cursor, or `null` on the last. @example "Y3Vyc29y" */
  next: null | string;

  /** The page's thread nodes, unread. @example `[{ id: "PRRT_kwDO…" }]` */
  nodes: unknown[];
};

/** Build the client for one pull request. */
export function createGitHubClient(target: GitHubTarget): GitHubClient {
  const { apiUrl, fetch, token } = target;
  const session: Session = {
    octokit: new Octokit({ auth: token, baseUrl: apiUrl, request: { fetch } }),
    target,
  };

  return {
    createFileComment: (comment) =>
      attempt(() => createFileComment({ comment, session })),
    listFiles: () => attempt(() => listFiles(session)),
    readHeadSha: () => attempt(() => readHeadSha(session)),
    readReviewThreads: () => attempt(() => readReviewThreads(session)),
    resolveThread: (threadId) =>
      attempt(() => resolveThread({ session, threadId })),
    updateComment: (edit) => attempt(() => updateComment({ edit, session })),
  };
}

/** Run a call, turning whatever it throws into a reason. */
async function attempt<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { isOk: true, value: await call() };
  } catch (error) {
    return { isOk: false, reason: describeGitHubError(error) };
  }
}

/** Post a file-level comment on the pull request's head. */
async function createFileComment(params: {
  /** The comment to post. @example `{ body: "…", path: "docs/a.md" }` */
  comment: NewComment;

  /** The client and pull request. @example `{ octokit, target }` */
  session: Session;
}): Promise<void> {
  const { comment, session } = params;
  const { commitId, number, owner, repo } = session.target;

  await session.octokit.request(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
    {
      body: comment.body,
      commit_id: commitId,
      owner,
      path: comment.path,
      pull_number: number,
      repo,
      subject_type: "file",
    }
  );
}

/**
 * Say why a GitHub call failed, from the fields Octokit's errors carry.
 *
 * - A GraphQL error lists GitHub's messages, after whether a query or a
 *   mutation failed.
 *
 * - A REST error names the request and its status, and GitHub's message
 *   when the body is JSON; one with no answer at all, as a network failure
 *   throws, names the request and why.
 */
function describeGitHubError(error: unknown): string {
  const errors = readPath({ keys: ["errors"], value: error });

  if (Array.isArray(errors)) {
    return describeGraphqlError({ error, errors: readArray(errors) });
  }

  const method = readPath({ keys: ["request", "method"], value: error });
  const url = readPath({ keys: ["request", "url"], value: error });

  if (typeof method !== "string" || typeof url !== "string") {
    return describeError(error);
  }

  if (readPath({ keys: ["response"], value: error }) === undefined) {
    return `${method} ${url} failed: ${describeError(error)}`;
  }

  const message = readPath({
    keys: ["response", "data", "message"],
    value: error,
  });
  const status = String(readPath({ keys: ["status"], value: error }));
  const detail = typeof message === "string" ? `: ${message}` : "";

  return `${method} ${url} answered ${status}${detail}`;
}

/**
 * Say why a GraphQL call failed: a query or a mutation, by the request's
 * first word, then each of GitHub's messages.
 */
function describeGraphqlError(params: {
  /** Octokit's error, which keeps the request. @example `new Error("…")` */
  error: unknown;

  /** GitHub's errors. @example `[{ message: "Resource not accessible" }]` */
  errors: readonly unknown[];
}): string {
  const { error, errors } = params;
  const messages = errors.map((item) => {
    const message = readPath({ keys: ["message"], value: item });

    return typeof message === "string" ? message : "an unknown error";
  });
  const query = readPath({ keys: ["request", "query"], value: error });
  const isMutation =
    typeof query === "string" && query.trimStart().startsWith("mutation");
  const kind = isMutation ? "mutation" : "query";

  return `GraphQL ${kind} failed: ${messages.join("; ")}`;
}

/**
 * List each file the pull request changes, with its blob at the head.
 *
 * - GitHub gives no blob for a file it can't diff, such as one too large;
 *   no comment can be made on it either, so it's left out.
 */
async function listFiles(session: Session): Promise<Map<string, string>> {
  const { number, owner, repo } = session.target;
  const files = new Map<string, string>();

  for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
    const { data } = await session.octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
      { owner, page, per_page: PAGE_SIZE, pull_number: number, repo }
    );

    for (const { filename, sha } of data) {
      if (typeof sha === "string") {
        files.set(filename, sha);
      }
    }

    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  return files;
}

/** Read the pull request's head commit now. */
async function readHeadSha(session: Session): Promise<string> {
  const { number, owner, repo } = session.target;
  const { data } = await session.octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    { owner, pull_number: number, repo }
  );

  return data.head.sha;
}

/** Read every review thread's first comment, a page at a time. */
async function readReviewThreads(session: Session): Promise<unknown[]> {
  const nodes: unknown[] = [];
  let cursor: null | string = null;

  do {
    const page = await readThreadsPage({ cursor, session });

    nodes.push(...page.nodes);
    cursor = page.next;
  } while (cursor !== null);

  return nodes;
}

/**
 * Read one page of review threads, and the cursor of the next, if any.
 *
 * - An answer without the threads, such as a pull request that isn't
 *   there, would read as none and post every draft again, so it throws.
 */
async function readThreadsPage(params: {
  /** Where the page starts, or `null` for the first. @example "Y3Vyc29y" */
  cursor: null | string;

  /** The client and pull request. @example `{ octokit, target }` */
  session: Session;
}): Promise<ThreadsPage> {
  const { cursor, session } = params;
  const { number, owner, repo } = session.target;
  const answer = await session.octokit.graphql<unknown>(THREADS_QUERY, {
    cursor,
    number,
    owner,
    repo,
  });
  const page = readPath({
    keys: ["repository", "pullRequest", "reviewThreads"],
    value: answer,
  });
  const nodes = readPath({ keys: ["nodes"], value: page });

  if (!Array.isArray(nodes)) {
    throw new TypeError(
      "GitHub answered without the pull request's review threads"
    );
  }

  const endCursor = readPath({ keys: ["pageInfo", "endCursor"], value: page });
  const hasNextPage = readPath({
    keys: ["pageInfo", "hasNextPage"],
    value: page,
  });

  return {
    next:
      hasNextPage === true && typeof endCursor === "string" ? endCursor : null,
    nodes: readArray(nodes),
  };
}

/** Resolve a review thread by its GraphQL node ID. */
async function resolveThread(params: {
  /** The client and pull request. @example `{ octokit, target }` */
  session: Session;

  /** The thread's node ID. @example "PRRT_kwDO…" */
  threadId: string;
}): Promise<void> {
  const { session, threadId } = params;

  await session.octokit.graphql(RESOLVE_MUTATION, { id: threadId });
}

/** Replace a review comment's text. */
async function updateComment(params: {
  /** The comment and its new text. @example `{ body: "…", commentId: 7 }` */
  edit: CommentEdit;

  /** The client and pull request. @example `{ octokit, target }` */
  session: Session;
}): Promise<void> {
  const { edit, session } = params;
  const { owner, repo } = session.target;

  await session.octokit.request(
    "PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}",
    { body: edit.body, comment_id: edit.commentId, owner, repo }
  );
}
