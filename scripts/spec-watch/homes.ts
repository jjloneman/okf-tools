/*
 * Look for the spec's next home: the pin's candidates, the repos a new notice
 * links to, and new repos beside the home.
 *
 * - Each repo counts only when it holds a spec with a version line (see
 *   `readSpecFile`), so a link to anything else is never reported.
 */
import type { Failure, GitHubClient } from "./github.ts";
import type { Notice } from "./notices.ts";
import type { SpecPin } from "./pin.ts";
import type { SpecFile } from "./spec-file.ts";

import { readBoolean, readString } from "./json.ts";
import { findNewNotices, isSameRepo } from "./notices.ts";
import { readSpecFile } from "./spec-file.ts";

/** A candidate home in the pin that is now public. */
export type CandidateHome = {
  /**
   * The candidate, as `<owner>/<name>`.
   *
   * @example "okf-community/okf-spec"
   */
  repo: string;

  /**
   * Its spec, or `undefined` when it holds none yet.
   *
   * @example `{ path: "SPEC.md", version: "0.3" }`
   */
  spec: SpecFile | undefined;
};

/** A repo outside the pin that holds a spec. */
export type FoundHome = {
  /**
   * The repo whose notice links to it, or `undefined` for a new repo beside
   * the home, which nothing links to.
   *
   * @example "acme/spec"
   */
  linkedFrom: string | undefined;

  /**
   * The repo, as `<owner>/<name>`.
   *
   * @example "okf-community/okf-spec"
   */
  repo: string;

  /**
   * Its spec.
   *
   * @example `{ path: "SPEC.md", version: "0.3" }`
   */
  spec: SpecFile;
};

/** A link from one repo's notice to another repo. */
type Link = {
  /**
   * The repo whose notice holds the link.
   *
   * @example "acme/spec"
   */
  from: string;

  /**
   * The repo it links to.
   *
   * @example "acme/next-home"
   */
  repo: string;
};

/*
 * The most linked repos one run reads.
 *
 * - Following a found home's own README can chain from move to move, so the
 *   cap bounds the run's requests to GitHub.
 */
const MAX_LINKED_REPOS = 10;

/*
 * Read the repos the home's new notices link to, and the repos those link to
 * in turn.
 *
 * - Each one that holds a spec is a found home, and its root README's notices
 *   are followed too, since a spec can move twice before anyone looks.
 *
 * - Upstream text picks these repos, so one that GitHub won't serve is
 *   skipped rather than failing the run; the next run tries it again.
 */
export async function readLinkedHomes({
  client,
  home,
  known,
  notices,
  pin,
}: {
  /** The client to call GitHub with. */
  client: GitHubClient;

  /** The watched repo, which the notices are in. */
  home: string;

  /** The repos never to report: the home and the candidates. */
  known: string[];

  /** The home's new notices. */
  notices: Notice[];

  /** The pin, whose `path` each repo's spec is looked for at first. */
  pin: SpecPin;
}): Promise<FoundHome[]> {
  const homes: FoundHome[] = [];
  const queue = toLinks({ from: home, notices });
  const seen = [...known];

  for (const link of queue) {
    if (seen.some((repo) => isSameRepo({ left: repo, right: link.repo }))) {
      continue;
    }

    if (seen.length - known.length >= MAX_LINKED_REPOS) {
      break;
    }

    seen.push(link.repo);

    const specAnswer = await readSpecFile({ client, pin, repo: link.repo });

    if (!specAnswer.isOk || specAnswer.spec === undefined) {
      continue;
    }

    homes.push({
      linkedFrom: link.from,
      repo: link.repo,
      spec: specAnswer.spec,
    });

    const readmeAnswer = await client.getText(`/repos/${link.repo}/readme`);

    queue.push(
      ...toLinks({
        from: link.repo,
        notices: findNewNotices({
          file: "README",
          headText: readmeAnswer.isOk ? (readmeAnswer.text ?? "") : "",
          pinText: "",
        }),
      })
    );
  }

  return homes;
}

/** Read which candidate homes are public, and each one's spec. */
export async function readPublicCandidates({
  client,
  pin,
}: {
  /** The client to call GitHub with. */
  client: GitHubClient;

  /** The pin, whose `candidates` are read. */
  pin: SpecPin;
}): Promise<{ isOk: true; publicCandidates: CandidateHome[] } | Failure> {
  const publicCandidates: CandidateHome[] = [];

  for (const candidate of pin.candidates) {
    const answer = await client.getJson(`/repos/${candidate}`);

    if (!answer.isOk) {
      return answer;
    }

    if (readBoolean({ key: "private", value: answer.json }) !== false) {
      continue;
    }

    const specAnswer = await readSpecFile({ client, pin, repo: candidate });

    if (!specAnswer.isOk) {
      return specAnswer;
    }

    publicCandidates.push({ repo: candidate, spec: specAnswer.spec });
  }

  return { isOk: true, publicCandidates };
}

/*
 * Read the repos created beside the home since the pin's commit, and keep
 * those that hold a spec.
 *
 * - It catches a move that no README or spec line announces, as long as the
 *   new home has the same owner, as the spec's first move did.
 *
 * - Only the owner's hundred newest repos are read, which bounds the run's
 *   requests to GitHub for an owner with many.
 *
 * - A repo whose spec GitHub won't serve is skipped, as in `readLinkedHomes`.
 */
export async function readSiblingHomes({
  client,
  home,
  known,
  pin,
  since,
}: {
  /** The client to call GitHub with. */
  client: GitHubClient;

  /** The home as GitHub now names it, whose owner's repos are read. */
  home: string;

  /** The repos never to report: the home, the candidates, the linked homes. */
  known: string[];

  /** The pin, whose `path` each repo's spec is looked for at first. */
  pin: SpecPin;

  /**
   * When the pin's commit landed, in milliseconds since the epoch, so only
   * repos created after it count, or `undefined` to count all of them, as
   * when the home is gone.
   */
  since: number | undefined;
}): Promise<{ homes: FoundHome[]; isOk: true } | Failure> {
  const owner = home.slice(0, home.indexOf("/"));
  const path = `/users/${owner}/repos?sort=created&direction=desc&per_page=100`;
  const answer = await client.getJson(path);

  if (!answer.isOk) {
    return answer;
  }

  if (answer.json === undefined) {
    return { homes: [], isOk: true };
  }

  if (!Array.isArray(answer.json)) {
    return { isOk: false, reason: `GET ${path} didn't answer with a list` };
  }

  const homes: FoundHome[] = [];

  for (const item of answer.json) {
    const repo = readString({ key: "full_name", value: item }) ?? "";
    const createdAt = readString({ key: "created_at", value: item }) ?? "";
    const isNew = since === undefined || Date.parse(createdAt) > since;

    if (
      repo === "" ||
      !isNew ||
      known.some((knownRepo) => isSameRepo({ left: knownRepo, right: repo }))
    ) {
      continue;
    }

    const specAnswer = await readSpecFile({ client, pin, repo });

    if (specAnswer.isOk && specAnswer.spec !== undefined) {
      homes.push({ linkedFrom: undefined, repo, spec: specAnswer.spec });
    }
  }

  return { homes, isOk: true };
}

/** The links in a repo's notices, one per linked repo. */
function toLinks({
  from,
  notices,
}: {
  from: string;
  notices: Notice[];
}): Link[] {
  return notices.flatMap((notice) =>
    notice.repos.map((repo) => ({ from, repo }))
  );
}
