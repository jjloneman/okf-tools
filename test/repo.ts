/*
 * Scratch git repos for the tests that run real git.
 *
 * - Each repo has its own identity and no hooks or signing, so a test never
 *   depends on the machine's git config.
 *
 * - The path is resolved through symlinks (macOS's `/var` is `/private/var`),
 *   so it matches what `git rev-parse --show-toplevel` prints.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** A pre-commit hook that prints `output` and fails, after running `script`. */
export type FailingHook = {
  /**
   * What the hook prints before failing.
   *
   * @example "lint found 1 problem"
   */
  output: string;

  /**
   * Shell commands to run first, such as breaking the repo for what follows.
   *
   * @example `"echo broken > .git/HEAD"`
   */
  script?: string;
};

/** A scratch repo and the helpers a test drives it with. */
export type TestRepo = {
  /** Commit every change with the given message. */
  commitAll: (message: string) => void;

  /** Run git in the repo. */
  git: (...args: string[]) => string;

  /** Install a hook that fails, so the next commit is rejected. */
  installFailingHook: (hook: FailingHook) => void;

  /** Read a file, relative to the repo root. */
  read: (filePath: string) => string;

  /** Delete the repo. */
  remove: () => void;

  /**
   * The repo's root directory.
   *
   * @example "/private/var/folders/xy/okf-tools-abc123"
   */
  root: string;

  /** Write a file, relative to the repo root, creating its directories. */
  write: (filePath: string, text: string) => void;
};

/** The body every fabricated record shares. */
const BODY = "\n# Title\n\nBody text.\n";

/**
 * Create a repo on `main` with one commit holding a `package.json`.
 *
 * - `packageJson` is written as given, so a test can pass invalid JSON.
 */
export function createTestRepo(packageJson = "{}\n"): TestRepo {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "okf-tools-")));

  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  const write = (filePath: string, text: string): void => {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, text);
  };

  const commitAll = (message: string): void => {
    git("add", "--all");
    git("commit", "--quiet", "-m", message);
  };

  git("init", "--quiet", "--initial-branch", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", ".git/hooks");
  write("package.json", packageJson);
  commitAll("initial");

  return {
    commitAll,
    git,
    installFailingHook: ({ output, script = "" }) => {
      const hookPath = path.join(root, ".git/hooks/pre-commit");
      write(
        ".git/hooks/pre-commit",
        `#!/bin/sh\n${script}\necho "${output}"\nexit 1\n`
      );
      chmodSync(hookPath, 0o755);
    },
    read: (filePath) => readFileSync(path.join(root, filePath), "utf8"),
    remove: () => {
      rmSync(root, { force: true, recursive: true });
    },
    root,
    write,
  };
}

/** A fabricated draft record with the given title. */
export function draftRecord(title: string): string {
  return record([
    "type: Decision",
    `title: "${title}"`,
    "status: draft",
    "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
  ]);
}

/** Build a fabricated record from its frontmatter lines. */
export function record(frontmatter: readonly string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

/** A fabricated record signed off by `by` after it was generated. */
export function verifiedRecord(params: { by: string; title: string }): string {
  const { by, title } = params;

  return record([
    "type: Decision",
    `title: "${title}"`,
    "status: stable",
    "generated: { by: claude-code/2.1.316, at: 2026-10-01T15:00:00Z }",
    `verified: { by: ${by}, at: 2026-10-02T13:30:00Z }`,
  ]);
}
