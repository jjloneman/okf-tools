/*
 * Compare the upstream state against the pin, and word what changed as an
 * issue.
 *
 * - Each signal has a stable key, written into the issue it opens, so a later
 *   run reports only what no earlier spec-watch issue did, open or closed.
 *
 * - Upstream text (commit subjects, pull request titles, notice lines) goes in
 *   code spans: a `@mention` there notifies no one, and a `#12` links to
 *   nothing in this repo.
 */
import { createHash } from "node:crypto";

import type { FoundHome } from "./homes.ts";
import type { NoticeFile } from "./notices.ts";
import type { SpecPin } from "./pin.ts";
import type { UpstreamState } from "./upstream.ts";

/** One reportable difference between upstream and the pin. */
export type Signal = {
  /**
   * A stable key: the same upstream change gives the same key on every run.
   *
   * @example "sha:3fcbb9f828c2f23d109c855ee403c3a4c81f3a96"
   */
  key: string;

  /**
   * What kind of change it reports.
   *
   * @example "commits"
   */
  kind: SignalKind;

  /**
   * The Markdown bullet, with any sub-bullets, that reports it in an issue.
   *
   * @example "- **The repo is archived.**"
   */
  text: string;
};

/** What kind of change a signal reports. */
export type SignalKind =
  | "archived"
  | "candidate-version"
  | "commits"
  | "draft"
  | "gone"
  | "linked"
  | "missing"
  | "notice"
  | "public"
  | "pull-request"
  | "release"
  | "renamed"
  | "sibling"
  | "tag"
  | "version";

/** An issue to open. */
export type SpecIssue = {
  /**
   * The issue's Markdown body, opening with the signal-key marker.
   *
   * @example `"<!-- spec-watch: archived -->"`
   */
  body: string;

  /**
   * The issue's title, naming the newest upstream commit to the spec.
   *
   * @example "chore(spec): 🧹 review the upstream okf spec at 3fcbb9f"
   */
  title: string;
};

/** The short phrase each kind of signal gets in a push. */
const SUMMARIES: Record<SignalKind, string> = {
  archived: "the repo is archived",
  "candidate-version": "a candidate home's spec has another version",
  commits: "new commits to the spec",
  draft: "the version line's draft suffix changed",
  gone: "the repo is gone",
  linked: "a notice links to another spec",
  missing: "the spec's file is missing",
  notice: "a possible deprecation notice",
  public: "a candidate home is public",
  "pull-request": "open pull requests touch the spec",
  release: "a new release",
  renamed: "the repo was renamed",
  sibling: "a new repo beside the home holds a spec",
  tag: "a new tag",
  version: "the version line changed",
};

/** What an issue calls each file a notice can be in. */
const NOTICE_FILE_NAMES: Record<NoticeFile, string> = {
  FOLDER_README: "spec folder's README",
  README: "README",
  SPEC: "spec",
};

/** A version line's draft suffix, such as `0.3 (draft)`. */
const DRAFT_PATTERN = /\(draft\)$/iu;

/*
 * The marker that carries an issue's signal keys.
 *
 * - It counts only at the very start of the body: anything later may be
 *   upstream text, such as a pull request title written to look like one.
 */
const MARKER_PATTERN = /^<!-- spec-watch: [^>]* -->/u;

/** The marker's opening, before its keys. */
const MARKER_OPEN = "<!-- spec-watch: ";

/** The marker's closing, after its keys. */
const MARKER_CLOSE = " -->";

/** The length of a short commit SHA. */
const SHORT_SHA_LENGTH = 7;

