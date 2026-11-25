import { describe, expect, test } from "vitest";

import { HEAD_SHA, PIN, PIN_SHA } from "#test/spec-watch";

import type { Signal } from "./signals.ts";
import type { UpstreamState } from "./upstream.ts";

import {
  findSignals,
  readReportedKeys,
  renderIssue,
  summarizeSignals,
} from "./signals.ts";

/** A commit to the spec, with the given SHA and subject. */
function makeCommit({
  sha,
  subject,
}: {
  /** The commit's full SHA. */
  sha: string;

  /** The first line of its message. */
  subject: string;
}): UpstreamState["commits"][number] {
  return {
    date: "2026-08-21T10:00:00Z",
    sha,
    subject,
    url: `https://github.com/acme/spec/commit/${sha}`,
  };
}

/** An upstream that matches the pin, with the given fields changed. */
function makeUpstream(changes: Partial<UpstreamState> = {}): UpstreamState {
  return {
    commits: [],
    foundHomes: [],
    fullName: "acme/spec",
    headSha: PIN_SHA,
    isArchived: false,
    isPinFound: true,
    isSpecMissing: false,
    notices: [],
    publicCandidates: [],
    pullRequests: [],
    releases: [],
    tags: [],
    version: "0.2",
    ...changes,
  };
}

