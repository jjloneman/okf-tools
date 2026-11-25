import { describe, expect, test } from "vitest";

import { deprecateRecord } from "./deprecate.ts";

const AT = "2026-11-25T10:00:00Z";
const BY = "claude-code/2.2.0";
const NEW = `{ by: ${BY}, at: ${AT} }`;
const OLD = "{ by: claude-code/2.1.0, at: 2026-10-01T15:00:00Z }";
const SIGNED = "verified: { by: human:a, at: 2026-10-02T13:30:00Z }";
const BODY = "\n# Title\n\nBody text.\n";

/** Build a fabricated record from its frontmatter lines. */
function record(frontmatter: readonly string[]): string {
  return `---\n${frontmatter.join("\n")}\n---\n${BODY}`;
}

describe("deprecateRecord", () => {
  test.each([
    {
      after: [
        "type: Decision",
        "status: deprecated",
        `generated: ${NEW}`,
        SIGNED,
      ],
      before: ["type: Decision", "status: stable", `generated: ${OLD}`, SIGNED],
      description: "a signed-off record, keeping its sign-off",
      supersededBy: undefined,
    },
    {
      after: [
        "type: Decision",
        "status: deprecated",
        "superseded_by: /b.md",
        `generated: ${NEW}`,
      ],
      before: ["type: Decision", "status: draft", `generated: ${OLD}`],
      description: "a draft with a replacement, after its status",
      supersededBy: "/b.md",
    },
    {
      after: [
        "type: Decision",
        `generated: ${NEW}`,
        "status: deprecated",
        "superseded_by: /b.md",
      ],
      before: ["type: Decision"],
      description: "a record with no status or generated",
      supersededBy: "/b.md",
    },
    {
      after: [
        "status: deprecated",
        "superseded_by: /c.md",
        `generated: ${NEW}`,
      ],
      before: [
        "status: deprecated",
        "superseded_by: /b.md",
        `generated: ${OLD}`,
      ],
      description: "a deprecated record, renaming its replacement",
      supersededBy: "/c.md",
    },
  ])("deprecates $description", ({ after, before, supersededBy }) => {
    // Given - a record
    const text = record(before);

    // When - deprecating it
    const result = deprecateRecord({ at: AT, by: BY, supersededBy, text });

    // Then - deprecated and re-stamped, nothing else changed
    expect(result).toStrictEqual({ isOk: true, text: record(after) });
  });

  test("refuses what touchRecord refuses", () => {
    // Given - a record whose generated isn't a mapping
    const text = record(["status: stable", "generated: [a]"]);

    // When - deprecating it
    const result = deprecateRecord({
      at: AT,
      by: BY,
      supersededBy: undefined,
      text,
    });

    // Then - refused, saying why
    expect(result).toStrictEqual({
      isOk: false,
      kind: "unsupportedLayout",
      reason: "`generated` isn't a mapping; edit the record by hand",
    });
  });

  test("refuses what writeFields refuses", () => {
    // Given - a record whose status is a list
    const text = record(["status: [stable]", `generated: ${OLD}`]);

    // When - deprecating it
    const result = deprecateRecord({
      at: AT,
      by: BY,
      supersededBy: undefined,
      text,
    });

    // Then - refused, saying why
    expect(result).toStrictEqual({
      isOk: false,
      kind: "unsupportedLayout",
      reason: "`status` isn't a single value; edit the record by hand",
    });
  });
});
