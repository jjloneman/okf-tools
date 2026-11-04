import { afterEach, describe, expect, test, vi } from "vitest";

import { run } from "./cli.ts";

vi.mock("./cli.ts", () => ({ run: vi.fn(() => Promise.resolve(2)) }));

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.mocked(run).mockClear();
});

/** Load the entry point afresh, with stdin and stdout given as terminals or not. */
async function loadBin(isTerminal: boolean): Promise<void> {
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
    await import("./bin.ts");
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
  test("runs from INIT_CWD in a pnpm script, in a terminal, and keeps the exit code", async () => {
    // Given - pnpm's INIT_CWD, in the package root it started
    vi.stubEnv("INIT_CWD", "/where/pnpm/was/run");
    vi.stubEnv("npm_package_json", `${process.cwd()}/package.json`);

    // When - loading the entry point in a terminal
    await loadBin(true);

    // Then - run called with the arguments after the script
    expect(run).toHaveBeenCalledWith({
      args: process.argv.slice(2),
      cwd: "/where/pnpm/was/run",
      isInteractive: true,
    });
    expect(process.exitCode).toBe(2);
  });

  test("falls back to the process's cwd, and isn't interactive without a terminal", async () => {
    // Given - no pnpm script
    vi.stubEnv("INIT_CWD", undefined);
    vi.stubEnv("npm_package_json", undefined);

    // When - loading the entry point without a terminal
    await loadBin(false);

    // Then - the process's cwd, not interactive
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: process.cwd(), isInteractive: false })
    );
  });
});
