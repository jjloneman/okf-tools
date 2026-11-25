import { describe, expect, test, vi } from "vitest";

import { useTestRepo } from "#test/repo";

import { writeRecords } from "./repo.ts";

/*
 * What each write from the next one on does, in order; once the list runs
 * out, writes go to disk.
 *
 * - `fail` throws without writing, after the open has already emptied the
 *   file, `truncate` empties it and then throws, and `unlink` deletes it and
 *   then throws.
 */
const { writes } = vi.hoisted(() => ({
  writes: { plan: [] as ("fail" | "ok" | "truncate" | "unlink")[] },
}));

// Stands in for a disk that starts refusing writes mid-run, which no real
// test machine shows; the writes the plan lets through go to disk for real.
vi.mock(import("node:fs"), async (importOriginal) => {
  const original = await importOriginal();

  // Records are written through a descriptor, so `unlink` needs its path.
  const openPaths = new Map<number, string>();

  return {
    ...original,
    openSync: (...args: Parameters<typeof original.openSync>) => {
      const descriptor = original.openSync(...args);

      openPaths.set(descriptor, String(args[0]));

      return descriptor;
    },
    writeFileSync: (...args: Parameters<typeof original.writeFileSync>) => {
      const step = writes.plan.shift() ?? "ok";
      const [target] = args;

      if (step === "truncate") {
        original.writeFileSync(target, "");
      }

      if (step === "unlink") {
        original.unlinkSync(
          typeof target === "number"
            ? (openPaths.get(target) ?? "")
            : String(target)
        );
      }

      if (step !== "ok") {
        throw new Error("ENOSPC: no space left on device");
      }

      original.writeFileSync(...args);
    },
  };
});

const { repo } = useTestRepo();

/** The edits for two records, `docs/a.md` and `docs/b.md`. */
const EDITS = [
  { filePath: "docs/a.md", originalText: "old a\n", text: "new a\n" },
  { filePath: "docs/b.md", originalText: "old b\n", text: "new b\n" },
];

describe("writeRecords when the disk fails mid-run", () => {
  test.for([
    { description: "truncated", step: "truncate" as const },
    { description: "deleted", step: "unlink" as const },
  ])(
    "restores the record whose failed write left it $description",
    ({ step }) => {
      // Given - two records, the second's write failing after damaging it
      repo.write("docs/a.md", "old a\n");
      repo.write("docs/b.md", "old b\n");
      writes.plan = ["ok", step];

      // When - writing both
      const result = writeRecords({ edits: EDITS, repoRoot: repo.root });

      // Then - both records back as they were
      expect(result).toStrictEqual({
        isOk: false,
        reason:
          "Couldn't write docs/b.md: ENOSPC: no space left on device\nNo files changed.",
      });
      expect([repo.read("docs/a.md"), repo.read("docs/b.md")]).toStrictEqual([
        "old a\n",
        "old b\n",
      ]);
    }
  );

  test("names each record it couldn't restore", () => {
    // Given - two records, and a disk that fails from the second write on
    repo.write("docs/a.md", "old a\n");
    repo.write("docs/b.md", "old b\n");
    writes.plan = ["ok", "fail", "fail"];

    // When - writing both, so the second write and the restore both fail
    const result = writeRecords({ edits: EDITS, repoRoot: repo.root });

    // Then - the failed write and the record left emptied, both named
    expect(result).toStrictEqual({
      isOk: false,
      reason:
        "Couldn't write docs/b.md: ENOSPC: no space left on device\nThese are left changed, since restoring them failed:\ndocs/a.md: ENOSPC: no space left on device",
    });
    expect(repo.read("docs/a.md")).toBe("");
    expect(repo.read("docs/b.md")).toBe("old b\n");
  });
});
