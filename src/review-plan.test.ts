import { describe, expect, test } from "vitest";

import type { CheckFinding } from "./check-engine.ts";
import type { ReviewThread } from "./review-plan.ts";

import {
  planReviewComments,
  readReviewThread,
  wordComment,
} from "./review-plan.ts";

/** A blob the fabricated record holds at the head. */
const BLOB = "aaaa1111";

/** The head commit the fabricated run checked. */
const HEAD = "e8da3644c0b1";

/** A draft finding on the fabricated record. */
const DRAFT: CheckFinding = {
  code: "T001",
  line: 3,
  message:
    "the record is a draft, and human:a's sign-off at 2026-10-02T15:00:00Z no longer counts, since generated.at is later (§5.3); okf verify signs it off again",
  path: "kb/a.md",
  rule: "draft",
  severity: "info",
};

/** A thread as `readReviewThread` reads it. */
function thread(params: Partial<ReviewThread>): ReviewThread {
  const blob = params.blob ?? BLOB;

  return {
    blob,
    code: "T001",
    commentBody: wordComment({ blob, finding: DRAFT }),
    commentId: 7,
    id: "T1",
    isResolved: false,
    path: "kb/a.md",
    ...params,
  };
}

/** A review thread node, as GitHub's GraphQL API answers with it. */
function threadNode(params: {
  /** The blob its marker names. @example "aaaa1111" */
  blob?: string;

  /** Its first comment's text, when not the draft's. @example "x" */
  body?: string;

  /** Its node ID. @example "T2" */
  id?: string;

  /** Whether it's resolved. @example true */
  isResolved?: boolean;

  /** Who made its first comment. @example "github-actions" */
  login?: string;
}): unknown {
  const {
    blob = BLOB,
    body = wordComment({ blob, finding: DRAFT }),
    id = "T1",
    isResolved = false,
    login = "github-actions",
  } = params;

  return {
    comments: { nodes: [{ author: { login }, body, databaseId: 7 }] },
    id,
    isResolved,
  };
}

describe("wordComment", () => {
  const SPEC =
    "https://github.com/open-knowledge-format/open-knowledge-format/blob/527e81aff55992be21507e97004286789126f88c/SPEC.md";
  const TRUST = "https://github.com/jjloneman/okf-tools#-trust-rules";

  test("lays a draft out in an alert, with its two steps", () => {
    // When - wording a draft
    const body = wordComment({ blob: BLOB, finding: DRAFT });

    // Then - an important alert, the code linked, and the marker after it
    expect(body.split("\n")).toStrictEqual([
      "> [!IMPORTANT]",
      `> **[\`T001\`](${TRUST}) draft** · info`,
      ">",
      `> The record is a draft, and \`human:a\`'s sign-off at \`2026-10-02T15:00:00Z\` no longer counts, since \`generated.at\` is later ([§5.3](${SPEC})).`,
      ">",
      "> **What to do**, one or the other:",
      ">",
      "> - **Sign it off:** `okf verify` signs it off again, and the next run resolves this thread.",
      "> - **Or merge it as a draft:** resolve this thread yourself to acknowledge it. It stays resolved until the record changes again.",
      "",
      "<!-- okf-check: kb%2Fa.md T001 aaaa1111 -->",
    ]);
  });

  test.each([
    { alert: "> [!WARNING]", severity: "warning" as const },
    { alert: "> [!CAUTION]", severity: "error" as const },
  ])("picks $alert for a $severity", ({ alert, severity }) => {
    // When/Then - the alert by severity
    expect(
      wordComment({ blob: BLOB, finding: { ...DRAFT, severity } }).split(
        "\n"
      )[0]
    ).toBe(alert);
  });

  test("lists the clauses between the summary and what to do, linking codes", () => {
    // Given - a draft with two clauses in the middle, one naming a code
    const finding: CheckFinding = {
      ...DRAFT,
      code: "H002",
      message:
        "the record is a draft; its text changed, as W101 found; generated.by is new; okf verify signs it off",
    };

    // When/Then - each as a bullet, every code linked to its rules
    expect(
      wordComment({ blob: BLOB, finding }).split("\n").slice(1, 8)
    ).toStrictEqual([
      "> **[`H002`](https://github.com/jjloneman/okf-tools#-house-rules) draft** · info",
      ">",
      "> The record is a draft.",
      ">",
      "> - Its text changed, as [`W101`](https://github.com/jjloneman/okf-tools#-rules) found.",
      "> - `generated.by` is new.",
      ">",
    ]);
  });

  test("keeps a record's text from mentioning anyone or opening a comment", () => {
    // Given - a message quoting a record's own text, with no command
    const finding = { ...DRAFT, message: "by @someone <!-- okf-check: x -->" };

    // When - wording it
    const lines = wordComment({ blob: BLOB, finding }).split("\n");

    // Then - the mention and the comment defused, and only the draft step
    expect(lines.slice(3, 6)).toStrictEqual([
      "> By @\u200Bsomeone &lt;!-- okf-check: x -->.",
      ">",
      "> **What to do:** resolve this thread yourself to acknowledge it. It stays resolved until the record changes again.",
    ]);
  });
});

