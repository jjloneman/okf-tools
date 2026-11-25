/*
 * Read the upstream spec's state from GitHub: everything the watch compares
 * against the pin.
 */
import type { Failure, GitHubClient } from "./github.ts";
import type { CandidateHome, FoundHome } from "./homes.ts";
import type { Notice } from "./notices.ts";
import type { SpecPin } from "./pin.ts";
import type { SpecRelease } from "./releases.ts";

import { encodePath } from "./github.ts";
import {
  readLinkedHomes,
  readPublicCandidates,
  readSiblingHomes,
} from "./homes.ts";
import { readBoolean, readField, readNumber, readString } from "./json.ts";
import { findNewNotices } from "./notices.ts";
import { readReleases } from "./releases.ts";
import { readVersion } from "./spec-file.ts";

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
   * Repos outside the pin that hold a spec: linked from a new notice, or new
   * beside the home.
   *
   * @example []
   */
  foundHomes: FoundHome[];

  /**
   * The watched repo's name as GitHub now reports it, or `undefined` when the
   * repo is gone.
   *
   * @example "open-knowledge-format/open-knowledge-format"
   */
  fullName: string | undefined;

  /**
   * The newest commit to the spec's path, or `undefined` when there is none.
   *
   * @example "0b87c52c6ef999286c745e19998fdfcd03d5dbee"
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
   * The candidate homes that are now public, each with its spec.
   *
   * @example `[{ repo: "okf-community/okf-spec", spec: undefined }]`
   */
  publicCandidates: CandidateHome[];

  /**
   * The open upstream pull requests that touch the spec, by number.
   *
   * @example `[{ number: 401, title: "Update SPEC.md" }]`
   */
  pullRequests: SpecPullRequest[];

  /**
   * The watched repo's GitHub releases, newest first.
   *
   * @example []
   */
  releases: SpecRelease[];

  /**
   * The watched repo's tags that no release is published from.
   *
   * @example ["v0.2"]
   */
  tags: string[];

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
    const goneHomes = await readNextHomes({
      client,
      fullName: pin.repo,
      notices: [],
      pin,
      pinTime: undefined,
    });

    return goneHomes.isOk
      ? {
          isOk: true,
          upstream: {
            ...goneState(),
            foundHomes: goneHomes.foundHomes,
            publicCandidates: goneHomes.publicCandidates,
          },
        }
      : goneHomes;
  }

  const fullName =
    readString({ key: "full_name", value: repoAnswer.json }) ?? pin.repo;
  const commitsAnswer = await readCommits({ client, pin });

  if (!commitsAnswer.isOk) {
    return commitsAnswer;
  }

  const { commits, headSha, isPinFound, pinTime } = commitsAnswer;
  const filesAnswer = await readFiles({ client, headSha, pin });

  if (!filesAnswer.isOk) {
    return filesAnswer;
  }

  const pullsAnswer = await readPullRequests({ client, pin });

  if (!pullsAnswer.isOk) {
    return pullsAnswer;
  }

  const releasesAnswer = await readReleases({ client, repo: pin.repo });

  if (!releasesAnswer.isOk) {
    return releasesAnswer;
  }

  const homesAnswer = await readNextHomes({
    client,
    fullName,
    notices: filesAnswer.notices,
    pin,
    pinTime,
  });

  if (!homesAnswer.isOk) {
    return homesAnswer;
  }

  return {
    isOk: true,
    upstream: {
      commits,
      foundHomes: homesAnswer.foundHomes,
      fullName,
      headSha,
      isArchived:
        readBoolean({ key: "archived", value: repoAnswer.json }) ?? false,
      isPinFound,
      isSpecMissing: filesAnswer.specText === undefined,
      notices: filesAnswer.notices,
      publicCandidates: homesAnswer.publicCandidates,
      pullRequests: pullsAnswer.pullRequests,
      releases: releasesAnswer.releases,
      tags: releasesAnswer.tags,
      version: readVersion(filesAnswer.specText ?? ""),
    },
  };
}

/** The state of a watched repo that no longer exists. */
function goneState(): UpstreamState {
  return {
    commits: [],
    foundHomes: [],
    fullName: undefined,
    headSha: undefined,
    isArchived: false,
    isPinFound: false,
    isSpecMissing: false,
    notices: [],
    publicCandidates: [],
    pullRequests: [],
    releases: [],
    tags: [],
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
      pinTime: number | undefined;
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
  const pinCommit = readField({
    key: "commit",
    value: pinIndex === -1 ? undefined : answer.json[pinIndex],
  });

  /*
   * The spec watch runs with no install, so the time is read with
   * `Date.parse`, not luxon.
   */
  const pinTime = Date.parse(
    readString({
      key: "date",
      value: readField({ key: "committer", value: pinCommit }),
    }) ?? ""
  );

  return {
    commits: pinIndex === -1 ? all : all.slice(0, pinIndex),
    headSha: all[0]?.sha,
    isOk: true,
    isPinFound: pinIndex !== -1,
    pinTime: Number.isNaN(pinTime) ? undefined : pinTime,
  };
}

/*
 * Read the spec, the README, and the README in the spec's own folder, now and
 * at the pin.
 *
 * - A spec at the repo's root has no folder README of its own, and a folder
 *   with no README is normal, so either reads as empty.
 *
 * - The `readme` endpoint finds a README of any name, such as `readme.md`.
 */
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
  const folder = pin.path.slice(0, Math.max(pin.path.lastIndexOf("/"), 0));
  const folderReadmePath =
    folder === ""
      ? undefined
      : `/repos/${pin.repo}/readme/${encodePath(folder)}`;
  const paths = [
    headSha === undefined ? undefined : `${specPath}?ref=${headSha}`,
    `${specPath}?ref=${pin.sha}`,
    readmePath,
    `${readmePath}?ref=${pin.sha}`,
    folderReadmePath,
    folderReadmePath === undefined
      ? undefined
      : `${folderReadmePath}?ref=${pin.sha}`,
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

  const [specHead, specPin, readmeHead, readmePin, folderHead, folderPin] =
    texts;

  return {
    isOk: true,
    notices: [
      ...findNewNotices({
        file: "README",
        headText: readmeHead ?? "",
        pinText: readmePin ?? "",
      }),
      ...findNewNotices({
        file: "FOLDER_README",
        headText: folderHead ?? "",
        pinText: folderPin ?? "",
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

/*
 * Look for the spec's next home: public candidates, repos the new notices
 * link to, and new repos beside the home.
 */
async function readNextHomes({
  client,
  fullName,
  notices,
  pin,
  pinTime,
}: {
  client: GitHubClient;
  fullName: string;
  notices: Notice[];
  pin: SpecPin;
  pinTime: number | undefined;
}): Promise<
  | { foundHomes: FoundHome[]; isOk: true; publicCandidates: CandidateHome[] }
  | Failure
> {
  const candidatesAnswer = await readPublicCandidates({ client, pin });

  if (!candidatesAnswer.isOk) {
    return candidatesAnswer;
  }

  const known = [pin.repo, fullName, ...pin.candidates];
  const linkedHomes = await readLinkedHomes({
    client,
    home: pin.repo,
    known,
    notices,
    pin,
  });
  const siblingAnswer = await readSiblingHomes({
    client,
    home: fullName,
    known: [...known, ...linkedHomes.map((home) => home.repo)],
    pin,
    since: pinTime,
  });

  if (!siblingAnswer.isOk) {
    return siblingAnswer;
  }

  return {
    foundHomes: [...linkedHomes, ...siblingAnswer.homes],
    isOk: true,
    publicCandidates: candidatesAnswer.publicCandidates,
  };
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
