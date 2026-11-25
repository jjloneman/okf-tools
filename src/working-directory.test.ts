import fc from "fast-check";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { TestRepo } from "#test/repo";

import { createTestRepo, useTestRepo } from "#test/repo";

import { findRepoRoot } from "./git.ts";
import {
  resolveWorkingDirectory,
  spellLikeRepoRoot,
} from "./working-directory.ts";

/** The folders a test picks `cwd`, `INIT_CWD` and the package root from. */
type Folders = {
  /**
   * The root of a repo other than the package's.
   *
   * @example "/private/var/folders/xy/T/okf-tools-def456"
   */
  otherRoot: string;

  /**
   * A folder outside any repo.
   *
   * @example "/private/var/folders/xy/T/okf-outside-abc123"
   */
  outside: string;

  /**
   * The root of the package's repo.
   *
   * @example "/private/var/folders/xy/T/okf-tools-abc123"
   */
  root: string;

  /**
   * A subfolder of the package's repo.
   *
   * @example "/private/var/folders/xy/T/okf-tools-abc123/docs"
   */
  subfolder: string;
};

const { repo } = useTestRepo();

let other: TestRepo | undefined;
let outside = "";

beforeEach(() => {
  other = createTestRepo();
  outside = realpathSync(mkdtempSync(path.join(tmpdir(), "okf-outside-")));
  mkdirSync(path.join(repo.root, "docs"));
});

afterEach(() => {
  other?.remove();
  other = undefined;
  rmSync(outside, { force: true, recursive: true });
});

describe("resolveWorkingDirectory", () => {
  test.each([
    {
      description: "INIT_CWD from a subfolder of the package's repo",
      expected: "subfolder",
      initCwd: "subfolder",
    },
    {
      description: "the package root when INIT_CWD is another repo",
      expected: "root",
      initCwd: "otherRoot",
    },
    {
      description: "the package root when INIT_CWD is outside any repo",
      expected: "root",
      initCwd: "outside",
    },
  ] as const)("uses $description", ({ expected, initCwd }) => {
    // Given - the env pnpm sets for a script started in the package root
    const folders = readFolders();
    const env = scriptEnv({
      initCwd: folders[initCwd],
      packageRoot: folders.root,
    });

    // When - resolving from the package root
    const resolved = resolveWorkingDirectory({ cwd: folders.root, env });

    // Then - INIT_CWD only when it's in the package's repo
    expect(resolved).toBe(folders[expected]);
  });

  test("uses INIT_CWD from a monorepo root that runs a package's script", () => {
    // Given - a package in a subfolder, run with a filter from the repo root
    const packageRoot = path.join(repo.root, "packages/tool");
    mkdirSync(packageRoot, { recursive: true });
    const env = scriptEnv({ initCwd: repo.root, packageRoot });

    // When - resolving from the package's folder, as pnpm starts it
    const resolved = resolveWorkingDirectory({ cwd: packageRoot, env });

    // Then - the monorepo root, which is the same repo
    expect(resolved).toBe(repo.root);
  });

  test("uses the cwd when the package root is outside any repo", () => {
    // Given - a package folder outside any repo, and INIT_CWD in a repo
    const env = scriptEnv({ initCwd: repo.root, packageRoot: outside });

    // When - resolving from that package folder
    const resolved = resolveWorkingDirectory({ cwd: outside, env });

    // Then - the cwd, since no repo holds both
    expect(resolved).toBe(outside);
  });

  test.each([
    {
      cwd: "/repo/sub",
      description: "the cwd once a script has changed directory",
      env: { INIT_CWD: "/repo/docs", npm_package_json: "/repo/package.json" },
      expected: "/repo/sub",
    },
    {
      cwd: "/repo",
      description: "the cwd outside any package script",
      env: { INIT_CWD: "/elsewhere" },
      expected: "/repo",
    },
    {
      cwd: "/repo",
      description: "the cwd when pnpm set no INIT_CWD",
      env: { npm_package_json: "/repo/package.json" },
      expected: "/repo",
    },
  ])("uses $description", ({ cwd, env, expected }) => {
    // When/Then - the directory paths resolve from
    expect(resolveWorkingDirectory({ cwd, env })).toBe(expected);
  });

  test("keeps the resolved directory in the same repo as the cwd", () => {
    // Given - any pairing of the folders as cwd, INIT_CWD and package root
    const folders = readFolders();
    const names = Object.keys(folders) as (keyof Folders)[];
    const folder = fc.constantFrom(...names);
    const maybeFolder = fc.option(folder, { nil: undefined });

    // When/Then - the resolved directory's repo is always the cwd's
    fc.assert(
      fc.property(folder, maybeFolder, maybeFolder, (cwd, initCwd, root) => {
        const env = {
          INIT_CWD: initCwd === undefined ? undefined : folders[initCwd],
          npm_package_json:
            root === undefined
              ? undefined
              : path.join(folders[root], "package.json"),
        };
        const resolved = resolveWorkingDirectory({ cwd: folders[cwd], env });

        expect(readRepoRoot(resolved)).toBe(readRepoRoot(folders[cwd]));
      }),
      { numRuns: 60, seed: 26 }
    );
  });
});

describe("resolveWorkingDirectory through a symlink", () => {
  test("matches the package root however its path is spelled", () => {
    // Given - pnpm's package.json path spelled through a link to the repo
    const linked = `${repo.root}-linked`;
    symlinkSync(repo.root, linked);
    const env = scriptEnv({
      initCwd: path.join(repo.root, "docs"),
      packageRoot: linked,
    });

    try {
      // When - resolving from the resolved spelling
      const resolved = resolveWorkingDirectory({ cwd: repo.root, env });

      // Then - INIT_CWD, since both name the same folder
      expect(resolved).toBe(path.join(repo.root, "docs"));
    } finally {
      rmSync(linked);
    }
  });
});

describe("spellLikeRepoRoot", () => {
  test("keeps a folder already inside the repo as given", () => {
    // Given - a subfolder spelled as git spells the root
    const cwd = path.join(repo.root, "docs");

    // When - spelling it
    const spelled = spellLikeRepoRoot({ cwd, repoRoot: repo.root });

    // Then - unchanged
    expect(spelled).toBe(cwd);
  });

  test("resolves a folder that reaches the repo through a symlink", () => {
    // Given - a link to the repo, and its docs folder through the link
    const linked = `${repo.root}-linked`;
    symlinkSync(repo.root, linked);

    try {
      // When - spelling the folder through the link
      const spelled = spellLikeRepoRoot({
        cwd: path.join(linked, "docs"),
        repoRoot: repo.root,
      });

      // Then - its real path, inside the repo
      expect(spelled).toBe(path.join(repo.root, "docs"));
    } finally {
      rmSync(linked);
    }
  });
});

/** The folders the current test's repos give. */
function readFolders(): Folders {
  return {
    otherRoot: other?.root ?? "",
    outside,
    root: repo.root,
    subfolder: path.join(repo.root, "docs"),
  };
}

/** The repo root `directory` is in, or undefined outside any repo. */
function readRepoRoot(directory: string): string | undefined {
  const root = findRepoRoot(directory);

  return root.isOk ? root.value : undefined;
}

/** The env pnpm sets for a script in the package at `packageRoot`. */
function scriptEnv(params: {
  initCwd: string;
  packageRoot: string;
}): Record<string, string> {
  const { initCwd, packageRoot } = params;

  return {
    INIT_CWD: initCwd,
    npm_package_json: path.join(packageRoot, "package.json"),
  };
}