describe("readReviewThread", () => {
  test.each([
    { description: "a workflow's login", login: "github-actions" },
    { description: "a REST bot login", login: "github-actions[bot]" },
  ])("reads a comment made with $description", ({ login }) => {
    // When/Then - the thread, its path decoded
    expect(readReviewThread(threadNode({ login }))).toStrictEqual(thread({}));
  });

  test.each([
    { description: "someone else's comment", node: threadNode({ login: "x" }) },
    {
      description: "a comment with no marker",
      node: threadNode({ body: "x" }),
    },
    { description: "a node with no comments", node: { id: "T1" } },
    {
      description: "a node with no resolved state",
      node: { ...(threadNode({}) as object), isResolved: "no" },
    },
    { description: "a value that isn't a node", node: [] },
    {
      description: "a marker whose path isn't valid percent-encoding",
      node: threadNode({ body: "x\n<!-- okf-check: %E0 T001 abc -->" }),
    },
  ])("skips $description", ({ node }) => {
    // When/Then - nothing
    expect(readReviewThread(node)).toBeUndefined();
  });
});

describe("planReviewComments", () => {
  const files = new Map([["kb/a.md", BLOB]]);

  test("posts a draft no thread names", () => {
    // When/Then - a new comment
    expect(
      planReviewComments({
        commitId: HEAD,
        drafts: [DRAFT],
        files,
        threads: [],
      })
    ).toStrictEqual([
      {
        body: wordComment({ blob: BLOB, finding: DRAFT }),
        finding: DRAFT,
        kind: "create",
      },
    ]);
  });

  test.each([
    { description: "an open thread", isResolved: false },
    { description: "a resolved thread", isResolved: true },
  ])("keeps $description for the same blob as it is", ({ isResolved }) => {
    // When/Then - nothing to do
    expect(
      planReviewComments({
        commitId: HEAD,
        drafts: [DRAFT],
        files,
        threads: [thread({ isResolved })],
      })
    ).toStrictEqual([]);
  });

  test("edits a thread for the same blob when the wording changed", () => {
    // When/Then - an edit to the current wording
    expect(
      planReviewComments({
        commitId: HEAD,
        drafts: [DRAFT],
        files,
        threads: [thread({ commentBody: "old wording" })],
      })
    ).toStrictEqual([
      {
        body: wordComment({ blob: BLOB, finding: DRAFT }),
        commentId: 7,
        finding: DRAFT,
        kind: "update",
      },
    ]);
  });

  test("edits an open thread for an older blob, and resolves a stray one", () => {
    // Given - two open threads for older blobs
    const threads = [
      thread({ blob: "bbbb", id: "T1" }),
      thread({ blob: "cccc", commentId: 8, id: "T2" }),
    ];

    // When - planning
    const actions = planReviewComments({
      commitId: HEAD,
      drafts: [DRAFT],
      files,
      threads,
    });

    // Then - the newer one edited, the other resolved and released
    expect(actions.map(({ kind }) => kind)).toStrictEqual([
      "update",
      "resolve",
    ]);
    expect(actions[0]).toMatchObject({ commentId: 8 });
    expect(actions[1]).toMatchObject({
      body: expect.stringMatching(
        /^> \[!NOTE\]\n> ↪️ \*\*Superseded\*\* at `e8da364`[\s\S]*<!-- okf-check: kb%2Fa\.md T001 0 -->$/u
      ) as unknown,
      threadId: "T1",
    });
  });

  test("posts again when every thread for an older blob is resolved", () => {
    // When/Then - a new comment
    expect(
      planReviewComments({
        commitId: HEAD,
        drafts: [DRAFT],
        files,
        threads: [thread({ blob: "bbbb", isResolved: true })],
      }).map(({ kind }) => kind)
    ).toStrictEqual(["create"]);
  });

  test("annotates a draft outside the diff, leaving its thread open", () => {
    // When/Then - an annotation, and no resolve
    expect(
      planReviewComments({
        commitId: HEAD,
        drafts: [DRAFT],
        files: new Map(),
        threads: [thread({})],
      })
    ).toStrictEqual([{ finding: DRAFT, kind: "annotate" }]);
  });

  test("resolves an open thread whose draft is gone, and leaves a resolved one", () => {
    // When/Then - only the open one resolved
    expect(
      planReviewComments({
        commitId: HEAD,
        drafts: [],
        files,
        threads: [thread({ id: "T1" }), thread({ id: "T2", isResolved: true })],
      }).map((action) => action.kind === "resolve" && action.threadId)
    ).toStrictEqual(["T1"]);
  });

  test("words a thread whose draft is gone as resolved, the sign-off struck out", () => {
    // When - its draft is no longer reported
    const [action] = planReviewComments({
      commitId: HEAD,
      drafts: [],
      files,
      threads: [thread({})],
    });

    // Then - a note on top, then the finding out of its alert
    expect(action?.kind === "resolve" && action.body.split("\n")).toStrictEqual(
      [
        "> [!NOTE]",
        "> ✅ **Resolved by `okf check`** at `e8da364`: the record is no longer reported as a draft.",
        "",
        "**[`T001`](https://github.com/jjloneman/okf-tools#-trust-rules) draft** · info",
        "",
        expect.stringMatching(/^The record is a draft/u) as unknown,
        "",
        "**What to do**, one or the other:",
        "",
        "- ~~**Sign it off:** `okf verify` signs it off again, and the next run resolves this thread.~~",
        "- **Or merge it as a draft:** resolve this thread yourself to acknowledge it. It stays resolved until the record changes again.",
        "",
        "<!-- okf-check: kb%2Fa.md T001 0 -->",
      ]
    );
  });
});
