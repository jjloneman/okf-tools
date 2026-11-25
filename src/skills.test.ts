import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import type { Skill } from "./skills.ts";

import { judgeSkill, SKILL_MARKER_PREFIX, SKILLS } from "./skills.ts";

/** The record skill, which the judging tests use. */
const RECORD_SKILL = findRecordSkill();

/** Find the record skill, failing the file when there's none. */
function findRecordSkill(): Skill {
  const skill = SKILLS.find(({ name }) => name === "okf-record");

  if (skill === undefined) {
    throw new Error("No okf-record skill.");
  }

  return skill;
}

describe("SKILLS", () => {
  test.each(SKILLS.map((skill) => ({ description: skill.name, skill })))(
    "$description has frontmatter an agent can load",
    ({ skill }) => {
      // Given - the skill's text
      const [, frontmatter = ""] = skill.text.split(/^---$/mu);

      // When - reading its frontmatter as YAML
      const data: unknown = parse(frontmatter);

      // Then - its name matches its folder, and it says when to load it
      expect(data).toHaveProperty("name", skill.name);
      expect(data).toHaveProperty(
        "description",
        expect.stringMatching(/Use this skill when/u)
      );
      expect(skill.text).toMatch(/^---\n/u);
      expect(skill.text.endsWith("\n")).toBe(true);
    }
  );

  test("are sorted by name", () => {
    // Given - the skills' names
    const names = SKILLS.map(({ name }) => name);

    // When - sorting them
    const sorted = [...names].sort();

    // Then - they were already in order
    expect(names).toStrictEqual(sorted);
  });

  test.each(SKILLS.map((skill) => ({ description: skill.name, skill })))(
    "$description never tells an agent to write verified or a time",
    ({ skill }) => {
      // Given - the skill's text
      const { text } = skill;

      // When - looking for the trust rules
      const isStampedByCli =
        text.includes("okf touch") || text.includes("as the okf-record skill");

      // Then - it defers to the CLI, and never shows a typed time
      expect(isStampedByCli).toBe(true);
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/u);
      expect(text).toMatch(/never add,? (?:or )?change/iu);
    }
  );
});

describe("judgeSkill", () => {
  test.each([
    {
      description: "nothing installed",
      expected: "missing",
      installed: undefined,
    },
    {
      description: "the same text",
      expected: "current",
      installed: RECORD_SKILL.text,
    },
    {
      description: "an earlier version's text, with CRLF line breaks",
      expected: "stale",
      installed: `---\r\nname: okf-record\r\n---\r\n\r\n${SKILL_MARKER_PREFIX} -->\r\n`,
    },
    {
      description: "the same text with CRLF line breaks",
      expected: "current",
      installed: RECORD_SKILL.text.replaceAll("\n", "\r\n"),
    },
    {
      description: "a file with no marker line",
      expected: "foreign",
      installed: "---\nname: okf-record\n---\n\nOurs.\n",
    },
    {
      description: "a marker quoted mid-line",
      expected: "foreign",
      installed: `Ours, quoting ${SKILL_MARKER_PREFIX}\n`,
    },
  ])("judges $description as $expected", ({ expected, installed }) => {
    // Given - the installed text
    // When - judging it against the record skill
    const state = judgeSkill({ installed, skill: RECORD_SKILL });

    // Then - the expected state
    expect(state).toBe(expected);
  });
});
