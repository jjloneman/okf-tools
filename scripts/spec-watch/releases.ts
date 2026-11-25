/*
 * Read the home repo's GitHub releases and tags, since a release may be how a
 * new spec version is announced.
 */
import type { Failure, GitHubClient } from "./github.ts";

import { readString } from "./json.ts";

/** A GitHub release in the home repo. */
export type SpecRelease = {
  /**
   * The release's title, or `""` when it has none.
   *
   * @example "OKF v0.3"
   */
  name: string;

  /**
   * The tag it's published from.
   *
   * @example "v0.3"
   */
  tag: string;
};

/** The home repo's releases and tags, read. */
type ReleasesAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * Every release, as GitHub lists them, newest first.
   *
   * @example `[{ name: "OKF v0.3", tag: "v0.3" }]`
   */
  releases: SpecRelease[];

  /**
   * The tags that no release is published from, so each tag is reported once.
   *
   * @example ["v0.2"]
   */
  tags: string[];
};

/** Read a repo's releases, and the tags no release is published from. */
export async function readReleases({
  client,
  repo,
}: {
  /** The client to call GitHub with. */
  client: GitHubClient;

  /** The repo, as `<owner>/<name>`. */
  repo: string;
}): Promise<Failure | ReleasesAnswer> {
  const releasesAnswer = await client.listAll(`/repos/${repo}/releases`);

  if (!releasesAnswer.isOk) {
    return releasesAnswer;
  }

  const tagsAnswer = await client.listAll(`/repos/${repo}/tags`);

  if (!tagsAnswer.isOk) {
    return tagsAnswer;
  }

  const releases = releasesAnswer.items.flatMap((item: unknown) => {
    const tag = readString({ key: "tag_name", value: item });

    return tag === undefined
      ? []
      : [
          {
            name: readString({ key: "name", value: item }) ?? "",
            tag,
          },
        ];
  });
  const releaseTags = new Set(releases.map((release) => release.tag));
  const tags = tagsAnswer.items.flatMap((item: unknown) => {
    const name = readString({ key: "name", value: item });

    return name === undefined || releaseTags.has(name) ? [] : [name];
  });

  return { isOk: true, releases, tags };
}
