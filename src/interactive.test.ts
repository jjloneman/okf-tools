import {
  cancel,
  confirm,
  log,
  multiselect,
  MULTISELECT_INSTRUCTIONS,
  note,
  outro,
  select,
} from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { TestRepo } from "#test/repo";

import {
  createTestRepo,
  draftRecord,
  record,
  verifiedRecord,
} from "#test/repo";

import type { RunContext } from "./run-context.ts";

import { runInteractive } from "./interactive.ts";

/*
 * Stands in for clack's cancel value, which it types as its own
 * `unique symbol` and doesn't export.
 *
 * - Typed `never`, so it fits every prompt's return type.
 */
const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol("cancel") as never }));

// The prompts answer from the test, and `isCancel` recognizes its symbol.
vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: (value: unknown) => value === CANCEL,
  log: { info: vi.fn(), warn: vi.fn() },
  multiselect: vi.fn(),
  MULTISELECT_INSTRUCTIONS: ["Enter: confirm"],
  note: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
}));

const VERIFIED_BY = "human:jjloneman";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo();
  repo.write("docs/decisions/a.md", draftRecord("A"));
  repo.write(
    "docs/decisions/b.md",
    verifiedRecord({ by: VERIFIED_BY, title: "B" })
  );
  repo.write("docs/references/c.md", draftRecord("C"));
  repo.commitAll("add records");
  repo.git("checkout", "--quiet", "-b", "feature");

  // By default the person picks every selectable record and confirms.
  vi.mocked(multiselect).mockImplementation(({ options }) =>
    Promise.resolve(
      options
        .filter((option) => option.disabled !== true)
        .map(({ value }) => value)
    )
  );
  vi.mocked(confirm).mockResolvedValue(true);
});

afterEach(() => {
  repo.remove();
  vi.clearAllMocks();
});

/** The context for both bundles in the scratch repo. */
function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    bundleDirs: ["docs/decisions", "docs/references"],
    cwd: repo.root,
    repoRoot: repo.root,
    shouldCommit: true,
    verifiedBy: VERIFIED_BY,
    ...overrides,
  };
}

