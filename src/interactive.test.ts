import {
  cancel,
  confirm,
  log,
  multiselect,
  MULTISELECT_INSTRUCTIONS,
  note,
  outro,
  select,
  updateSettings,
} from "@clack/prompts";
import { chmodSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  DISK_SPELLING,
  draftRecord,
  record,
  REFUSAL_REASON,
  refusedRecord,
  useTestRepo,
  VERIFIED_BY,
  verifiedRecord,
} from "#test/repo";

import type { RunContext } from "./run-context.ts";

import { runInteractive } from "./interactive.ts";
import { createOutput } from "./output.ts";

/*
 * Stands in for clack's cancel value, which it types as its own
 * `unique symbol` and doesn't export.
 *
 * - Typed `never`, so it fits every prompt's return type.
 */
const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol("cancel") as never }));

// The prompts answer from the test, and `isCancel` recognizes its symbol.
vi.mock(import("@clack/prompts"), async (importOriginal) => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  isCancel: (value: unknown): value is typeof CANCEL => value === CANCEL,
  log: {
    ...(await importOriginal()).log,
    info: vi.fn(),
    message: vi.fn(),
    step: vi.fn(),
    warn: vi.fn(),
  },
  multiselect: vi.fn(),
  MULTISELECT_INSTRUCTIONS: ["Enter: confirm"],
  note: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  updateSettings: vi.fn(),
}));

const { repo } = useTestRepo();

beforeEach(() => {
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
  vi.clearAllMocks();
});

