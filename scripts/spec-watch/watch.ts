/*
 * One run of the spec watch: compare upstream against the pin, open one issue
 * for what's new, and send a push.
 *
 * - It never throws; a failure prints its reason and exits `1`, so a scheduled
 *   run that can't check upstream shows as failed.
 */
import { readFile } from "node:fs/promises";

import type { Failure, Fetch, GitHubClient } from "./github.ts";
import type { SpecPin } from "./pin.ts";

import { describeError } from "../../src/output.ts";
import { createGitHubClient } from "./github.ts";
import { readField, readNumber, readString } from "./json.ts";
import { sendPush } from "./ntfy.ts";
import { isFullSha, isRepoName, parsePin } from "./pin.ts";
import {
  findSignals,
  readReportedKeys,
  renderIssue,
  summarizeSignals,
} from "./signals.ts";
import { readUpstream } from "./upstream.ts";

/** Where a run prints its lines. */
export type Printer = {
  /**
   * Print a failure line.
   *
   * @example `(line) => { console.error(line); }`
   */
  error: (line: string) => void;

  /**
   * Print an information line.
   *
   * @example `(line) => { console.log(line); }`
   */
  info: (line: string) => void;
};

/** The settings a run reads from its environment. */
type Settings = {
  /**
   * Whether to print the issue instead of opening it, from
   * `SPEC_WATCH_DRY_RUN`.
   *
   * @example false
   */
  isDryRun: boolean;

  /**
   * Always `true` on settings that were read.
   *
   * @example true
   */
  isOk: true;

  /**
   * The repo to open the issue in, from `GITHUB_REPOSITORY`.
   *
   * @example "jjloneman/okf-tools"
   */
  repository: string;

  /**
   * The workflow run's page, when the run is in Actions.
   *
   * @example "https://github.com/jjloneman/okf-tools/actions/runs/1"
   */
  runUrl: string | undefined;

  /**
   * A SHA to compare against instead of the pin's, from `SPEC_WATCH_SHA`.
   *
   * @example "3fcbb9f828c2f23d109c855ee403c3a4c81f3a96"
   */
  shaOverride: string | undefined;

  /**
   * The token for the API, from `GITHUB_TOKEN`.
   *
   * @example "ghs_example"
   */
  token: string;

  /**
   * The ntfy topic, from `NTFY_TOPIC`, which is secret.
   *
   * @example "example-topic"
   */
  topic: string | undefined;
};

/** The account the workflow's token opens issues as. */
const BOT_LOGIN = "github-actions[bot]";

/** The label the issue gets: the pin is a dependency of the package. */
const ISSUE_LABEL = "📦 dependencies";

/** The prefix on every line a run prints. */
const PREFIX = "[spec-watch]";

/** Run the watch once; resolves to the process exit code. */
export async function runSpecWatch({
  env,
  fetch,
  pinPath,
  printer,
}: {
  /** The environment, such as `process.env`. */
  env: Record<string, string | undefined>;

  /** The `fetch` to call GitHub and ntfy with. */
  fetch: Fetch;

  /** The path to `spec/upstream.json`. */
  pinPath: string;

  /** Where to print. */
  printer: Printer;
}): Promise<number> {
  const print = {
    error: (message: string) => {
      printer.error(prefixLines(message));
    },
    info: (message: string) => {
      printer.info(prefixLines(message));
    },
  };
  const outcome = await watch({ env, fetch, pinPath, print });

  if (!outcome.isOk) {
    print.error(outcome.reason);

    return 1;
  }

  return 0;
}

/** Read and parse the pin, applying any override of its SHA. */
async function loadPin({
  pinPath,
  shaOverride,
}: {
  pinPath: string;
  shaOverride: string | undefined;
}): Promise<{ isOk: true; pin: SpecPin } | Failure> {
  let text: string;

  try {
    text = await readFile(pinPath, "utf8");
  } catch (error: unknown) {
    return {
      isOk: false,
      reason: `Couldn't read the pin: ${describeError(error)}`,
    };
  }

  const answer = parsePin(text);

  if (!answer.isOk || shaOverride === undefined) {
    return answer;
  }

  return { isOk: true, pin: { ...answer.pin, sha: shaOverride } };
}

/** Prefix every line of a message, so each traces to the watch in a log. */
function prefixLines(message: string): string {
  return message
    .split("\n")
    .map((line) => (line === "" ? PREFIX : `${PREFIX} ${line}`))
    .join("\n");
}

/*
 * The keys every earlier spec-watch issue in this repo reported.
 *
 * - Only issues the workflow itself opened count: on a public repo anyone can
 *   write the marker into an issue or a pull request, which would otherwise
 *   hide a change from the watch.
 */