describe("findSignals", () => {
  test("finds nothing when upstream matches the pin", () => {
    // Given - an upstream at the pin, named in another case
    const upstream = makeUpstream({ fullName: "Acme/Spec" });

    // When - finding signals
    const signals = findSignals({ pin: PIN, upstream });

    // Then - none
    expect(signals).toStrictEqual([]);
  });

  test("reports that the repo is gone, then any found home and public candidate", () => {
    // Given - a repo that no longer exists, a repo beside it with a spec, and
    // a candidate home that is public
    const upstream = makeUpstream({
      foundHomes: [
        {
          linkedFrom: undefined,
          repo: "acme/sibling",
          spec: { path: "SPEC.md", version: "0.3" },
        },
      ],
      fullName: undefined,
      isArchived: true,
      publicCandidates: [{ repo: "acme/next-home", spec: undefined }],
    });

    // When - finding signals
    const signals = findSignals({ pin: PIN, upstream });

    // Then - the gone signal, then the found home's, then the candidate's
    expect(signals).toStrictEqual([
      {
        key: "gone:acme%2Fspec",
        kind: "gone",
        text: "- **`acme/spec` is gone**, or the workflow's token can no longer see it.",
      },
      {
        key: "sibling:acme%2Fsibling",
        kind: "sibling",
        text: "- **New repo [`acme/sibling`](https://github.com/acme/sibling), beside the home, holds a spec:** `SPEC.md` reads version `0.3`.",
      },
      {
        key: "public:acme%2Fnext-home",
        kind: "public",
        text: "- **Candidate home [`acme/next-home`](https://github.com/acme/next-home) is public.**",
      },
    ]);
  });

  test("reports only that the repo is gone when no candidate is public", () => {
    // Given - a repo that no longer exists, and no public candidate
    const upstream = makeUpstream({ fullName: undefined });

    // When - finding signals
    const signals = findSignals({ pin: PIN, upstream });

    // Then - the one gone signal
    expect(signals.map((signal) => signal.key)).toStrictEqual([
      "gone:acme%2Fspec",
    ]);
  });

  test("scopes the keys by the watched repo", () => {
    // Given - the same pull request number in two watched repos
    const upstream = makeUpstream({
      pullRequests: [{ number: 4, title: "A" }],
    });
    const otherPin = { ...PIN, repo: "other/spec" };

    // When - finding signals for each
    const first = findSignals({ pin: PIN, upstream });
    const second = findSignals({
      pin: otherPin,
      upstream: { ...upstream, fullName: "other/spec" },
    });

    // Then - different keys
    expect(first.map((signal) => signal.key)).toStrictEqual([
      "pr:acme%2Fspec:4",
    ]);
    expect(second.map((signal) => signal.key)).toStrictEqual([
      "pr:other%2Fspec:4",
    ]);
  });

  test("reports every kind of change, in a fixed order", () => {
    // Given - an upstream that changed in every way
    const upstream = makeUpstream({
      commits: [makeCommit({ sha: HEAD_SHA, subject: "Use `x`\tnow  " })],
      fullName: "acme/spec-renamed",
      headSha: HEAD_SHA,
      isArchived: true,
      notices: [
        { file: "README", line: "Deprecated.", repos: [] },
        { file: "SPEC", line: "Moved to @someone.", repos: [] },
      ],
      publicCandidates: [{ repo: "acme/next-home", spec: undefined }],
      pullRequests: [{ number: 4, title: "" }],
      version: "0.3",
    });

    // When - finding signals
    const signals = findSignals({ pin: PIN, upstream });

    // Then - one signal each, with upstream text in code spans
    expect(signals).toStrictEqual([
      {
        key: "renamed:acme%2Fspec:acme%2Fspec-renamed",
        kind: "renamed",
        text: "- **`acme/spec` is now `acme/spec-renamed`.**",
      },
      {
        key: "archived:acme%2Fspec",
        kind: "archived",
        text: "- **`acme/spec-renamed` is archived.**",
      },
      {
        key: `sha:${HEAD_SHA}`,
        kind: "commits",
        text: [
          `- **1 new commit to \`okf/SPEC.md\`** since the pin \`1111111\` ([compare](https://github.com/acme/spec-renamed/compare/${PIN_SHA}...${HEAD_SHA})):`,
          `  - [\`2222222\`](https://github.com/acme/spec/commit/${HEAD_SHA}) \`Use 'x' now\` (2026-08-21T10:00:00Z)`,
        ].join("\n"),
      },
      {
        key: "version:acme%2Fspec:0.3",
        kind: "version",
        text: "- **The version line reads `0.3`**; the pin reads `0.2`.",
      },
      {
        key: expect.stringMatching(/^notice:[0-9a-f]{12}$/u) as unknown,
        kind: "notice",
        text: "- **The README gained a line that may be a deprecation notice:** `Deprecated.`",
      },
      {
        key: expect.stringMatching(/^notice:[0-9a-f]{12}$/u) as unknown,
        kind: "notice",
        text: "- **The spec gained a line that may be a deprecation notice:** `Moved to @someone.`",
      },
      {
        key: "pr:acme%2Fspec:4",
        kind: "pull-request",
        text: "  - `#4` _(empty)_",
      },
      {
        key: "public:acme%2Fnext-home",
        kind: "public",
        text: "- **Candidate home [`acme/next-home`](https://github.com/acme/next-home) is public.**",
      },
    ]);
  });

  test("counts several commits, and notes a list cut short", () => {
    // Given - two new commits that don't reach the pin
    const upstream = makeUpstream({
      commits: [
        makeCommit({ sha: HEAD_SHA, subject: "Second" }),
        makeCommit({ sha: "3".repeat(40), subject: "First" }),
      ],
      headSha: HEAD_SHA,
      isPinFound: false,
    });

    // When - finding signals
    const [signal] = findSignals({ pin: PIN, upstream });

    // Then - the plural, and the note
    expect(signal?.text).toContain("**2 new commits to `okf/SPEC.md`**");
    expect(signal?.text).toContain(
      "  - The pin isn't among these commits, so the list may start before it, or stop short of it."
    );
  });

  test("names the spec folder's README in its notice", () => {
    // Given - a notice in the README beside the spec
    const upstream = makeUpstream({
      notices: [{ file: "FOLDER_README", line: "Frozen.", repos: [] }],
    });

    // When - finding signals
    const [signal] = findSignals({ pin: PIN, upstream });

    // Then - the folder's README, by name
    expect(signal?.text).toBe(
      "- **The spec folder's README gained a line that may be a deprecation notice:** `Frozen.`"
    );
  });

  test("keeps the same notice key on every run, and a distinct one per file", () => {
    // Given - the same line in two files
    const upstream = makeUpstream({
      notices: [
        { file: "README", line: "Deprecated.", repos: [] },
        { file: "SPEC", line: "Deprecated.", repos: [] },
      ],
    });

    // When - finding signals twice
    const first = findSignals({ pin: PIN, upstream });
    const second = findSignals({ pin: PIN, upstream });

    // Then - stable keys, different per file
    expect(first.map((signal) => signal.key)).toStrictEqual(
      second.map((signal) => signal.key)
    );
    expect(first[0]?.key).not.toBe(first[1]?.key);
  });

  test.each([
    {
      description: "a missing spec at the newest commit",
      expected: {
        key: `missing:acme%2Fspec:${PIN_SHA}`,
        kind: "missing",
        text: "- **`okf/SPEC.md` is missing** at the newest commit to it.",
      },
      upstream: makeUpstream({
        isSpecMissing: true,
        version: undefined,
      }),
    },
    {
      description: "a missing spec with no commits",
      expected: {
        key: "missing:acme%2Fspec:none",
        kind: "missing",
        text: "- **`okf/SPEC.md` is missing** at the newest commit to it.",
      },
      upstream: makeUpstream({
        headSha: undefined,
        isSpecMissing: true,
        version: undefined,
      }),
    },
    {
      description: "a spec with no version line",
      expected: {
        key: "version:acme%2Fspec:none",
        kind: "version",
        text: "- **`okf/SPEC.md` has no `**Version …**` line**; the pin reads `0.2`.",
      },
      upstream: makeUpstream({ version: undefined }),
    },
  ])("reports $description", ({ expected, upstream }) => {
    // Given - an upstream whose spec file changed

    // When - finding signals
    const signals = findSignals({ pin: PIN, upstream });

    // Then - the one file signal
    expect(signals).toStrictEqual([expected]);
  });

  test.each([
    {
      description: "gained",
      pinVersion: "0.2",
      version: "0.3 (draft)",
    },
    {
      description: "lost",
      pinVersion: "0.3 (Draft)",
      version: "0.3",
    },
  ])(
    "reports a version line that $description its draft suffix",
    ({ description, pinVersion, version }) => {
      // Given - a version line whose draft suffix changed
      const pin = { ...PIN, version: pinVersion };
      const upstream = makeUpstream({ version });

      // When - finding signals
      const signals = findSignals({ pin, upstream });

      // Then - the version signal, then the draft one
      expect(signals.map((signal) => signal.kind)).toStrictEqual([
        "version",
        "draft",
      ]);
      expect(signals[1]).toStrictEqual({
        key: `draft:acme%2Fspec:${encodeURIComponent(version)}`,
        kind: "draft",
        text: `- **The version line ${description} its \`(draft)\` suffix.**`,
      });
    }
  );

  test("reports no draft change when both versions are drafts", () => {
    // Given - a draft pin and a newer draft
    const pin = { ...PIN, version: "0.2 (draft)" };
    const upstream = makeUpstream({ version: "0.3 (draft)" });

    // When - finding signals
    const signals = findSignals({ pin, upstream });

    // Then - only the version signal
    expect(signals.map((signal) => signal.kind)).toStrictEqual(["version"]);
  });

  test("reports found homes, releases, tags, and candidates' versions", () => {
    // Given - a linked home, a sibling, a release with a title and one
    // untitled, whose tag holds marks that would break a link,
    // a tag, and candidates at the pin's version, at another, and with none
    const upstream = makeUpstream({
      foundHomes: [
        {
          linkedFrom: "acme/spec",
          repo: "acme/moved",
          spec: { path: "SPEC.md", version: "0.4" },
        },
        {
          linkedFrom: undefined,
          repo: "acme/sibling",
          spec: { path: "okf/SPEC.md", version: "0.3" },
        },
      ],
      publicCandidates: [
        { repo: "acme/same", spec: { path: "okf/SPEC.md", version: "0.2" } },
        { repo: "acme/newer", spec: { path: "SPEC.md", version: "0.3" } },
      ],
      releases: [
        { name: "OKF v0.3", tag: "v0.3" },
        { name: "", tag: "rc(1)'!*" },
      ],
      tags: ["v0.2"],
    });

    // When - finding signals
    const signals = findSignals({ pin: PIN, upstream });

    // Then - one signal each, candidates last
    expect(signals).toStrictEqual([
      {
        key: "linked:acme%2Fmoved",
        kind: "linked",
        text: "- **A notice in `acme/spec` links to [`acme/moved`](https://github.com/acme/moved), which holds a spec:** `SPEC.md` reads version `0.4`.",
      },
      {
        key: "sibling:acme%2Fsibling",
        kind: "sibling",
        text: "- **New repo [`acme/sibling`](https://github.com/acme/sibling), beside the home, holds a spec:** `okf/SPEC.md` reads version `0.3`.",
      },
      {
        key: "release:acme%2Fspec:v0.3",
        kind: "release",
        text: "- **Release [`OKF v0.3`](https://github.com/acme/spec/releases/tag/v0.3) is published** from tag `v0.3`.",
      },
      {
        key: "release:acme%2Fspec:rc(1)'!*",
        kind: "release",
        text: "- **Release [`rc(1)'!*`](https://github.com/acme/spec/releases/tag/rc%281%29%27%21%2A) is published** from tag `rc(1)'!*`.",
      },
      {
        key: "tag:acme%2Fspec:v0.2",
        kind: "tag",
        text: "- **`acme/spec` has tag `v0.2`**, with no release.",
      },
      {
        key: "public:acme%2Fsame",
        kind: "public",
        text: "- **Candidate home [`acme/same`](https://github.com/acme/same) is public.**",
      },
      {
        key: "public:acme%2Fnewer",
        kind: "public",
        text: "- **Candidate home [`acme/newer`](https://github.com/acme/newer) is public.**",
      },
      {
        key: "candidate-version:acme%2Fnewer:0.3",
        kind: "candidate-version",
        text: "- **Candidate home `acme/newer`'s spec, `SPEC.md`, reads version `0.3`**; the pin reads `0.2`.",
      },
    ]);
  });
});

