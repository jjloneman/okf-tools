import { afterEach, describe, expect, test, vi } from "vitest";

import type { Printer } from "./watch.ts";

import { runSpecWatch } from "./watch.ts";

vi.mock(import("./watch.ts"), () => ({
  runSpecWatch: vi.fn(({ printer }: { printer: Printer }) => {
    printer.error("an error line");
    printer.info("an info line");

    return Promise.resolve(1);
  }),
}));

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.mocked(runSpecWatch).mockClear();
});

describe("bin", () => {
  test("runs the watch with the process's environment and keeps the exit code", async () => {
    // Given - the console spied on
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      // Silenced, since the test reads what was printed.
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {
      // Silenced, since the test reads what was printed.
    });

    // When - loading the entry point
    await import("./bin.ts");

    // Then - the watch run with the real environment, fetch, and pin, its
    // lines printed, and its exit code kept
    expect(runSpecWatch).toHaveBeenCalledWith({
      env: process.env,
      fetch,
      pinPath: expect.stringMatching(
        /[/\\]spec[/\\]upstream\.json$/u
      ) as unknown,
      printer: {
        error: expect.any(Function) as unknown,
        info: expect.any(Function) as unknown,
      },
    });
    expect(error).toHaveBeenCalledWith("an error line");
    expect(log).toHaveBeenCalledWith("an info line");
    expect(process.exitCode).toBe(1);
  });
});
