/*
 * Find the lines of an upstream file that may announce a deprecation or a
 * move, and the GitHub repos they point to.
 */

/** A line in an upstream file that may announce a deprecation or a move. */
export type Notice = {
  /**
   * Which file holds it: the repo's README, the README in the spec's own
   * folder, or the spec.
   *
   * @example "README"
   */
  file: NoticeFile;

  /**
   * The line, trimmed.
   *
   * @example "This repo is deprecated; the spec has moved."
   */
  line: string;

  /**
   * The GitHub repos linked from the line's paragraph, as `<owner>/<name>`.
   *
   * @example ["acme/next-home"]
   */
  repos: string[];
};

/** Which file a notice is in. */
export type NoticeFile = "FOLDER_README" | "README" | "SPEC";

/*
 * A line that may announce a deprecation or a move.
 *
 * - Only lines new since the pin count, since the spec itself defines a
 *   `deprecated` status.
 */
const NOTICE_PATTERN =
  /\b(?:archived|deprecated|deprecation|frozen|has moved|moved to|no longer (?:maintained|supported|updated)|now lives)\b/iu;

/*
 * A link to a GitHub repo, or to anything inside one.
 *
 * - Only `github.com` itself counts, not a host such as `api.github.com` or
 *   `gist.github.com`, and an owner, like a GitHub account, has no dots.
 *
 * - A name may end in `.git`, or in a sentence's full stop, so both are
 *   trimmed off after the match.
 */
const REPO_LINK_PATTERN =
  /(?<=(?:^|[^\w.-])(?:www\.)?github\.com\/)[\w-]+\/[\w.-]+/gu;

/*
 * The first path segments of github.com pages that aren't an account's repos,
 * so a badge or an attachment never spends one of a run's linked-repo reads.
 */
const NON_REPO_OWNERS = new Set([
  "about",
  "apps",
  "collections",
  "enterprises",
  "explore",
  "features",
  "issues",
  "login",
  "marketplace",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "site",
  "sponsors",
  "topics",
  "trending",
  "user-attachments",
]);

/*
 * A line that ends a paragraph: blank, or a blockquote's bare `>`, as in a
 * GitHub alert.
 */
const PARAGRAPH_BREAK_PATTERN = /^[\s>]*$/u;

/** The GitHub repos a text links to, once each, in the order first linked. */
export function findLinkedRepos(text: string): string[] {
  const repos = [...text.matchAll(REPO_LINK_PATTERN)].map((match) =>
    match[0].replace(/(?:\.git)?\.*$/u, "")
  );

  return mergeRepos(
    repos.filter(
      (repo) =>
        !repo.endsWith("/") &&
        !NON_REPO_OWNERS.has(repo.slice(0, repo.indexOf("/")).toLowerCase())
    )
  );
}

/** The lines of a file's new text that may be notices and weren't in the old. */
export function findNewNotices({
  file,
  headText,
  pinText,
}: {
  /** Which file the texts are. */
  file: NoticeFile;

  /** The file's text now. */
  headText: string;

  /** The file's text at the pin, or `""` to count every notice as new. */
  pinText: string;
}): Notice[] {
  const pinLines = new Set(pinText.split("\n").map((line) => line.trim()));
  const lines = headText.split("\n");
  const notices = new Map<string, Notice>();

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();

    if (!NOTICE_PATTERN.test(line) || pinLines.has(line)) {
      continue;
    }

    const repos = findLinkedRepos(readParagraph({ index, lines }));
    const known = notices.get(line);

    notices.set(line, {
      file,
      line,
      repos: mergeRepos([...(known?.repos ?? []), ...repos]),
    });
  }

  return [...notices.values()];
}

/** Whether two repo names are the same repo, as GitHub ignores case. */
export function isSameRepo({
  left,
  right,
}: {
  /** One repo, as `<owner>/<name>`. */
  left: string;

  /** The other repo, as `<owner>/<name>`. */
  right: string;
}): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** Repo names once each, ignoring case, keeping the first spelling. */
function mergeRepos(repos: string[]): string[] {
  const merged: string[] = [];

  for (const repo of repos) {
    if (!merged.some((known) => isSameRepo({ left: known, right: repo }))) {
      merged.push(repo);
    }
  }

  return merged;
}

/** The paragraph around a line: its neighbors up to a break either side. */
function readParagraph({
  index,
  lines,
}: {
  index: number;
  lines: string[];
}): string {
  const isBreak = (line: string): boolean => PARAGRAPH_BREAK_PATTERN.test(line);
  const before = lines.slice(0, index).reverse().findIndex(isBreak);
  const after = lines.slice(index + 1).findIndex(isBreak);

  return lines
    .slice(
      before === -1 ? 0 : index - before,
      after === -1 ? lines.length : index + 1 + after
    )
    .join("\n");
}
