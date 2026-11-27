/*
 * The GitHub calls `okf review-comments` makes, over `@octokit/core`.
 *
 * - Every call returns an `Outcome`: Octokit throws on an error status or
 *   a GraphQL error, and each throw becomes a reason.
 *
 * - REST answers are typed by Octokit from the endpoint; GraphQL answers
 *   aren't, so `readReviewThreads` narrows each field it reads.
 */
import { Octokit } from "@octokit/core";

import type { Outcome } from "./outcome.ts";

import { readPath } from "./json.ts";
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
  createFileComment: (params: {
    /** The comment's text. */
    body: string;

    /** The file it's on, from the repo root. */
    path: string;
  }) => Promise<Outcome<void>>;

  /**
   * List every file the pull request changes, with its blob at the head.
   *
   * @example `await client.listFiles()`
   */
  listFiles: () => Promise<Outcome<Map<string, string>>>;

  /**
   * Read the pull request's head commit now.
   *
   * @example `await client.readHeadSha()`
   */
  readHeadSha: () => Promise<Outcome<string>>;

  /**
   * Read every review thread's first comment, a page at a time.
   *
   * @example `await client.readReviewThreads()`
   */
  readReviewThreads: () => Promise<Outcome<unknown[]>>;

  /**
   * Resolve a review thread by its GraphQL node ID.
   *
   * @example `await client.resolveThread("PRRT_kwDO…")`
   */
  resolveThread: (threadId: string) => Promise<Outcome<void>>;

  /**
   * Replace a review comment's text.
   *
   * @example `client.updateComment({ body: "…", commentId: 7 })`
   */
  updateComment: (params: {
    /** The comment's new text. */
    body: string;

    /** The comment's REST ID. */
    commentId: number;
  }) => Promise<Outcome<void>>;
};

/** Which pull request the client works on, and how it reaches GitHub. */
export type GitHubTarget = {
  /**
   * The REST API's root, which GitHub Enterprise moves.
   *
   * @example "https://api.github.com"
   */
  apiUrl: string;

  /**
   * The pull request's head commit, which a new comment is made on.
   *
   * @example "4c2a9f0e8b1d7c6a5f4e3d2c1b0a9f8e7d6c5b4a"
   */
  commitId: string;

  /**
   * The `fetch` to call.
   *
   * @example `globalThis.fetch`
   */
  fetch: Fetch;

  /**
   * The pull request's number.
   *
   * @example 147
   */
  number: number;

  /**
   * The repo's owner.
   *
   * @example "jjloneman"
   */
  owner: string;

  /**
   * The repo's name.
   *
   * @example "okf-tools"
   */
  repo: string;

  /**
   * The job's token.
   *
   * @example "ghs_…"
   */
  token: string;
};

/** The page size GitHub's lists take at most. */
const PAGE_SIZE = 100;

/** GitHub lists at most 3,000 files of a pull request: 30 pages. */
const MAX_FILE_PAGES = 30;

/** The query for a page of a pull request's review threads. */
const THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { endCursor hasNextPage }
        nodes { id isResolved comments(first: 1) { nodes { author { login } body databaseId } } }
      }
    }
  }
}`;

/** The mutation that resolves a review thread. */
const RESOLVE_MUTATION = `mutation ($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id } }
}`;

/** Build the client for one pull request. */
export function createGitHubClient(target: GitHubTarget): GitHubClient {
  const { apiUrl, commitId, fetch, number, owner, repo, token } = target;
  const octokit = new Octokit({
    auth: token,
    baseUrl: apiUrl,
    request: { fetch },
  });
  const pull = { owner, pull_number: number, repo };

  return {
    createFileComment: ({ body, path }) =>
      attempt(async () => {
        await octokit.request(
          "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
          { ...pull, body, commit_id: commitId, path, subject_type: "file" }
        );
      }),
    listFiles: () =>
      attempt(async () => {
        const files = new Map<string, string>();

        for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
            { ...pull, page, per_page: PAGE_SIZE }
          );

          // GitHub gives no blob for a file it can't diff, such as one too
          // large; no comment can be made on it either.
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
      }),
    readHeadSha: () =>
      attempt(async () => {
        const { data } = await octokit.request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}",
          pull
        );

        return data.head.sha;
      }),
    readReviewThreads: () =>
      attempt(async () => {
        const nodes: unknown[] = [];
        let cursor: null | string = null;

        do {
          const answer = await octokit.graphql<unknown>(THREADS_QUERY, {
            cursor,
            number,
            owner,
            repo,
          });
          const page = readPath({
            keys: ["repository", "pullRequest", "reviewThreads"],
            value: answer,
          });
          const pageNodes = readPath({ keys: ["nodes"], value: page });

          // An answer without the threads, such as a pull request that
          // isn't there, would read as none and post every draft again.
          if (!Array.isArray(pageNodes)) {
            throw new TypeError(
              "GitHub answered without the pull request's review threads"
            );
          }

          const items: unknown[] = pageNodes;
          const endCursor = readPath({
            keys: ["pageInfo", "endCursor"],
            value: page,
          });

          nodes.push(...items);
          cursor =
            readPath({ keys: ["pageInfo", "hasNextPage"], value: page }) ===
              true && typeof endCursor === "string"
              ? endCursor
              : null;
        } while (cursor !== null);

        return nodes;
      }),
    resolveThread: (threadId) =>
      attempt(async () => {
        await octokit.graphql(RESOLVE_MUTATION, { id: threadId });
      }),
    updateComment: ({ body, commentId }) =>
      attempt(async () => {
        await octokit.request(
          "PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}",
          { body, comment_id: commentId, owner, repo }
        );
      }),
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

/**
 * Say why a GitHub call failed, from the fields Octokit's errors carry.
 *
 * - A GraphQL error lists each of GitHub's messages, which Octokit's own
 *   message prefixes.
 *
 * - A REST error names the request and its status, and GitHub's message
 *   when the body is JSON; one with no answer at all, as a network failure
 *   throws, names the request and why.
 */
function describeGitHubError(error: unknown): string {
  const errors = readPath({ keys: ["errors"], value: error });

  // Octokit's GraphQL error keeps the query, whose first word names the
  // call that failed, so a refused mutation reads apart from a query.
  if (Array.isArray(errors)) {
    const items: unknown[] = errors;
    const query = readPath({ keys: ["request", "query"], value: error });
    const operation =
      typeof query === "string" && query.trimStart().startsWith("mutation")
        ? "GraphQL mutation"
        : "GraphQL query";

    return `${operation} failed: ${items
      .map((item) => {
        const message = readPath({ keys: ["message"], value: item });

        return typeof message === "string" ? message : "an unknown error";
      })
      .join("; ")}`;
  }

  const method = readPath({ keys: ["request", "method"], value: error });
  const url = readPath({ keys: ["request", "url"], value: error });

  if (typeof method !== "string" || typeof url !== "string") {
    return describeError(error);
  }

  if (readPath({ keys: ["response"], value: error }) === undefined) {
    return `${method} ${url} failed: ${describeError(error)}`;
  }

  const status = readPath({ keys: ["status"], value: error });
  const message = readPath({
    keys: ["response", "data", "message"],
    value: error,
  });

  return `${method} ${url} answered ${String(status)}${typeof message === "string" ? `: ${message}` : ""}`;
}