/** Every difference between upstream and the pin, in a fixed order. */
export function findSignals({
  pin,
  upstream,
}: {
  /** The pin to compare against. */
  pin: SpecPin;

  /** The upstream state. */
  upstream: UpstreamState;
}): Signal[] {
  const { fullName } = upstream;
  const scope = encodeURIComponent(pin.repo);
  const candidateSignals = findCandidateSignals({ pin, upstream });

  if (fullName === undefined) {
    return [
      {
        key: `gone:${scope}`,
        kind: "gone",
        text: `- **\`${pin.repo}\` is gone**, or the workflow's token can no longer see it.`,
      },
      ...upstream.foundHomes.map((home) => findHomeSignal(home)),
      ...candidateSignals,
    ];
  }

  return [
    ...(fullName.toLowerCase() === pin.repo.toLowerCase()
      ? []
      : [
          {
            key: `renamed:${scope}:${encodeURIComponent(fullName)}`,
            kind: "renamed" as const,
            text: `- **\`${pin.repo}\` is now \`${fullName}\`.**`,
          },
        ]),
    ...(upstream.isArchived
      ? [
          {
            key: `archived:${scope}`,
            kind: "archived" as const,
            text: `- **\`${fullName}\` is archived.**`,
          },
        ]
      : []),
    ...findCommitSignals({ fullName, pin, upstream }),
    ...findFileSignals({ pin, scope, upstream }),
    ...upstream.notices.map((notice) => ({
      key: `notice:${hashText(`${pin.repo}\n${notice.file}\n${notice.line}`)}`,
      kind: "notice" as const,
      text: `- **The ${NOTICE_FILE_NAMES[notice.file]} gained a line that may be a deprecation notice:** ${toCodeSpan(notice.line)}`,
    })),
    ...upstream.foundHomes.map((home) => findHomeSignal(home)),
    ...upstream.releases.map((release) => ({
      key: `release:${scope}:${encodeURIComponent(release.tag)}`,
      kind: "release" as const,
      text: `- **Release [${toCodeSpan(release.name === "" ? release.tag : release.name)}](https://github.com/${fullName}/releases/tag/${encodeUrlPart(release.tag)}) is published** from tag ${toCodeSpan(release.tag)}.`,
    })),
    ...upstream.tags.map((tag) => ({
      key: `tag:${scope}:${encodeURIComponent(tag)}`,
      kind: "tag" as const,
      text: `- **\`${fullName}\` has tag ${toCodeSpan(tag)}**, with no release.`,
    })),
    ...upstream.pullRequests.map((pullRequest) => ({
      key: `pr:${scope}:${pullRequest.number}`,
      kind: "pull-request" as const,
      text: `  - \`#${pullRequest.number}\` ${toCodeSpan(pullRequest.title)}`,
    })),
    ...candidateSignals,
  ];
}

/** The signal keys every earlier spec-watch issue body reported. */
export function readReportedKeys(bodies: string[]): Set<string> {
  const keys = new Set<string>();

  for (const body of bodies) {
    const marker = MARKER_PATTERN.exec(body)?.[0] ?? MARKER_OPEN + MARKER_CLOSE;

    for (const key of marker
      .slice(MARKER_OPEN.length, -MARKER_CLOSE.length)
      .split(" ")) {
      if (key !== "") {
        keys.add(key);
      }
    }
  }

  return keys;
}

/** The issue that reports new signals. */
export function renderIssue({
  allSignals,
  headSha,
  newSignals,
  pin,
  runUrl,
}: {
  /** Every current signal, whose keys the marker records. */
  allSignals: Signal[];

  /** The newest upstream commit to the spec, when there is one. */
  headSha: string | undefined;

  /** The signals no earlier issue reported, which the body lists. */
  newSignals: Signal[];

  /** The pin they were compared against. */
  pin: SpecPin;

  /** The workflow run's page, when running in Actions. */
  runUrl: string | undefined;
}): SpecIssue {
  const shortSha = (headSha ?? pin.sha).slice(0, SHORT_SHA_LENGTH);
  const watch =
    runUrl === undefined
      ? "the spec-watch workflow"
      : `the [spec-watch workflow](${runUrl})`;
  const body = [
    `${MARKER_OPEN}${allSignals.map((signal) => signal.key).join(" ")}${MARKER_CLOSE}`,
    "",
    `> **🔭 Spec watch**: opened by ${watch}, which compares the upstream OKF spec against the pin in \`spec/upstream.json\`. It lists only what no earlier spec-watch issue reported.`,
    "",
    "## 🏷️ What changed upstream",
    "",
    ...renderSignals({ pin, signals: newSignals }),
    "",
    "## 🛠️ Next steps",
    "",
    "- Read the change and decide whether okf-tools follows it.",
    "- The PR that closes this issue bumps `spec/upstream.json`, as `AGENTS.md` says.",
    "",
  ].join("\n");

  return {
    body,
    title: `chore(spec): 🧹 review the upstream okf spec at ${shortSha}`,
  };
}

