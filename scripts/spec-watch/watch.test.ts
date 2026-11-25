import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { FakeFetch, FakeRoute } from "#test/spec-watch";

import {
  API,
  createFakeFetch,
  createUpstreamRoutes,
  HEAD_SHA,
  PIN,
  PIN_SHA,
} from "#test/spec-watch";

import { runSpecWatch } from "./watch.ts";

/** What one run returned and printed, and the requests it made. */
type RunResult = {
  /** The failure lines printed. */
  errors: string[];

  /** The exit code the run resolved to. */
  exitCode: number;

  /** The requests the fake `fetch` received. */
  fake: FakeFetch;

  /** The information lines printed. */
  infos: string[];
};

/** The environment of a scheduled run, before any test's changes. */
const BASE_ENV: Record<string, string | undefined> = {
  GITHUB_REPOSITORY: "acme/tools",
  GITHUB_TOKEN: "fake-token",
};

/** The URL of the first page of this repo's issues. */
const ISSUES_LIST_URL = `${API}/repos/acme/tools/issues?creator=github-actions%5Bbot%5D&state=all&per_page=100&page=1`;

/** The account the workflow opens issues as. */
const BOT = { login: "github-actions[bot]" };

/** The URL issues are opened at. */
const ISSUES_URL = `${API}/repos/acme/tools/issues`;

/** The new issue's page. */
const ISSUE_PAGE = "https://github.com/acme/tools/issues/7";

/** The ntfy server's root, which every push is posted to. */
const NTFY_URL = "https://ntfy.sh/";

/** A SHA that overrides the pin's. */
const OVERRIDE_SHA = "4444444444444444444444444444444444444444";

/** A fabricated secret topic. */
const TOPIC = "fake-topic-0123";

/** The upstream routes of a spec with one new commit since the pin. */
const CHANGED_ROUTES: FakeRoute[] = createUpstreamRoutes({
  headSha: HEAD_SHA,
  pinSha: PIN_SHA,
  version: "0.2",
});

let directory = "";
let pinPath = "";

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "spec-watch-"));
  pinPath = path.join(directory, "upstream.json");
  writeFileSync(pinPath, JSON.stringify(PIN));
});

afterEach(() => {
  rmSync(directory, { force: true, recursive: true });
});

/** The routes of a changed upstream, no earlier issue, and an issue opened. */
function createOpeningRoutes(
  answer: unknown = {
    html_url: ISSUE_PAGE,
    number: 7,
  }
): FakeRoute[] {
  return [
    { body: [], url: ISSUES_LIST_URL },
    { body: answer, method: "POST", status: 201, url: ISSUES_URL },
    ...CHANGED_ROUTES,
  ];
}

/** The JSON body of the first request to a URL with a method. */
function readSentBody({
  fake,
  method,
  url,
}: {
  /** The fake `fetch` that received it. */
  fake: FakeFetch;

  /** The request method. */
  method: string;

  /** The full URL. */
  url: string;
}): unknown {
  const request = fake.requests.find(
    (candidate) => candidate.method === method && candidate.url === url
  );

  return JSON.parse(request?.body ?? "null");
}

/** Run the watch with a fake `fetch`, collecting what it printed. */
async function runWatch({
  env = {},
  routes,
}: {
  /** Changes to the base environment. */
  env?: Record<string, string | undefined>;

  /** The routes the fake `fetch` answers, the first match winning. */
  routes: FakeRoute[];
}): Promise<RunResult> {
  const fake = createFakeFetch(routes);
  const errors: string[] = [];
  const infos: string[] = [];
  const exitCode = await runSpecWatch({
    env: { ...BASE_ENV, ...env },
    fetch: fake.fetch,
    pinPath,
    printer: {
      error: (line) => {
        errors.push(line);
      },
      info: (line) => {
        infos.push(line);
      },
    },
  });

  return { errors, exitCode, fake, infos };
}