describe("runInteractive", () => {
  test("verifies and commits the chosen records, after showing them", async () => {
    // Given - nothing changed on the branch
    // When - running and accepting every prompt
    const code = await runInteractive(context());

    // Then - every record listed, the drafts committed together
    expect(code).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      "No records changed on this branch; showing every record."
    );
    expect(vi.mocked(multiselect).mock.calls[0]?.[0].options).toStrictEqual([
      expect.objectContaining({
        disabled: false,
        hint: "draft",
        label: "A — a.md",
      }),
      expect.objectContaining({
        disabled: true,
        hint: "already verified, unchanged",
        label: "B — b.md",
      }),
      expect.objectContaining({
        disabled: false,
        hint: "draft",
        label: "C — c.md",
      }),
    ]);
    expect(note).toHaveBeenCalledWith(
      expect.stringContaining(
        "docs/decisions/a.md\ndocs/references/c.md\n\ndocs(okf):"
      ),
      "Files and commit message"
    );
    expect(outro).toHaveBeenCalledWith(
      expect.stringMatching(/^Verified 2, committed [0-9a-f]+\.$/u)
    );
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  test("lists the toggle-all key only while the checklist is open", async () => {
    // Given - a checklist that records the legend it sees
    let legend: string[] = [];
    vi.mocked(multiselect).mockImplementation(() => {
      legend = [...MULTISELECT_INSTRUCTIONS];

      return Promise.resolve(CANCEL);
    });

    // When - running
    await runInteractive(context());

    // Then - the key before Enter during the prompt, and gone after
    expect(legend).toStrictEqual([
      expect.stringContaining("toggle all"),
      "Enter: confirm",
    ]);
    expect(MULTISELECT_INSTRUCTIONS).toStrictEqual(["Enter: confirm"]);
  });

  test.each([
    { description: "every record", expected: 3, scope: "all" },
    { description: "the changed ones", expected: 1, scope: "changed" },
  ])(
    "asks for the scope when only some changed, and shows $description",
    async ({ expected, scope }) => {
      // Given - one record changed on the branch, and the person's scope
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
      vi.mocked(select).mockResolvedValue(scope);

      // When - running
      await runInteractive(context());

      // Then - that many records listed
      expect(vi.mocked(multiselect).mock.calls[0]?.[0].options).toHaveLength(
        expected
      );
    }
  );

  test("skips the scope question when every record changed", async () => {
    // Given - one bundle whose only record changed
    repo.write("docs/references/c.md", `${draftRecord("C")}\nMore.\n`);

    // When - running on that bundle
    await runInteractive(context({ bundleDirs: ["docs/references"] }));

    // Then - straight to the checklist
    expect(select).not.toHaveBeenCalled();
    expect(multiselect).toHaveBeenCalled();
  });

  test("labels an untitled record by its file name", async () => {
    // Given - a draft with no title
    repo.write(
      "docs/references/c.md",
      record(["type: Reference", "status: draft"])
    );

    // When - running on its bundle
    await runInteractive(context({ bundleDirs: ["docs/references"] }));

    // Then - "(untitled)"
    expect(vi.mocked(multiselect).mock.calls[0]?.[0].options[0]?.label).toBe(
      "(untitled) — c.md"
    );
  });

  test("warns when there's no base branch to diff against", async () => {
    // Given - no main
    repo.git("branch", "--delete", "--force", "main");

    // When - running
    await runInteractive(context());

    // Then - the warning
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Can't diff against the base branch")
    );
  });

  test("fails when the bundles hold no records", async () => {
    // Given - an empty bundle
    repo.write("docs/empty/index.md", draftRecord("Index"));

    // When - running on it
    const code = await runInteractive(context({ bundleDirs: ["docs/empty"] }));

    // Then - a failure
    expect(code).toBe(1);
    expect(cancel).toHaveBeenCalledWith("No records found.");
  });

  test("ends when every listed record is verified", async () => {
    // Given - a bundle holding only a verified record
    repo.git("rm", "--quiet", "docs/decisions/a.md");

    // When - running on it
    const code = await runInteractive(
      context({ bundleDirs: ["docs/decisions"] })
    );

    // Then - nothing to pick
    expect(code).toBe(0);
    expect(outro).toHaveBeenCalledWith(
      "Every listed record is already verified."
    );
    expect(multiselect).not.toHaveBeenCalled();
  });

  test.each([
    { description: "the scope question", prompt: "select" },
    { description: "the checklist", prompt: "multiselect" },
    { description: "the confirmation", prompt: "confirm" },
  ] as const)(
    "changes nothing when $description is cancelled",
    async ({ prompt }) => {
      // Given - one record changed, so every prompt is asked, and one cancelled
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
      vi.mocked(select).mockResolvedValue("changed");
      vi.mocked({ confirm, multiselect, select }[prompt]).mockResolvedValue(
        CANCEL
      );

      // When - running
      const code = await runInteractive(context());

      // Then - a clean exit with the record untouched
      expect(code).toBe(0);
      expect(cancel).toHaveBeenCalledWith("Nothing changed.");
      expect(repo.read("docs/decisions/a.md")).toBe(
        `${draftRecord("A")}\nMore.\n`
      );
    }
  );

  test("changes nothing when the person declines", async () => {
    // Given - a "no" at the confirmation
    vi.mocked(confirm).mockResolvedValue(false);

    // When - running
    const code = await runInteractive(context());

    // Then - a clean exit
    expect(code).toBe(0);
    expect(cancel).toHaveBeenCalledWith("Nothing changed.");
  });

  test("warns when a chosen record has other uncommitted changes", async () => {
    // Given - an uncommitted edit to a draft
    repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
    vi.mocked(select).mockResolvedValue("changed");

    // When - running
    await runInteractive(context());

    // Then - the warning names it
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("will include:\ndocs/decisions/a.md")
    );
  });

  test("edits without committing under --no-commit", async () => {
    // Given - an uncommitted edit, which isn't worth a warning without a commit
    repo.write("docs/decisions/a.md", `${draftRecord("A")}\nMore.\n`);
    vi.mocked(select).mockResolvedValue("all");

    // When - running without committing
    const code = await runInteractive(context({ shouldCommit: false }));

    // Then - files only, and both drafts left edited
    expect(code).toBe(0);
    expect(note).toHaveBeenCalledWith(
      "docs/decisions/a.md\ndocs/references/c.md",
      "Files"
    );
    expect(confirm).toHaveBeenCalledWith({
      message: "Verify, without committing?",
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith("Verified 2; left uncommitted.");
    expect(repo.git("status", "--porcelain")).toBe(
      " M docs/decisions/a.md\n M docs/references/c.md\n"
    );
  });

  test("writes nothing when a record changes on disk while the prompt is open", async () => {
    // Given - the person saves an edit to a draft before confirming
    vi.mocked(confirm).mockImplementation(() => {
      repo.write("docs/decisions/a.md", `${draftRecord("A")}\nFixed a typo.\n`);

      return Promise.resolve(true);
    });

    // When - running
    const code = await runInteractive(context());

    // Then - a failure, and both records as the person left them
    expect(code).toBe(1);
    expect(cancel).toHaveBeenCalledWith(
      "docs/decisions/a.md changed on disk since it was read; nothing written."
    );
    expect(repo.read("docs/decisions/a.md")).toBe(
      `${draftRecord("A")}\nFixed a typo.\n`
    );
    expect(repo.read("docs/references/c.md")).toBe(draftRecord("C"));
  });

  test("stamps the time of the confirmation, not of the checklist", async () => {
    // Given - the clock moves on while the confirm prompt is open
    vi.useFakeTimers({
      now: new Date("2026-11-04T05:00:00Z"),
      toFake: ["Date"],
    });
    vi.mocked(confirm).mockImplementation(() => {
      vi.setSystemTime(new Date("2026-11-04T05:20:00Z"));

      return Promise.resolve(true);
    });

    // When - running, without committing
    await runInteractive(context({ shouldCommit: false }));
    vi.useRealTimers();

    // Then - the later time
    expect(repo.read("docs/decisions/a.md")).toContain(
      "at: 2026-11-04T05:20:00Z"
    );
  });

  test("fails without editing when a record refuses", async () => {
    // Given - a draft whose verified key is a nested mapping
    repo.write(
      "docs/references/c.md",
      record([
        "type: Reference",
        "status: draft",
        "verified:",
        "  by: human:someone",
      ])
    );

    // When - running
    const code = await runInteractive(context());

    // Then - a failure, and the other draft untouched
    expect(code).toBe(1);
    expect(cancel).toHaveBeenCalledWith(
      expect.stringContaining("No files changed.\ndocs/references/c.md:")
    );
    expect(repo.read("docs/decisions/a.md")).toBe(draftRecord("A"));
  });

  test("fails, leaving the edits on disk, when the commit is rejected", async () => {
    // Given - a hook that rejects every commit
    repo.installFailingHook({ output: "hook says no" });

    // When - running
    const code = await runInteractive(context());

    // Then - the hook's output
    expect(code).toBe(1);
    expect(cancel).toHaveBeenCalledWith(
      expect.stringContaining("the commit failed:\nhook says no")
    );
    expect(repo.read("docs/decisions/a.md")).toContain("status: stable");
  });
});
