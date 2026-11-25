/*
 * Read the spec in a repo other than the home, and the version line any spec
 * holds.
 */
import type { Failure, GitHubClient } from "./github.ts";
import type { SpecPin } from "./pin.ts";

import { encodePath } from "./github.ts";

/** A spec found in a repo, by its version line. */
export type SpecFile = {
  /**
   * The spec's path in its repo.
   *
   * @example "SPEC.md"
   */
  path: string;

  /**
   * The spec's `**Version …**` line.
   *
   * @example "0.3"
   */
  version: string;
};

/** A repo's spec, read. */
type SpecFileAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The spec, or `undefined` when the repo holds none with a version line.
   *
   * @example `{ path: "SPEC.md", version: "0.3" }`
   */
  spec: SpecFile | undefined;
};

/** Where a spec sits when it's at a repo's root. */
const ROOT_SPEC_PATH = "SPEC.md";

/** The spec's version line, such as `**Version 0.2**`. */
const VERSION_PATTERN = /^\*\*Version (?<version>[^*\n]+)\*\*/mu;

/*
 * Read a repo's spec: at the pin's `path`, then at the root.
 *
 * - Only a file with a version line counts, since `SPEC.md` is a common name
 *   for unrelated files.
 */
export async function readSpecFile({
  client,
  pin,
  repo,
}: {
  /** The client to call GitHub with. */
  client: GitHubClient;

  /** The pin, whose `path` is tried first. */
  pin: SpecPin;

  /** The repo to read, as `<owner>/<name>`. */
  repo: string;
}): Promise<Failure | SpecFileAnswer> {
  const paths =
    pin.path === ROOT_SPEC_PATH ? [pin.path] : [pin.path, ROOT_SPEC_PATH];

  for (const path of paths) {
    const answer = await client.getText(
      `/repos/${repo}/contents/${encodePath(path)}`
    );

    if (!answer.isOk) {
      return answer;
    }

    const version = readVersion(answer.text ?? "");

    if (version !== undefined) {
      return { isOk: true, spec: { path, version } };
    }
  }

  return { isOk: true, spec: undefined };
}

/** Read the spec's version from its `**Version …**` line. */
export function readVersion(text: string): string | undefined {
  return VERSION_PATTERN.exec(text)?.groups?.version?.trim();
}