describe("runSpecWatch", () => {
  test.each([
    {
      description: "no token",
      env: { GITHUB_TOKEN: undefined },
      reason: "GITHUB_TOKEN is not set.",
    },
    {
      description: "an empty token",
      env: { GITHUB_TOKEN: "" },
      reason: "GITHUB_TOKEN is not set.",
    },
    {
      description: "no repository",
      env: { GITHUB_REPOSITORY: undefined },
      reason: "GITHUB_REPOSITORY must name this repo as <owner>/<name>.",
    },
    {
      description: "a repository without an owner",
      env: { GITHUB_REPOSITORY: "tools" },
      reason: "GITHUB_REPOSITORY must name this repo as <owner>/<name>.",
    },
    {
      description: "a short override SHA",
      env: { SPEC_WATCH_SHA: "1111111" },
      reason: "SPEC_WATCH_SHA must be a full commit SHA.",
    },
  ])("fails with $description", async ({ env, reason }) => {
    // Given - an environment with one setting wrong

    // When - running the watch
    const result = await runWatch({ env, routes: [] });

    // Then - exit 1, the reason, and no request
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([`[spec-watch] ${reason}`]);
    expect(result.fake.requests).toStrictEqual([]);
  });

  test("fails when the pin can't be read", async () => {
    // Given - no pin file
    rmSync(pinPath);

    // When - running the watch
    const result = await runWatch({ routes: [] });

    // Then - exit 1, and the read error
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([
      expect.stringMatching(/^\[spec-watch\] Couldn't read the pin: .*ENOENT/u),
    ]);
  });

  test("fails when the pin is invalid", async () => {
    // Given - a pin with no fields
    writeFileSync(pinPath, "{}");

    // When - running the watch
    const result = await runWatch({ routes: [] });

    // Then - exit 1, and the pin's reason
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([
      "[spec-watch] spec/upstream.json needs `repo` as `<owner>/<name>`",
    ]);
  });

  test("fails when upstream can't be read", async () => {
    // Given - the watched repo answers 500
    const routes: FakeRoute[] = [
      { status: 500, url: `${API}/repos/acme/spec` },
    ];

    // When - running the watch
    const result = await runWatch({ routes });

    // Then - exit 1, and the request's reason
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([
      "[spec-watch] GET /repos/acme/spec answered 500",
    ]);
  });

  test("reports nothing when upstream matches the pin", async () => {
    // Given - upstream still at the pin
    const routes = createUpstreamRoutes({
      headSha: PIN_SHA,
      pinSha: PIN_SHA,
      version: "0.2",
    });

    // When - running the watch
    const result = await runWatch({ routes });

    // Then - exit 0, and no issue read or opened
    expect(result.exitCode).toBe(0);
    expect(result.infos).toStrictEqual([
      "[spec-watch] Upstream matches the pin 1111111; nothing to report.",
    ]);
    expect(
      result.fake.requests.some((request) => request.url.includes("/tools/"))
    ).toBe(false);
  });

  test("fails when the earlier issues can't be read", async () => {
    // Given - a changed upstream, and an issue list that answers 500
    const routes: FakeRoute[] = [
      { status: 500, url: ISSUES_LIST_URL },
      ...CHANGED_ROUTES,
    ];

    // When - running the watch
    const result = await runWatch({ routes });

    // Then - exit 1, and the request's reason
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([
      "[spec-watch] GET /repos/acme/tools/issues?creator=github-actions%5Bbot%5D&state=all&per_page=100&page=1 answered 500",
    ]);
  });

  test("opens nothing when an earlier issue reported every change", async () => {
    // Given - an issue that reported the new commit, and one with no body
    const routes: FakeRoute[] = [
      {
        body: [
          { body: null, number: 2, user: BOT },
          {
            body: `<!-- spec-watch: sha:${HEAD_SHA} -->\n`,
            number: 3,
            user: BOT,
          },
        ],
        url: ISSUES_LIST_URL,
      },
      ...CHANGED_ROUTES,
    ];

    // When - running the watch
    const result = await runWatch({ routes });

    // Then - exit 0, and no issue opened
    expect(result.exitCode).toBe(0);
    expect(result.infos).toStrictEqual([
      "[spec-watch] Nothing new: earlier issues reported every change found (1).",
    ]);
    expect(
      result.fake.requests.some((request) => request.method === "POST")
    ).toBe(false);
  });

  test.each([
    {
      description: "someone else's issue",
      item: { number: 3, user: { login: "mallory" } },
    },
    {
      description: "the workflow's pull request",
      item: { number: 4, pull_request: {}, user: BOT },
    },
  ])("ignores a marker in $description", async ({ item }) => {
    // Given - the marker for the new commit, written where it doesn't count
    const routes: FakeRoute[] = [
      {
        body: [{ ...item, body: `<!-- spec-watch: sha:${HEAD_SHA} -->\n` }],
        url: ISSUES_LIST_URL,
      },
      ...createOpeningRoutes(),
    ];

    // When - running the watch
    const result = await runWatch({ routes });

    // Then - exit 0, and the change reported anyway
    expect(result.exitCode).toBe(0);
    expect(
      result.fake.requests.some((request) => request.method === "POST")
    ).toBe(true);
  });

  test("prints the issue and posts nothing on a dry run", async () => {
    // Given - a dry run with a topic set
    const env = { NTFY_TOPIC: TOPIC, SPEC_WATCH_DRY_RUN: "true" };

    // When - running the watch
    const result = await runWatch({ env, routes: createOpeningRoutes() });

    // Then - exit 0, the title and body printed, and nothing posted
    expect(result.exitCode).toBe(0);
    expect(result.infos).toHaveLength(1);
    expect(result.infos[0]).toMatch(
      /^\[spec-watch\] Dry run: would open "chore\(spec\): 🧹 review the upstream okf spec at 2222222":\n\[spec-watch\]\n\[spec-watch\] <!-- spec-watch: sha:2{40} -->\n/u
    );
    expect(
      result.infos[0]
        ?.split("\n")
        .every((line) => line.startsWith("[spec-watch]"))
    ).toBe(true);
    expect(
      result.fake.requests.some((request) => request.method === "POST")
    ).toBe(false);
  });

  test("opens an issue, linking the run, and sends no push without a topic", async () => {
    // Given - a run in Actions, with a blank topic
    const env = {
      GITHUB_RUN_ID: "5",
      GITHUB_SERVER_URL: "https://github.com",
      NTFY_TOPIC: "  ",
    };

    // When - running the watch
    const result = await runWatch({ env, routes: createOpeningRoutes() });

    // Then - exit 0, the issue opened for the owner, and no push
    expect(result.exitCode).toBe(0);
    expect(result.infos).toStrictEqual([
      `[spec-watch] Opened #7: ${ISSUE_PAGE}`,
      "[spec-watch] NTFY_TOPIC is not set, so no push was sent.",
    ]);
    expect(
      readSentBody({ fake: result.fake, method: "POST", url: ISSUES_URL })
    ).toStrictEqual({
      assignees: ["acme"],
      body: expect.stringContaining(
        "opened by the [spec-watch workflow](https://github.com/acme/tools/actions/runs/5)"
      ) as unknown,
      labels: ["📦 dependencies"],
      title: "chore(spec): 🧹 review the upstream okf spec at 2222222",
    });
    expect(
      result.fake.requests.some((request) => request.url === NTFY_URL)
    ).toBe(false);
  });

  test("leaves the run unlinked without a run ID", async () => {
    // Given - a server URL but no run ID
    const env = { GITHUB_SERVER_URL: "https://github.com" };

    // When - running the watch
    const result = await runWatch({ env, routes: createOpeningRoutes() });

    // Then - the workflow named without a link
    expect(
      readSentBody({ fake: result.fake, method: "POST", url: ISSUES_URL })
    ).toMatchObject({
      body: expect.stringContaining(
        "opened by the spec-watch workflow, which"
      ) as unknown,
    });
  });

  test("sends a push that opens the issue, without printing the topic", async () => {
    // Given - a topic, padded with spaces, and ntfy accepting the push
    const routes: FakeRoute[] = [
      { method: "POST", url: NTFY_URL },
      ...createOpeningRoutes(),
    ];

    // When - running the watch
    const result = await runWatch({
      env: { NTFY_TOPIC: ` ${TOPIC} ` },
      routes,
    });

    // Then - exit 0, the push sent to the trimmed topic, which no line holds
    expect(result.exitCode).toBe(0);
    expect(result.infos).toStrictEqual([
      `[spec-watch] Opened #7: ${ISSUE_PAGE}`,
      "[spec-watch] Sent the push.",
    ]);
    expect(
      readSentBody({ fake: result.fake, method: "POST", url: NTFY_URL })
    ).toStrictEqual({
      click: ISSUE_PAGE,
      message: "New commits to the spec. See #7.",
      tags: ["telescope"],
      title: "The upstream OKF spec changed",
      topic: TOPIC,
    });
    expect(
      [...result.infos, ...result.errors].some((line) => line.includes(TOPIC))
    ).toBe(false);
  });

  test("fails, saying the issue is open, when the push fails", async () => {
    // Given - ntfy refusing the push
    const routes: FakeRoute[] = [
      { method: "POST", status: 500, url: NTFY_URL },
      ...createOpeningRoutes(),
    ];

    // When - running the watch
    const result = await runWatch({ env: { NTFY_TOPIC: TOPIC }, routes });

    // Then - exit 1, naming the open issue, without the topic
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([
      "[spec-watch] The push failed, though #7 is open: ntfy answered 500",
    ]);
    expect(
      [...result.infos, ...result.errors].some((line) => line.includes(TOPIC))
    ).toBe(false);
  });

  test("fails when the issue can't be opened", async () => {
    // Given - GitHub refusing the issue
    const routes: FakeRoute[] = [
      { method: "POST", status: 422, url: ISSUES_URL },
      ...createOpeningRoutes(),
    ];

    // When - running the watch
    const result = await runWatch({ env: { NTFY_TOPIC: TOPIC }, routes });

    // Then - exit 1, the request's reason, and no push
    expect(result.exitCode).toBe(1);
    expect(result.errors).toStrictEqual([
      "[spec-watch] POST /repos/acme/tools/issues answered 422",
    ]);
    expect(
      result.fake.requests.some((request) => request.url === NTFY_URL)
    ).toBe(false);
  });

  test.each([
    { answer: { html_url: ISSUE_PAGE }, description: "no number" },
    { answer: { number: 7 }, description: "no page" },
  ])(
    "fails when the new issue answers with $description",
    async ({ answer }) => {
      // Given - GitHub answering the post with part of an issue
      const routes = createOpeningRoutes(answer);

      // When - running the watch
      const result = await runWatch({ env: { NTFY_TOPIC: TOPIC }, routes });

      // Then - exit 1, and no push
      expect(result.exitCode).toBe(1);
      expect(result.errors).toStrictEqual([
        "[spec-watch] GitHub didn't answer with the new issue.",
      ]);
      expect(
        result.fake.requests.some((request) => request.url === NTFY_URL)
      ).toBe(false);
    }
  );

  test("compares against an override SHA in place of the pin's", async () => {
    // Given - upstream at the pin's SHA, and an override, padded with spaces
    const routes: FakeRoute[] = [
      { body: [], url: ISSUES_LIST_URL },
      ...createUpstreamRoutes({
        headSha: PIN_SHA,
        pinSha: OVERRIDE_SHA,
        version: "0.2",
      }),
    ];
    const env = {
      SPEC_WATCH_DRY_RUN: "true",
      SPEC_WATCH_SHA: ` ${OVERRIDE_SHA} `,
    };

    // When - running the watch
    const result = await runWatch({ env, routes });

    // Then - the pin's own SHA reported as new since the override
    expect(result.exitCode).toBe(0);
    expect(result.infos[0]).toContain(
      `[compare](https://github.com/acme/spec/compare/${OVERRIDE_SHA}...${PIN_SHA})`
    );
    expect(result.fake.requests.map((request) => request.url)).toContain(
      `${API}/repos/acme/spec/readme?ref=${OVERRIDE_SHA}`
    );
  });
});