describe("readReportedKeys", () => {
  test("collects the keys of each body's leading marker", () => {
    // Given - bodies with markers, extra spaces, an empty marker, and none
    const bodies = [
      "<!-- spec-watch: archived  sha:abc -->\nText",
      "<!-- spec-watch:  -->\nText",
      "<!-- spec-watch: pr:4 -->",
      "No marker here.",
    ];

    // When - reading the keys
    const keys = readReportedKeys(bodies);

    // Then - each key once
    expect([...keys]).toStrictEqual(["archived", "sha:abc", "pr:4"]);
  });

  test("ignores a marker that isn't at the start of the body", () => {
    // Given - markers after a first line, and inside a pull request title's
    // code span
    const bodies = [
      "Text\n<!-- spec-watch: forged:1 -->",
      "<!-- spec-watch: real:1 -->\n  - `#4` `<!-- spec-watch: forged:2 -->`",
      "`<!-- spec-watch: forged:3 -->`",
    ];

    // When - reading the keys
    const keys = readReportedKeys(bodies);

    // Then - only the leading marker's
    expect([...keys]).toStrictEqual(["real:1"]);
  });

  test("reads nothing from a body with no marker", () => {
    // Given - a body with no marker
    const bodies = ["No marker here."];

    // When - reading the keys
    const keys = readReportedKeys(bodies);

    // Then - none
    expect(keys.size).toBe(0);
  });
});

