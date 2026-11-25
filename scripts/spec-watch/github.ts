/*
 * A small GitHub REST client over `fetch`, for the spec watch.
 *
 * - It never throws: a network failure, an unexpected status, or a body that
 *   isn't JSON becomes a reason.
 *
 * - A `404` is an answer, not a failure, since the watch asks about repos and
 *   files that may not exist.
 */
import { describeError } from "../../src/output.ts";

/** A failed step, with the reason to print. */
export type Failure = {
  /**
   * Always `false` on a failure.
   *
   * @example false
   */
  isOk: false;

  /**
   * What went wrong, as one line.
   *
   * @example "GET /repos/a/b answered 500"
   */
  reason: string;
};

/** The `fetch` the client calls, injected so tests can answer for GitHub. */
export type Fetch = typeof fetch;

/** The calls the spec watch makes to GitHub. */
export type GitHubClient = {
  /**
   * Read a JSON resource; `json` is `undefined` when GitHub answers `404`.
   *
   * @example `client.getJson("/repos/a/b")`
   */
  getJson: (path: string) => Promise<Failure | JsonAnswer>;

  /**
   * Read a file's raw text; `text` is `undefined` when GitHub answers `404`.
   *
   * @example `client.getText("/repos/a/b/readme")`
   */
  getText: (path: string) => Promise<Failure | TextAnswer>;

  /**
   * Read every page of a list resource, a hundred items a page.
   *
   * @example `client.listAll("/repos/a/b/pulls?state=open")`
   */
  listAll: (path: string) => Promise<Failure | ListAnswer>;

  /**
   * Send a JSON body with `POST`, expecting a JSON answer.
   *
   * @example `client.postJson({ body: { title: "t" }, path: "/repos/a/b/issues" })`
   */
  postJson: (params: PostParams) => Promise<Failure | JsonAnswer>;
};

/** A JSON answer from GitHub. */
export type JsonAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The parsed body, or `undefined` when GitHub answered `404`.
   *
   * @example `{ archived: false }`
   */
  json: unknown;
};

/** Every item of a paged list. */
export type ListAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The items of every page, in order.
   *
   * @example `[{ number: 12 }]`
   */
  items: unknown[];
};

/** What `postJson` sends. */
export type PostParams = {
  /**
   * The value to send as JSON.
   *
   * @example `{ title: "chore(spec): 🧹 review the upstream okf spec" }`
   */
  body: unknown;

  /**
   * The API path, from the root.
   *
   * @example "/repos/jjloneman/okf-tools/issues"
   */
  path: string;
};

/** A raw text answer from GitHub. */
export type TextAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The file's text, or `undefined` when GitHub answered `404`.
   *
   * @example "**Version 0.2**"
   */
  text: string | undefined;
};

/** One HTTP answer, before its body is interpreted. */
type RawAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The HTTP status.
   *
   * @example 200
   */
  status: number;

  /**
   * The body, as text.
   *
   * @example "[]"
   */
  text: string;
};

/** The REST API's root. */
const API_ROOT = "https://api.github.com";

/** The page size `listAll` asks for, which is GitHub's largest. */
const PAGE_SIZE = 100;

/*
 * The most pages `listAll` reads before it fails rather than answer with part
 * of a list.
 *
 * - GitHub lists at most 3,000 files of a pull request, so their 31st page
 *   always answers short.
 */
const MAX_PAGES = 31;

/** Build a client that calls GitHub with the given token. */
export function createGitHubClient({
  fetch,
  token,
}: {
  /** The `fetch` to call. */
  fetch: Fetch;

  /** A token for the API, such as the workflow's `GITHUB_TOKEN`. */
  token: string;
}): GitHubClient {
  /** Send one request and read its body as text. */
  async function send({
    accept,
    body,
    method,
    path,
  }: {
    accept: string;
    body?: unknown;
    method: "GET" | "POST";
    path: string;
  }): Promise<Failure | RawAnswer> {
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          accept,
          authorization: `Bearer ${token}`,
          "user-agent": "okf-tools-spec-watch",
          "x-github-api-version": "2022-11-28",
        },
        method,
      });

      return {
        isOk: true,
        status: response.status,
        text: await response.text(),
      };
    } catch (error: unknown) {
      return {
        isOk: false,
        reason: `${method} ${path} failed: ${describeError(error)}`,
      };
    }
  }

  /** Interpret a JSON answer, where a `404` to a `GET` means there is nothing there. */
  function readJson({
    answer,
    method,
    path,
  }: {
    answer: RawAnswer;
    method: "GET" | "POST";
    path: string;
  }): Failure | JsonAnswer {
    if (answer.status === 404 && method === "GET") {
      return { isOk: true, json: undefined };
    }

    if (answer.status < 200 || answer.status >= 300) {
      return {
        isOk: false,
        reason: `${method} ${path} answered ${answer.status}`,
      };
    }

    try {
      return { isOk: true, json: JSON.parse(answer.text) };
    } catch (error: unknown) {
      return {
        isOk: false,
        reason: `${method} ${path} answered with invalid JSON: ${describeError(error)}`,
      };
    }
  }

  /** Read a JSON resource. */
  async function getJson(path: string): Promise<Failure | JsonAnswer> {
    const answer = await send({
      accept: "application/vnd.github+json",
      method: "GET",
      path,
    });

    return answer.isOk ? readJson({ answer, method: "GET", path }) : answer;
  }

  /** Read a file's raw text. */
  async function getText(path: string): Promise<Failure | TextAnswer> {
    const answer = await send({
      accept: "application/vnd.github.raw",
      method: "GET",
      path,
    });

    if (!answer.isOk) {
      return answer;
    }

    if (answer.status === 404) {
      return { isOk: true, text: undefined };
    }

    if (answer.status < 200 || answer.status >= 300) {
      return { isOk: false, reason: `GET ${path} answered ${answer.status}` };
    }

    return { isOk: true, text: answer.text };
  }

  /** Read every page of a list resource, stopping at a short page. */
  async function listAll(path: string): Promise<Failure | ListAnswer> {
    const separator = path.includes("?") ? "&" : "?";
    const items: unknown[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const pagePath = `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`;
      const answer = await getJson(pagePath);

      if (!answer.isOk) {
        return answer;
      }

      if (!Array.isArray(answer.json)) {
        return {
          isOk: false,
          reason: `GET ${pagePath} didn't answer with a list`,
        };
      }

      const pageItems: unknown[] = answer.json;

      items.push(...pageItems);

      if (pageItems.length < PAGE_SIZE) {
        return { isOk: true, items };
      }
    }

    return {
      isOk: false,
      reason: `GET ${path} has more than ${MAX_PAGES} pages`,
    };
  }

  /** Send a JSON body with `POST`. */
  async function postJson({
    body,
    path,
  }: PostParams): Promise<Failure | JsonAnswer> {
    const answer = await send({
      accept: "application/vnd.github+json",
      body,
      method: "POST",
      path,
    });

    return answer.isOk ? readJson({ answer, method: "POST", path }) : answer;
  }

  return { getJson, getText, listAll, postJson };
}

/** Encode each segment of a repo-relative file path for a URL. */
export function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}
