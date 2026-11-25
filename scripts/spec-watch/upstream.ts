/*
 * Read the upstream spec's state from GitHub: everything the watch compares
 * against the pin.
 */
import type { Failure, GitHubClient } from "./github.ts";
import type { SpecPin } from "./pin.ts";

import { encodePath } from "./github.ts";
import { readBoolean, readField, readNumber, readString } from "./json.ts";

/** A line in an upstream file that may announce a deprecation or a move. */
export type Notice = {
  /**
   * Which file holds it.
   *
   * @example "README"
   */
  file: "README" | "SPEC";

  /**
   * The line, trimmed.
   *
   * @example "This repo is deprecated; the spec has moved."
   */
  line: string;
};

/** A commit to the spec since the pin. */
export type SpecCommit = {
  /**
   * The commit's author date, as GitHub reports it.
   *
   * @example "2026-08-21T10:00:00Z"
   */
  date: string;

  /**
   * The commit's full SHA.
   *
   * @example "3fcbb9f828c2f23d109c855ee403c3a4c81f3a96"
   */
  sha: string;

  /**
   * The first line of the commit message.
   *
   * @example "Update SPEC.md"
   */
  subject: string;

  /**
   * The commit's page on GitHub.
   *
   * @example "https://github.com/a/b/commit/3fcbb9f"
   */
  url: string;
};

/** An open upstream pull request that touches the spec. */
export type SpecPullRequest = {
  /**
   * The pull request's number in the watched repo.
   *
   * @example 401
   */
  number: number;

  /**
   * The pull request's title.
   *
   * @example "Move the spec to its new home"
   */
  title: string;
};

/** The upstream state the watch compares against the pin. */
export type UpstreamState = {
  /**
   * Commits to the spec, newest first, down to but not including the pin.
   *
   * @example []
   */
  commits: SpecCommit[];

  /**
   * The watched repo's name as GitHub now reports it, or `undefined` when the
   * repo is gone.
   *
   * @example "GoogleCloudPlatform/knowledge-catalog"
   */
  fullName: string | undefined;

  /**
   * The newest commit to the spec's path, or `undefined` when there is none.
   *
   * @example "62432a095456147ee71e70ac6e4dc0d2dea3ac30"
   */
  headSha: string | undefined;

  /**
   * Whether the watched repo is archived.
   *
   * @example false
   */
  isArchived: boolean;

  /**
   * Whether the pin appeared among the spec's last hundred commits, so
   * `commits` is complete.
   *
   * @example true
   */
  isPinFound: boolean;

  /**
   * Whether the spec's file is missing at `headSha`.
   *
   * @example false
   */
  isSpecMissing: boolean;

  /**
   * Lines that may announce a deprecation or a move, new since the pin.
   *
   * @example []
   */
  notices: Notice[];

  /**
   * The candidate homes that are now public.
   *
   * @example ["open-knowledge-format/open-knowledge-format"]
   */
  publicCandidates: string[];

  /**
   * The open upstream pull requests that touch the spec, by number.
   *
   * @example `[{ number: 401, title: "Update SPEC.md" }]`
   */
  pullRequests: SpecPullRequest[];

  /**
   * The spec's `**Version …**` line at `headSha`, or `undefined` when it has
   * none.
   *
   * @example "0.2"
   */
  version: string | undefined;
};

/** The upstream state, read. */
type UpstreamAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The upstream state.
   *
   * @example `{ commits: [], fullName: "a/b", … }`
   */
  upstream: UpstreamState;
};

/*
 * A line that may announce a deprecation or a move.
 *
 * - Only lines new since the pin count, since the spec itself defines a
 *   `deprecated` status.
 */
const NOTICE_PATTERN =
  /\b(?:archived|deprecated|deprecation|has moved|moved to|no longer (?:maintained|supported|updated))\b/iu;

/** The spec's version line, such as `**Version 0.2**`. */
const VERSION_PATTERN = /^\*\*Version (?<version>[^*\n]+)\*\*/mu;

