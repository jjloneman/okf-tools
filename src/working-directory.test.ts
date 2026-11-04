import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveWorkingDirectory } from "./working-directory.ts";

describe("resolveWorkingDirectory", () => {
  test.each([
    {
      cwd: "/repo",
      description: "INIT_CWD inside the script pnpm started",
      env: { INIT_CWD: "/repo/docs", npm_package_json: "/repo/package.json" },
      expected: "/repo/docs",
    },
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
});

describe("resolveWorkingDirectory through a symlink", () => {
  test("matches the package root however its path is spelled", () => {
    // Setup - a package folder, and a symlink to it beside it
    const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "okf-cwd-")));
    const linked = `${scratch}-linked`;
    symlinkSync(scratch, linked);

    // Given - pnpm's package.json path spelled through the link, cwd resolved
    const env = {
      INIT_CWD: `${scratch}/docs`,
      npm_package_json: path.join(linked, "package.json"),
    };

    // When - resolving from the resolved spelling
    const resolved = resolveWorkingDirectory({ cwd: scratch, env });

    // Then - INIT_CWD, since both name the same folder
    expect(resolved).toBe(`${scratch}/docs`);

    // Cleanup
    rmSync(linked);
    rmSync(scratch, { force: true, recursive: true });
  });
});