/** The context for both bundles in the scratch repo. */
function context(overrides: Partial<RunContext> = {}): RunContext {
  return {
    bundleDirs: ["docs/decisions", "docs/references"],
    cwd: repo.root,
    excludeGlobs: [],
    output: createOutput("okf"),
    repoRoot: repo.root,
    shouldCommit: true,
    staleIn: undefined,
    style: "match",
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

  test("makes Ctrl-D cancel a prompt, as Ctrl-C and Esc do", async () => {
    // Given - the default records
    // When - running
    await runInteractive(context());

    // Then - Ctrl-D's byte mapped to clack's cancel action
    expect(updateSettings).toHaveBeenCalledWith({
      aliases: { "\u0004": "cancel" },
    });
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

  test("counts a record named in decomposed Unicode as changed", async () => {
    // Given - a new draft whose file name is decomposed, as some tools write
    repo.write("docs/decisions/cafe\u0301.md", draftRecord("Cafe"));
    vi.mocked(select).mockResolvedValue("changed");

    // When - running and picking the changed records
    await runInteractive(context());

    // Then - it is the one changed record listed, of the four
    expect(vi.mocked(multiselect).mock.calls[0]?.[0].options).toHaveLength(1);
  });

  test("warns about other changes to a record named in decomposed Unicode", async () => {
    // Given - a committed draft whose name is decomposed, edited since
    repo.write("docs/decisions/cafe\u0301.md", draftRecord("Cafe"));
    repo.commitAll("add cafe");
    repo.write(
      "docs/decisions/cafe\u0301.md",
      `${draftRecord("Cafe")}\nMore.\n`
    );
    vi.mocked(select).mockResolvedValue("changed");

    // When - running and signing it off
    await runInteractive(context());

    // Then - warned that the commit takes the other change too
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("These also have other uncommitted changes")
    );
  });

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "lists and commits a changed record renamed only in case on disk",
    async () => {
      // Given - a committed draft renamed only in case on disk, and edited
      renameSync(
        path.join(repo.root, "docs/decisions/a.md"),
        path.join(repo.root, "docs/decisions/A.md")
      );
      repo.write("docs/decisions/A.md", `${draftRecord("A")}\nMore.\n`);
      vi.mocked(select).mockResolvedValue("changed");

      // When - running and picking the changed records
      await runInteractive(context());

      // Then - listed as the one changed record, signed and committed under
      // git's spelling
      expect(vi.mocked(multiselect).mock.calls[0]?.[0].options).toHaveLength(1);
      expect(repo.git("status", "--porcelain")).toBe("");
      expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
        "docs/decisions/a.md\n"
      );
    }
  );

  test.skipIf(!DISK_SPELLING.isCaseInsensitive)(
    "lists a new record in a bundle folder renamed only in case as changed",
    async () => {
      // Given - the bundle's folder renamed only in case on disk, and a new
      // draft in it
      renameSync(
        path.join(repo.root, "docs/decisions"),
        path.join(repo.root, "docs/Decisions")
      );
      repo.write("docs/Decisions/c.md", draftRecord("C"));
      vi.mocked(select).mockResolvedValue("changed");

      // When - running and picking the changed records
      await runInteractive(context());

      // Then - listed as the one changed record, signed and committed under
      // git's spelling of the folder
      expect(vi.mocked(multiselect).mock.calls[0]?.[0].options).toHaveLength(1);
      expect(repo.git("status", "--porcelain")).toBe("");
      expect(repo.git("show", "--name-only", "--format=", "HEAD")).toBe(
        "docs/decisions/c.md\n"
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

  test("warns about an unreadable record, and lists the rest", async () => {
    // Given - one record with no read permission
    chmodSync(path.join(repo.root, "docs/decisions/a.md"), 0o000);

    // When - running and accepting every prompt
    const code = await runInteractive(context());

    // Then - a warning naming it, and it left out of the checklist
    expect(code).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Skipping docs\/decisions\/a\.md can't be read: /u)
    );
    expect(
      vi
        .mocked(multiselect)
        .mock.calls[0]?.[0].options.map(({ label }) => label)
    ).toStrictEqual(["B — b.md", "C — c.md"]);
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

  test.each([
    {
      description: "the only record",
      expected: "The only record was skipped; fix it and run again.",
      names: ["c.md"],
    },
    {
      description: "both records",
      expected: "All 2 records were skipped; fix them and run again.",
      names: ["c.md", "d.md"],
    },
  ])(
    "fails, saying so, when $description is skipped",
    async ({ expected, names }) => {
      // Given - a bundle whose records the edits all refuse
      for (const name of names) {
        repo.write(`docs/refused/${name}`, refusedRecord("Reference"));
      }

      // When - running on it
      const code = await runInteractive(
        context({ bundleDirs: ["docs/refused"] })
      );

      // Then - a failure after the warnings, not "No records found."
      expect(code).toBe(1);
      expect(log.warn).toHaveBeenCalledWith(
        `Skipping docs/refused/c.md: ${REFUSAL_REASON}`
      );
      expect(cancel).toHaveBeenCalledWith(expected);
      expect(log.warn).toHaveBeenCalledTimes(names.length);
      expect(cancel).toHaveBeenCalledOnce();
      expect(
        Math.max(...vi.mocked(log.warn).mock.invocationCallOrder)
      ).toBeLessThan(Math.min(...vi.mocked(cancel).mock.invocationCallOrder));
    }
  );

  test("says the skipped records need fixing when the rest are verified", async () => {
    // Given - a bundle holding a verified record and one the edits refuse
    repo.write(
      "docs/mixed/b.md",
      verifiedRecord({ by: VERIFIED_BY, title: "B" })
    );
    repo.write("docs/mixed/c.md", refusedRecord("Reference"));

    // When - running on it
    const code = await runInteractive(context({ bundleDirs: ["docs/mixed"] }));

    // Then - nothing to pick, and the skipped record pointed out
    expect(code).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      `Skipping docs/mixed/c.md: ${REFUSAL_REASON}`
    );
    expect(outro).toHaveBeenCalledWith(
      "Every listed record is already verified; fix the skipped ones above."
    );
    expect(multiselect).not.toHaveBeenCalled();
  });

  test("points out a skipped record outside the changed scope", async () => {
    // Given - a refused record already on main, and a verified one changed
    repo.git("checkout", "--quiet", "main");
    repo.write("docs/references/z.md", refusedRecord("Reference"));
    repo.commitAll("add a refused record");
    repo.git("checkout", "--quiet", "feature");
    repo.git("merge", "--quiet", "main");
    repo.write(
      "docs/decisions/d.md",
      verifiedRecord({ by: VERIFIED_BY, title: "D" })
    );
    vi.mocked(select).mockResolvedValue("changed");

    // When - running and picking the changed records
    const code = await runInteractive(context());

    // Then - the run ends cleanly, still pointing at the skipped record
    expect(code).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      `Skipping docs/references/z.md: ${REFUSAL_REASON}`
    );
    expect(outro).toHaveBeenCalledWith(
      "Every listed record is already verified; fix the skipped ones above."
    );
  });

  test("says when every record changed on the branch was skipped", async () => {
    // Given - the branch's only change is a record the edits refuse
    repo.write("docs/decisions/z.md", refusedRecord("Decision"));

    // When - running and accepting every prompt
    const code = await runInteractive(context());

    // Then - every record shown, saying why, and the drafts verified
    expect(code).toBe(0);
    expect(log.info).toHaveBeenCalledWith(
      "Each changed record was skipped; showing every record."
    );
    expect(repo.read("docs/decisions/a.md")).toContain("status: stable");
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

  test("warns about a record the edits refuse, and verifies the rest", async () => {
    // Given - a draft whose verified key is a nested mapping
    repo.write("docs/references/c.md", refusedRecord("Reference"));

    // When - running and accepting every prompt
    const code = await runInteractive(context());

    // Then - a warning naming it before the checklist, and the rest verified
    expect(code).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      `Skipping docs/references/c.md: ${REFUSAL_REASON}`
    );
    expect(repo.read("docs/decisions/a.md")).toContain("status: stable");
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

describe("runInteractive, before the confirm", () => {
  /** b signed off by its own commit, after a draft, so a diff can start there. */
  const B_SIGNED = verifiedRecord({ by: VERIFIED_BY, title: "B" });

  /** b regenerated after its sign-off, so it needs a new one. */
  const B_REGENERATED = B_SIGNED.replace(
    "2026-10-01T15:00:00Z",
    "2026-10-03T15:00:00Z"
  );

  /** Commit b as a draft, then as `signed`, returning the second's hash. */
  function signB(signed: string): string {
    repo.write("docs/decisions/b.md", draftRecord("B"));
    repo.commitAll("draft b");
    repo.write("docs/decisions/b.md", signed);
    repo.commitAll("sign b");

    return repo.git("rev-parse", "--short", "HEAD").trim();
  }

  beforeEach(() => {
    vi.mocked(select).mockResolvedValue("changed");
    vi.mocked(confirm).mockResolvedValue(false);
  });

  test("shows the diff since the sign-off of a record changed since", async () => {
    // Given - b signed, then regenerated with a new body
    const signOff = signB(B_SIGNED);
    repo.write(
      "docs/decisions/b.md",
      B_REGENERATED.replace("Body text.", "New body.")
    );

    // When - running and picking b alone
    await runInteractive(context());

    // Then - its diff from the sign-off commit, before the confirm
    expect(log.step).toHaveBeenCalledWith(
      `docs/decisions/b.md: changes since ${VERIFIED_BY}'s sign-off in ${signOff}`
    );
    expect(log.message).toHaveBeenCalledWith(
      expect.stringContaining("-Body text.\n+New body.")
    );
    expect(vi.mocked(log.step).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(confirm).mock.invocationCallOrder[0] ?? 0
    );
  });

  test("shows the whole record of a draft never signed off", async () => {
    // Given - the default drafts
    vi.mocked(select).mockResolvedValue("all");

    // When - running
    await runInteractive(context());

    // Then - each draft whole, with nothing in it colored
    expect(log.step).toHaveBeenCalledWith(
      `docs/decisions/a.md: never signed off by ${VERIFIED_BY}, so here is the whole record`
    );
    expect(log.message).toHaveBeenCalledWith(draftRecord("A").trimEnd());
  });

  test("shows only the heading when the signed text is unchanged", async () => {
    // Given - b signed off ahead of the clock, which lists it as changed
    const signOff = signB(
      B_SIGNED.replace("2026-10-02T13:30:00Z", "2099-01-01T00:00:00Z")
    );

    // When - running
    await runInteractive(context());

    // Then - a heading, and no diff
    expect(log.step).toHaveBeenCalledWith(
      `docs/decisions/b.md: unchanged since ${VERIFIED_BY}'s sign-off in ${signOff}`
    );
    expect(log.message).not.toHaveBeenCalled();
  });

  test("warns when the diff can't be read, and still asks to confirm", async () => {
    // Given - b signed, regenerated, then unreadable once chosen
    signB(B_SIGNED);
    repo.write("docs/decisions/b.md", B_REGENERATED);
    const filePath = path.join(repo.root, "docs/decisions/b.md");
    vi.mocked(multiselect).mockImplementation(({ options }) => {
      chmodSync(filePath, 0o000);

      return Promise.resolve(options.map(({ value }) => value));
    });

    try {
      // When - running
      await runInteractive(context());
    } finally {
      chmodSync(filePath, 0o644);
    }

    // Then - a warning, and the confirm still asked
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Can't show what changed: Couldn't diff /u)
    );
    expect(confirm).toHaveBeenCalled();
  });
});

describe("runInteractive, when a file or git call fails", () => {
  test("closes the prompts naming a record deleted while the prompt is open", async () => {
    // Given - the person deletes a draft before confirming
    vi.mocked(confirm).mockImplementation(() => {
      unlinkSync(path.join(repo.root, "docs/decisions/a.md"));

      return Promise.resolve(true);
    });

    // When - running
    const code = await runInteractive(context());

    // Then - a failure naming the record, and the other draft untouched
    expect(code).toBe(1);
    expect(cancel).toHaveBeenCalledWith(
      expect.stringMatching(
        /^docs\/decisions\/a\.md can't be read any more: ENOENT[^\n]*\nNo files changed\.$/u
      )
    );
    expect(repo.read("docs/references/c.md")).toBe(draftRecord("C"));
  });

  test("closes the prompts naming a bundle that can't be listed", async () => {
    // Given - a bundle with no read permission
    const bundle = path.join(repo.root, "docs/references");

    chmodSync(bundle, 0o000);

    try {
      // When - running
      const code = await runInteractive(context());

      // Then - a failure naming the bundle, before any prompt
      expect(code).toBe(1);
      expect(cancel).toHaveBeenCalledWith(
        expect.stringMatching(/^docs\/references can't be listed: EACCES/u)
      );
      expect(multiselect).not.toHaveBeenCalled();
    } finally {
      chmodSync(bundle, 0o755);
    }
  });

  test("closes the prompts naming the bundles when git status fails", async () => {
    // Given - an index git can't read
    repo.write(".git/index", "garbage\n");

    // When - running
    const code = await runInteractive(context());

    // Then - a failure naming the bundles and git's reason, before any prompt
    expect(code).toBe(1);
    expect(cancel).toHaveBeenCalledWith(
      "Couldn't read git status for docs/decisions, docs/references: fatal: .git/index: index file smaller than expected"
    );
    expect(multiselect).not.toHaveBeenCalled();
  });
});