/** The lines of a file's new text that may be notices and weren't in the old. */
export function findNewNotices({
  file,
  headText,
  pinText,
}: {
  /** Which file the texts are. */
  file: Notice["file"];

  /** The file's text now. */
  headText: string;

  /** The file's text at the pin. */
  pinText: string;
}): Notice[] {
  const pinLines = new Set(pinText.split("\n").map((line) => line.trim()));
  const lines = headText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => NOTICE_PATTERN.test(line) && !pinLines.has(line));

  return [...new Set(lines)].map((line) => ({ file, line }));
}

/** Read the upstream spec's state. */
export async function readUpstream({
  client,
  pin,
}: {
  /** The client to call GitHub with. */
  client: GitHubClient;

  /** The pin to compare against. */
  pin: SpecPin;
}): Promise<Failure | UpstreamAnswer> {
  const repoAnswer = await client.getJson(`/repos/${pin.repo}`);

  if (!repoAnswer.isOk) {
    return repoAnswer;
  }

  if (repoAnswer.json === undefined) {
    const goneCandidates = await readPublicCandidates({ client, pin });

    return goneCandidates.isOk
      ? {
          isOk: true,
          upstream: {
            ...goneState(),
            publicCandidates: goneCandidates.publicCandidates,
          },
        }
      : goneCandidates;
  }

  const commitsAnswer = await readCommits({ client, pin });

  if (!commitsAnswer.isOk) {
    return commitsAnswer;
  }

  const { commits, headSha, isPinFound } = commitsAnswer;
  const filesAnswer = await readFiles({ client, headSha, pin });

  if (!filesAnswer.isOk) {
    return filesAnswer;
  }

  const pullsAnswer = await readPullRequests({ client, pin });

  if (!pullsAnswer.isOk) {
    return pullsAnswer;
  }

  const candidatesAnswer = await readPublicCandidates({ client, pin });

  if (!candidatesAnswer.isOk) {
    return candidatesAnswer;
  }

  return {
    isOk: true,
    upstream: {
      commits,
      fullName:
        readString({ key: "full_name", value: repoAnswer.json }) ?? pin.repo,
      headSha,
      isArchived:
        readBoolean({ key: "archived", value: repoAnswer.json }) ?? false,
      isPinFound,
      isSpecMissing: filesAnswer.specText === undefined,
      notices: filesAnswer.notices,
      publicCandidates: candidatesAnswer.publicCandidates,
      pullRequests: pullsAnswer.pullRequests,
      version: readVersion(filesAnswer.specText ?? ""),
    },
  };
}

/** Read the spec's version from its `**Version …**` line. */
export function readVersion(text: string): string | undefined {
  return VERSION_PATTERN.exec(text)?.groups?.version?.trim();
}

/** The state of a watched repo that no longer exists. */
function goneState(): UpstreamState {
  return {
    commits: [],
    fullName: undefined,
    headSha: undefined,
    isArchived: false,
    isPinFound: false,
    isSpecMissing: false,
    notices: [],
    publicCandidates: [],
    pullRequests: [],
    version: undefined,
  };
}

/** Read one commit from the commits list. */
function readCommit(item: unknown): SpecCommit {
  const commit = readField({ key: "commit", value: item });
  const author = readField({ key: "author", value: commit });
  const message = readString({ key: "message", value: commit }) ?? "";

  return {
    date: readString({ key: "date", value: author }) ?? "",
    sha: readString({ key: "sha", value: item }) ?? "",
    subject: message.replace(/\n.*/su, ""),
    url: readString({ key: "html_url", value: item }) ?? "",
  };
}

/** Read the last hundred commits to the spec, down to the pin. */
async function readCommits({
  client,
  pin,
}: {
  client: GitHubClient;
  pin: SpecPin;
}): Promise<
  | {
      commits: SpecCommit[];
      headSha: string | undefined;
      isOk: true;
      isPinFound: boolean;
    }
  | Failure