async function readReported({
  client,
  repository,
}: {
  client: GitHubClient;
  repository: string;
}): Promise<{ isOk: true; keys: Set<string> } | Failure> {
  const answer = await client.listAll(
    `/repos/${repository}/issues?creator=${encodeURIComponent(BOT_LOGIN)}&state=all`
  );

  if (!answer.isOk) {
    return answer;
  }

  const bodies = answer.items
    .filter(
      (item: unknown) =>
        readField({ key: "pull_request", value: item }) === undefined &&
        readString({
          key: "login",
          value: readField({ key: "user", value: item }),
        }) === BOT_LOGIN
    )
    .map((item: unknown) => readString({ key: "body", value: item }) ?? "");

  return { isOk: true, keys: readReportedKeys(bodies) };
}

/** Read the run's settings from its environment. */
function readSettings(
  env: Record<string, string | undefined>
): Failure | Settings {
  const token = env.GITHUB_TOKEN ?? "";
  const repository = env.GITHUB_REPOSITORY ?? "";
  const shaOverride = env.SPEC_WATCH_SHA?.trim() ?? "";
  const topic = env.NTFY_TOPIC?.trim() ?? "";
  const { GITHUB_RUN_ID: runId, GITHUB_SERVER_URL: serverUrl } = env;

  if (token === "") {
    return { isOk: false, reason: "GITHUB_TOKEN is not set." };
  }

  if (!isRepoName(repository)) {
    return {
      isOk: false,
      reason: "GITHUB_REPOSITORY must name this repo as <owner>/<name>.",
    };
  }

  if (shaOverride !== "" && !isFullSha(shaOverride)) {
    return { isOk: false, reason: "SPEC_WATCH_SHA must be a full commit SHA." };
  }

  return {
    isDryRun: env.SPEC_WATCH_DRY_RUN === "true",
    isOk: true,
    repository,
    runUrl:
      serverUrl === undefined || runId === undefined
        ? undefined
        : `${serverUrl}/${repository}/actions/runs/${runId}`,
    shaOverride: shaOverride === "" ? undefined : shaOverride,
    token,
    topic: topic === "" ? undefined : topic,
  };
}

/** The run itself, as a result. */
async function watch({
  env,
  fetch,
  pinPath,
  print,
}: {
  env: Record<string, string | undefined>;
  fetch: Fetch;
  pinPath: string;
  print: Printer;
}): Promise<{ isOk: true } | Failure> {
  const settings = readSettings(env);

  if (!settings.isOk) {
    return settings;
  }

  const pinAnswer = await loadPin({
    pinPath,
    shaOverride: settings.shaOverride,
  });

  if (!pinAnswer.isOk) {
    return pinAnswer;
  }

  const { pin } = pinAnswer;
  const client = createGitHubClient({ fetch, token: settings.token });
  const upstreamAnswer = await readUpstream({ client, pin });

  if (!upstreamAnswer.isOk) {
    return upstreamAnswer;
  }

  const { upstream } = upstreamAnswer;
  const allSignals = findSignals({ pin, upstream });

  if (allSignals.length === 0) {
    print.info(
      `Upstream matches the pin ${pin.sha.slice(0, 7)}; nothing to report.`
    );

    return { isOk: true };
  }

  const reported = await readReported({
    client,
    repository: settings.repository,
  });

  if (!reported.isOk) {
    return reported;
  }

  const newSignals = allSignals.filter(
    (signal) => !reported.keys.has(signal.key)
  );

  if (newSignals.length === 0) {
    print.info(
      `Nothing new: earlier issues reported every change found (${allSignals.length}).`
    );

    return { isOk: true };
  }

  const issue = renderIssue({
    allSignals,
    headSha: upstream.headSha,
    newSignals,
    pin,
    runUrl: settings.runUrl,
  });

  if (settings.isDryRun) {
    print.info(`Dry run: would open "${issue.title}":\n\n${issue.body}`);

    return { isOk: true };
  }

  const owner = settings.repository.slice(0, settings.repository.indexOf("/"));
  const created = await client.postJson({
    body: {
      assignees: [owner],
      body: issue.body,
      labels: [ISSUE_LABEL],
      title: issue.title,
    },
    path: `/repos/${settings.repository}/issues`,
  });

  if (!created.isOk) {
    return created;
  }

  const number = readNumber({ key: "number", value: created.json });
  const url = readString({ key: "html_url", value: created.json });

  if (number === undefined || url === undefined) {
    return { isOk: false, reason: "GitHub didn't answer with the new issue." };
  }

  print.info(`Opened #${number}: ${url}`);

  if (settings.topic === undefined) {
    print.info("NTFY_TOPIC is not set, so no push was sent.");

    return { isOk: true };
  }

  const pushed = await sendPush({
    clickUrl: url,
    fetch,
    message: `${summarizeSignals(newSignals)} See #${number}.`,
    title: "The upstream OKF spec changed",
    topic: settings.topic,
  });

  if (!pushed.isOk) {
    return {
      isOk: false,
      reason: `The push failed, though #${number} is open: ${pushed.reason}`,
    };
  }

  print.info("Sent the push.");

  return { isOk: true };
}