describe("renderIssue", () => {
  /** Signals of several kinds, with two pull requests after another kind. */
  const SIGNALS: Signal[] = [
    { key: "archived", kind: "archived", text: "- **Archived.**" },
    { key: "pr:4", kind: "pull-request", text: "  - `#4` `A`" },
    { key: "pr:9", kind: "pull-request", text: "  - `#9` `B`" },
  ];

  test("marks every key, lists the new signals, and links the run", () => {
    // Given - one signal reported before, and a run URL
    const newSignals = SIGNALS.slice(1);

    // When - rendering the issue
    const issue = renderIssue({
      allSignals: SIGNALS,
      headSha: HEAD_SHA,
      newSignals,
      pin: PIN,
      runUrl: "https://github.com/acme/tools/actions/runs/5",
    });

    // Then - the head's short SHA, every key, and one lead bullet for the pull
    // requests
    expect(issue).toStrictEqual({
      body: [
        "<!-- spec-watch: archived pr:4 pr:9 -->",
        "",
        "> **🔭 Spec watch**: opened by the [spec-watch workflow](https://github.com/acme/tools/actions/runs/5), which compares the upstream OKF spec against the pin in `spec/upstream.json`. It lists only what no earlier spec-watch issue reported.",
        "",
        "## 🏷️ What changed upstream",
        "",
        "- **Open upstream pull requests touch `okf/SPEC.md`** ([all open pull requests](https://github.com/acme/spec/pulls)):",
        "  - `#4` `A`",
        "  - `#9` `B`",
        "",
        "## 🛠️ Next steps",
        "",
        "- Read the change and decide whether okf-tools follows it.",
        "- The PR that closes this issue bumps `spec/upstream.json`, as `AGENTS.md` says.",
        "",
      ].join("\n"),
      title: "chore(spec): 🧹 review the upstream okf spec at 2222222",
    });
  });

  test("names the pin and the workflow without a head or a run URL", () => {
    // Given - no head commit, no run URL, and no pull requests
    const signals = SIGNALS.slice(0, 1);

    // When - rendering the issue
    const issue = renderIssue({
      allSignals: signals,
      headSha: undefined,
      newSignals: signals,
      pin: PIN,
      runUrl: undefined,
    });

    // Then - the pin's short SHA, the workflow unlinked, no lead bullet
    expect(issue.title).toBe(
      "chore(spec): 🧹 review the upstream okf spec at 1111111"
    );
    expect(issue.body).toContain("opened by the spec-watch workflow, which");
    expect(issue.body).toContain("upstream\n\n- **Archived.**\n\n## 🛠️");
  });
});

describe("summarizeSignals", () => {
  test("names each kind once, capitalized, in order", () => {
    // Given - signals with a repeated kind
    const signals: Signal[] = [
      { key: "pr:4", kind: "pull-request", text: "" },
      { key: "pr:9", kind: "pull-request", text: "" },
      { key: "archived", kind: "archived", text: "" },
    ];

    // When - summarizing them
    const summary = summarizeSignals(signals);

    // Then - one sentence
    expect(summary).toBe(
      "Open pull requests touch the spec, the repo is archived."
    );
  });
});