> {
  const path = `/repos/${pin.repo}/commits?path=${encodeURIComponent(pin.path)}&per_page=100`;
  const answer = await client.getJson(path);

  if (!answer.isOk) {
    return answer;
  }

  if (!Array.isArray(answer.json)) {
    return { isOk: false, reason: `GET ${path} didn't answer with a list` };
  }

  const all = answer.json.map((item: unknown) => readCommit(item));
  const pinIndex = all.findIndex((commit) => commit.sha === pin.sha);

  return {
    commits: pinIndex === -1 ? all : all.slice(0, pinIndex),
    headSha: all[0]?.sha,
    isOk: true,
    isPinFound: pinIndex !== -1,
  };
}

/** Read the spec and the README, now and at the pin. */
async function readFiles({
  client,
  headSha,
  pin,
}: {
  client: GitHubClient;
  headSha: string | undefined;
  pin: SpecPin;
}): Promise<
  { isOk: true; notices: Notice[]; specText: string | undefined } | Failure
> {
  const specPath = `/repos/${pin.repo}/contents/${encodePath(pin.path)}`;
  const readmePath = `/repos/${pin.repo}/readme`;
  const paths = [
    headSha === undefined ? undefined : `${specPath}?ref=${headSha}`,
    `${specPath}?ref=${pin.sha}`,
    readmePath,
    `${readmePath}?ref=${pin.sha}`,
  ];
  const texts: (string | undefined)[] = [];

  for (const path of paths) {
    if (path === undefined) {
      texts.push(undefined);
      continue;
    }

    const answer = await client.getText(path);

    if (!answer.isOk) {
      return answer;
    }

    texts.push(answer.text);
  }

  const [specHead, specPin, readmeHead, readmePin] = texts;

  return {
    isOk: true,
    notices: [
      ...findNewNotices({
        file: "README",
        headText: readmeHead ?? "",
        pinText: readmePin ?? "",
      }),
      ...findNewNotices({
        file: "SPEC",
        headText: specHead ?? "",
        pinText: specPin ?? "",
      }),
    ],
    specText: specHead,
  };
}

/** Read which candidate homes are public. */
async function readPublicCandidates({
  client,
  pin,
}: {
  client: GitHubClient;
  pin: SpecPin;
}): Promise<{ isOk: true; publicCandidates: string[] } | Failure> {
  const publicCandidates: string[] = [];

  for (const candidate of pin.candidates) {
    const answer = await client.getJson(`/repos/${candidate}`);

    if (!answer.isOk) {
      return answer;
    }

    if (readBoolean({ key: "private", value: answer.json }) === false) {
      publicCandidates.push(candidate);
    }
  }

  return { isOk: true, publicCandidates };
}

/** Read the open upstream pull requests that touch the spec. */
async function readPullRequests({
  client,
  pin,
}: {
  client: GitHubClient;
  pin: SpecPin;
}): Promise<{ isOk: true; pullRequests: SpecPullRequest[] } | Failure> {
  const listAnswer = await client.listAll(
    `/repos/${pin.repo}/pulls?state=open`
  );

  if (!listAnswer.isOk) {
    return listAnswer;
  }

  const pullRequests: SpecPullRequest[] = [];

  for (const item of listAnswer.items) {
    const number = readNumber({ key: "number", value: item });

    if (number === undefined) {
      continue;
    }

    const filesAnswer = await client.listAll(
      `/repos/${pin.repo}/pulls/${number}/files`
    );

    if (!filesAnswer.isOk) {
      return filesAnswer;
    }

    const doesTouchSpec = filesAnswer.items.some(
      (file: unknown) =>
        readString({ key: "filename", value: file }) === pin.path ||
        readString({ key: "previous_filename", value: file }) === pin.path
    );

    if (doesTouchSpec) {
      pullRequests.push({
        number,
        title: readString({ key: "title", value: item }) ?? "",
      });
    }
  }

  return {
    isOk: true,
    pullRequests: pullRequests.sort((a, b) => a.number - b.number),
  };
}
