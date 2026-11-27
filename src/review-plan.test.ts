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
  blob?: string;
  body?: string;
  id?: string;
  isResolved?: boolean;
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

  test("leads with the code, then the summary, then what to do", () => {
    // When - wording a draft
    const body = wordComment({ blob: BLOB, finding: DRAFT });

    // Then - code set as code, the section linked, and the marker last
    expect(body.split("\n")).toStrictEqual([
      "**📝 `T001` draft** · info",
      "",
      `The record is a draft, and \`human:a\`'s sign-off at \`2026-10-02T15:00:00Z\` no longer counts, since \`generated.at\` is later ([§5.3](${SPEC})).`,
      "",
      "**What to do:**",
      "",
      "- **Sign it off:** `okf verify` signs it off again.",
      "- **Resolve this thread** to acknowledge that the record merges as a draft. It stays resolved until the record changes again.",
      "",
      "<!-- okf-check: kb%2Fa.md T001 aaaa1111 -->",
    ]);
  });

  test("lists the clauses between the summary and what to do", () => {
    // Given - a warning with two clauses in the middle
    const finding: CheckFinding = {
      ...DRAFT,
      message:
        "the record is a draft; its text changed since the base branch; generated.by is new; okf verify signs it off",
      severity: "warning",
    };

    // When/Then - each as a bullet, under a warning's emoji
    expect(
      wordComment({ blob: BLOB, finding }).split("\n").slice(0, 7)
    ).toStrictEqual([
      "**⚠️ `T001` draft** · warning",
      "",
      "The record is a draft.",
      "",
      "- Its text changed since the base branch.",
      "- `generated.by` is new.",
      "",
    ]);
  });

  test("keeps a record's text from mentioning anyone or opening a comment", () => {
    // Given - a message quoting a record's own text, with no command
    const finding = { ...DRAFT, message: "by @someone <!-- okf-check: x -->" };

    // When - wording it
    const lines = wordComment({ blob: BLOB, finding }).split("\n");

    // Then - the mention and the comment defused, and only the resolve step
    expect(lines[2]).toBe("By @\u200Bsomeone &lt;!-- okf-check: x -->.");
    expect(lines.slice(4, 7)).toStrictEqual([
      "**What to do:**",
      "",
      "- **Resolve this thread** to acknowledge that the record merges as a draft. It stays resolved until the record changes again.",
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
      planReviewComments({ drafts: [DRAFT], files, threads: [] })
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
    const actions = planReviewComments({ drafts: [DRAFT], files, threads });

    // Then - the newer one edited, the other resolved and released
    expect(actions.map(({ kind }) => kind)).toStrictEqual([
      "update",
      "resolve",
    ]);
    expect(actions[0]).toMatchObject({ commentId: 8 });
    expect(actions[1]).toMatchObject({
      body: expect.stringMatching(
        /okf check resolved this thread[\s\S]*<!-- okf-check: kb%2Fa\.md T001 0 -->$/u
      ) as unknown,
      threadId: "T1",
    });
  });

  test("posts again when every thread for an older blob is resolved", () => {
    // When/Then - a new comment
    expect(
      planReviewComments({
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
        drafts: [],
        files,
        threads: [thread({ id: "T1" }), thread({ id: "T2", isResolved: true })],
      }).map((action) => action.kind === "resolve" && action.threadId)
    ).toStrictEqual(["T1"]);
  });
});
