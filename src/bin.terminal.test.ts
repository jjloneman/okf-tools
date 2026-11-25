import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { draftRecord, useTestRepo, VERIFIED_BY } from "#test/repo";

/** The entry point, run by Node's type stripping as `pnpm okf:verify` does. */
const BIN = path.resolve(import.meta.dirname, "bin.ts");

/** The bundle the scratch repo's records live in. */
const BUNDLE = "docs/decisions";

/*
 * A Python driver runs the command in a pseudo-terminal, since the bug only
 * shows when stdin and stdout are a TTY and Node has no pty of its own.
 *
 * - The terminal is given a size, since clack renders nothing at zero columns.
 *
 * - Keys are typed only once a prompt's text shows, so none arrive early.
 *
 * - A child still running 5 seconds after the last key is killed, so a hung
 *   prompt fails its test instead of hanging the run; every wait fits inside
 *   the test's timeout, so the driver's own message is the one reported.
 */
const DRIVER = String.raw`
import fcntl, json, os, pty, re, select, signal, struct, sys, termios, time

cwd, steps, command = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3:]
pid, fd = pty.fork()

if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 100, 0, 0))
    os.chdir(cwd)
    os.execvp(command[0], command)

output = ""

def read(deadline):
    global output
    while time.time() < deadline:
        if not select.select([fd], [], [], 0.1)[0]:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            return False
        if not chunk:
            return False
        output += chunk.decode("utf8", "replace")
        yield

def finish():
    deadline = time.time() + 5
    exited, status = os.waitpid(pid, os.WNOHANG)
    while exited == 0 and time.time() < deadline:
        time.sleep(0.05)
        exited, status = os.waitpid(pid, os.WNOHANG)
    if exited == 0:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)

def wait_for(text, seconds):
    seen = len(output)
    for _ in read(time.time() + seconds):
        plain = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", output[seen:])
        if text in plain:
            return
    finish()
    raise SystemExit("never saw: " + text + "\n" + output)

for text, keys in steps:
    wait_for(text, 10)
    os.write(fd, keys.encode())

for _ in read(time.time() + 5):
    pass

print(json.dumps({"code": finish(), "output": output}))
`;

/** The keys that should cancel any prompt. */
const CANCEL_KEYS = [
  { keys: "\u0003", name: "Ctrl-C" },
  { keys: "\u0004", name: "Ctrl-D" },
  { keys: "\u001b", name: "Esc" },
];

/*
 * Each prompt: the answers that reach it from the scope question, then the
 * text it shows.
 */
const PROMPTS = [
  { name: "the scope question", steps: [], text: "Which records?" },
  {
    name: "the checklist",
    steps: [["Which records?", "\r"]],
    text: "Which records do you verify?",
  },
  {
    name: "the confirmation",
    steps: [
      ["Which records?", "\r"],
      ["Which records do you verify?", " \r"],
    ],
    text: "Verify and commit?",
  },
];

const { repo } = useTestRepo();

/** Run `okf-verify` in a pseudo-terminal, typing each step's keys. */
function runInTerminal(steps: readonly (readonly string[])[]): {
  code: number;
  output: string;
} {
  // Without pnpm's variables, the paths resolve from the scratch repo.
  const env = {
    ...process.env,
    INIT_CWD: undefined,
    npm_package_json: undefined,
  };
  const result = spawnSync(
    "python3",
    ["-c", DRIVER, repo.root, JSON.stringify(steps), process.execPath, BIN],
    { encoding: "utf8", env, timeout: 45_000 }
  );

  if (result.status !== 0) {
    throw new Error(result.error?.message ?? (result.stderr || result.stdout), {
      cause: result.error,
    });
  }

  return JSON.parse(result.stdout) as { code: number; output: string };
}

describe("okf-verify in a terminal", () => {
  test.each(
    PROMPTS.flatMap(({ name: prompt, steps, text }) =>
      CANCEL_KEYS.map(({ keys, name: key }) => ({
        description: `${key} at ${prompt} changes nothing and exits 0`,
        keys,
        steps,
        text,
      }))
    )
  )(
    "$description",
    ({ keys, steps, text }) => {
      // Given - two drafts, one changed on the branch, so every prompt shows
      repo.write(
        "package.json",
        JSON.stringify({
          okf: { bundles: [BUNDLE], verifiedBy: VERIFIED_BY },
        })
      );
      repo.write(`${BUNDLE}/a.md`, draftRecord("A"));
      repo.write(`${BUNDLE}/b.md`, draftRecord("B"));
      repo.commitAll("add records");
      repo.write(`${BUNDLE}/b.md`, `${draftRecord("B")}\nMore.\n`);

      // When - reaching the prompt and pressing the key
      const { code, output } = runInTerminal([...steps, [text, keys]]);

      // Then - a cancel: the closing line, exit 0, the record untouched
      expect(output).toContain("Nothing changed.");
      expect(code).toBe(0);
      expect(repo.git("status", "--porcelain")).toBe(` M ${BUNDLE}/b.md\n`);
    },
    60_000
  );
});
