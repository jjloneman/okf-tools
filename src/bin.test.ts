import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useTestRepo } from "#test/repo";

import { run } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";

vi.mock(import("./cli.ts"), () => ({
  run: vi.fn(() => Promise.resolve(EXIT_CODES.nothingToVerify)),
}));

const { repo } = useTestRepo();

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.mocked(run).mockClear();
});

/** Load an entry point afresh, with stdin and stdout given as terminals or not. */
async function loadBin(params: {
  /**
   * Whether stdin and stdout are terminals.
   *
   * @example true
   */
  isTerminal: boolean;

  /**
   * Import the entry point.
   *
   * @example `() => import("./bin.ts")`
   */
  load: () => Promise<unknown>;
}): Promise<void> {
  const { isTerminal, load } = params;
  const descriptors = [process.stdin, process.stdout].map((stream) => ({
    descriptor: Object.getOwnPropertyDescriptor(stream, "isTTY"),
    stream,
  }));

  descriptors.forEach(({ stream }) => {
    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value: isTerminal,
    });
  });

  try {
    await load();
  } finally {
    descriptors.forEach(({ descriptor, stream }) => {
      if (descriptor === undefined) {
        Reflect.deleteProperty(stream, "isTTY");
      } else {
        Object.defineProperty(stream, "isTTY", descriptor);
      }
    });
  }
}

describe("bin", () => {
  test.each([
    { load: () => import("./okf-bin.ts"), program: "okf" },
    { load: () => import("./bin.ts"), program: "okf-verify" },
  ])("runs as $program", async ({ load, program }) => {
    // Given - no pnpm script
    vi.stubEnv("INIT_CWD", undefined);
    vi.stubEnv("npm_package_json", undefined);

    // When - loading its entry point
    await loadBin({ isTerminal: false, load });

    // Then - run told which program it is
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ program }));
  });

  test("runs from INIT_CWD in a pnpm script, in a terminal, and keeps the exit code", async () => {
    // Given - pnpm's INIT_CWD, a subfolder of the package root it started in
    const initCwd = path.join(repo.root, "docs");
    mkdirSync(initCwd);
    vi.spyOn(process, "cwd").mockReturnValue(repo.root);
    vi.stubEnv("INIT_CWD", initCwd);
    vi.stubEnv("npm_package_json", path.join(repo.root, "package.json"));

    // When - loading the entry point in a terminal
    await loadBin({ isTerminal: true, load: () => import("./bin.ts") });

    // Then - run called with the arguments after the script
    expect(run).toHaveBeenCalledWith({
      args: process.argv.slice(2),
      cwd: initCwd,
      isInteractive: true,
      program: "okf-verify",
    });
    expect(process.exitCode).toBe(2);
  });

  test("falls back to the process's cwd, and isn't interactive without a terminal", async () => {
    // Given - no pnpm script
    vi.stubEnv("INIT_CWD", undefined);
    vi.stubEnv("npm_package_json", undefined);

    // When - loading the entry point without a terminal
    await loadBin({ isTerminal: false, load: () => import("./bin.ts") });

    // Then - the process's cwd, not interactive
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: process.cwd(), isInteractive: false })
    );
  });
});
