/*
 * The pin in `spec/upstream.json`: which upstream spec okf-tools was written
 * against, and where its next home may appear.
 */
import type { Failure } from "./github.ts";

import { describeError } from "../../src/output.ts";
import { isJsonObject } from "./json.ts";

/** The upstream spec okf-tools supports, as `spec/upstream.json` pins it. */
export type SpecPin = {
  /**
   * Repos that may become the spec's next home, reported once they are public.
   *
   * @example ["open-knowledge-format/open-knowledge-format"]
   */
  candidates: string[];

  /**
   * The spec's path in the watched repo.
   *
   * @example "okf/SPEC.md"
   */
  path: string;

  /**
   * The watched repo, as `<owner>/<name>`.
   *
   * @example "GoogleCloudPlatform/knowledge-catalog"
   */
  repo: string;

  /**
   * The full SHA of the last commit to the spec that okf-tools follows.
   *
   * @example "62432a095456147ee71e70ac6e4dc0d2dea3ac30"
   */
  sha: string;

  /**
   * The spec version that commit's `**Version …**` line names.
   *
   * @example "0.2"
   */
  version: string;
};

/** A parsed pin. */
type PinAnswer = {
  /**
   * Always `true` on an answer.
   *
   * @example true
   */
  isOk: true;

  /**
   * The parsed pin.
   *
   * @example `{ candidates: [], path: "okf/SPEC.md", … }`
   */
  pin: SpecPin;
};

/** A repo as `<owner>/<name>`. */
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/u;

/** A full commit SHA. */
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

/** Whether a text is a full, lowercase commit SHA. */
export function isFullSha(text: string): boolean {
  return SHA_PATTERN.test(text);
}

/** Whether a text names a repo as `<owner>/<name>`. */
export function isRepoName(text: string): boolean {
  return REPO_PATTERN.test(text);
}

/** Parse and check the text of `spec/upstream.json`. */
export function parsePin(text: string): Failure | PinAnswer {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    return {
      isOk: false,
      reason: `spec/upstream.json isn't JSON: ${describeError(error)}`,
    };
  }

  if (!isJsonObject(value)) {
    return { isOk: false, reason: "spec/upstream.json isn't a JSON object" };
  }

  const { candidates, path, repo, sha, version } = value;

  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
    return {
      isOk: false,
      reason: "spec/upstream.json needs `repo` as `<owner>/<name>`",
    };
  }

  if (typeof path !== "string" || path === "") {
    return {
      isOk: false,
      reason: "spec/upstream.json needs the spec's `path`",
    };
  }

  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    return {
      isOk: false,
      reason: "spec/upstream.json needs `sha` as a full commit SHA",
    };
  }

  if (typeof version !== "string" || version === "") {
    return {
      isOk: false,
      reason: "spec/upstream.json needs the pinned `version`",
    };
  }

  if (
    !Array.isArray(candidates) ||
    !candidates.every(
      (candidate): candidate is string =>
        typeof candidate === "string" && REPO_PATTERN.test(candidate)
    )
  ) {
    return {
      isOk: false,
      reason:
        "spec/upstream.json needs `candidates` as a list of `<owner>/<name>`",
    };
  }

  return { isOk: true, pin: { candidates, path, repo, sha, version } };
}