/** The push's one-line message: what kinds of change are new. */
export function summarizeSignals(signals: Signal[]): string {
  const summaries = [
    ...new Set(signals.map((signal) => SUMMARIES[signal.kind])),
  ];
  const sentence = summaries.join(", ");

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/*
 * Encode upstream text for a URL in a Markdown link.
 *
 * - `encodeURIComponent` leaves `(` and `)` alone, and either would end or
 *   nest the link, so they and the other marks it skips are encoded too.
 */
function encodeUrlPart(text: string): string {
  return encodeURIComponent(text).replaceAll(
    /[!'()*]/gu,
    (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/*
 * The signals about the candidate homes: each public one, and its spec's
 * version when it differs from the pin's.
 */
function findCandidateSignals({
  pin,
  upstream,
}: {
  pin: SpecPin;
  upstream: UpstreamState;
}): Signal[] {
  return upstream.publicCandidates.flatMap(({ repo, spec }) => [
    {
      key: `public:${encodeURIComponent(repo)}`,
      kind: "public" as const,
      text: `- **Candidate home [\`${repo}\`](https://github.com/${repo}) is public.**`,
    },
    ...(spec === undefined || spec.version === pin.version
      ? []
      : [
          {
            key: `candidate-version:${encodeURIComponent(repo)}:${encodeURIComponent(spec.version)}`,
            kind: "candidate-version" as const,
            text: `- **Candidate home \`${repo}\`'s spec, \`${spec.path}\`, reads version ${toCodeSpan(spec.version)}**; the pin reads \`${pin.version}\`.`,
          },
        ]),
  ]);
}

/** The signals about the spec's commits: new commits since the pin. */
function findCommitSignals({
  fullName,
  pin,
  upstream,
}: {
  fullName: string;
  pin: SpecPin;
  upstream: UpstreamState;
}): Signal[] {
  const { commits, headSha, isPinFound } = upstream;

  if (headSha === undefined || headSha === pin.sha) {
    return [];
  }

  const shortPin = pin.sha.slice(0, SHORT_SHA_LENGTH);
  const compareUrl = `https://github.com/${fullName}/compare/${pin.sha}...${headSha}`;
  const lines = [
    `- **${commits.length} new ${commits.length === 1 ? "commit" : "commits"} to \`${pin.path}\`** since the pin \`${shortPin}\` ([compare](${compareUrl})):`,
    ...commits.map(
      (commit) =>
        `  - [\`${commit.sha.slice(0, SHORT_SHA_LENGTH)}\`](${commit.url}) ${toCodeSpan(commit.subject)} (${commit.date})`
    ),
    ...(isPinFound
      ? []
      : [
          "  - The pin isn't among these commits, so the list may start before it, or stop short of it.",
        ]),
  ];

  return [{ key: `sha:${headSha}`, kind: "commits", text: lines.join("\n") }];
}

/** The signals about the spec's file at its newest commit. */
function findFileSignals({
  pin,
  scope,
  upstream,
}: {
  pin: SpecPin;
  scope: string;
  upstream: UpstreamState;
}): Signal[] {
  const { headSha, isSpecMissing, version } = upstream;

  if (isSpecMissing) {
    return [
      {
        key: `missing:${scope}:${headSha ?? "none"}`,
        kind: "missing",
        text: `- **\`${pin.path}\` is missing** at the newest commit to it.`,
      },
    ];
  }

  if (version === pin.version) {
    return [];
  }

  const versionSignal: Signal = {
    key: `version:${scope}:${encodeURIComponent(version ?? "none")}`,
    kind: "version",
    text:
      version === undefined
        ? `- **\`${pin.path}\` has no \`**Version …**\` line**; the pin reads \`${pin.version}\`.`
        : `- **The version line reads ${toCodeSpan(version)}**; the pin reads \`${pin.version}\`.`,
  };
  const isDraft = version !== undefined && DRAFT_PATTERN.test(version);

  if (version === undefined || isDraft === DRAFT_PATTERN.test(pin.version)) {
    return [versionSignal];
  }

  return [
    versionSignal,
    {
      key: `draft:${scope}:${encodeURIComponent(version)}`,
      kind: "draft",
      text: `- **The version line ${isDraft ? "gained" : "lost"} its \`(draft)\` suffix.**`,
    },
  ];
}

/*
 * The signals about a repo outside the pin that holds a spec: linked from a
 * notice, or new beside the home.
 */
function findHomeSignal(home: FoundHome): Signal {
  const { linkedFrom, repo, spec } = home;
  const link = `[\`${repo}\`](https://github.com/${repo})`;
  const holds = `\`${spec.path}\` reads version ${toCodeSpan(spec.version)}.`;

  return linkedFrom === undefined
    ? {
        key: `sibling:${encodeURIComponent(repo)}`,
        kind: "sibling",
        text: `- **New repo ${link}, beside the home, holds a spec:** ${holds}`,
      }
    : {
        key: `linked:${encodeURIComponent(repo)}`,
        kind: "linked",
        text: `- **A notice in \`${linkedFrom}\` links to ${link}, which holds a spec:** ${holds}`,
      };
}

/** A short, stable hash of a text, for a key that must not hold the text. */
function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/*
 * The issue's bullets, one per signal.
 *
 * - Pull requests are sub-bullets, under one lead bullet before the first.
 */
function renderSignals({
  pin,
  signals,
}: {
  pin: SpecPin;
  signals: Signal[];
}): string[] {
  const firstPullRequest = signals.findIndex(
    (signal) => signal.kind === "pull-request"
  );

  return signals.flatMap((signal, index) =>
    index === firstPullRequest
      ? [
          `- **Open upstream pull requests touch \`${pin.path}\`** ([all open pull requests](https://github.com/${pin.repo}/pulls)):`,
          signal.text,
        ]
      : [signal.text]
  );
}

/** Wrap upstream text in a code span, so nothing in it links or mentions. */
function toCodeSpan(text: string): string {
  const flat = text.replaceAll(/\s+/gu, " ").replaceAll("`", "'").trim();

  return flat === "" ? "_(empty)_" : `\`${flat}\``;
}
