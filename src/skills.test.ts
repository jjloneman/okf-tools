import { describe, expect, test } from "vitest";
import { parse } from "yaml";

import type { Skill } from "./skills.ts";

import {
  OWNED_RESTAMP_EXCEPTIONS,
  RESTAMP_EXCEPTIONS,
} from "./restamp-exceptions.ts";
import { judgeSkill, SKILL_MARKER_PREFIX, SKILLS } from "./skills.ts";
import { TAG_RULES } from "./tag-rules.ts";

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

describe("okf-record", () => {
  test("holds the tag rules okf guide prints", () => {
    // Given - the record skill's text
    const { text } = RECORD_SKILL;

    // When/Then - it quotes the shared tag rules word for word
    expect(text).toContain(TAG_RULES);
  });

  test("audits tags by proposing first, and never re-stamps a retag", () => {
    // Given - the record skill's audit section
    const [, audit = ""] = RECORD_SKILL.text.split("## Audit a bundle's tags");

    // When - reading what it tells an agent to do
    const [section = ""] = audit.split("\n## ");

    // Then - it proposes before writing, and keeps generated for tags alone
    expect(section).toContain("Write nothing yet");
    expect(section).toContain("Write only the lists the person approves");
    expect(section).toContain("Don't run `okf touch`");
    expect(section).toContain("tags-count");
  });

  test("keeps generated for a sources or key reorder, as for tags", () => {
    // Given - the record skill's text
    const { text } = RECORD_SKILL;

    // When/Then - its draft rule, re-stamp step and handover name them all
    expect(text).toContain(
      `unless you changed only ${OWNED_RESTAMP_EXCEPTIONS}, which keeps`
    );
    expect(text).toContain(`unless it changed only ${RESTAMP_EXCEPTIONS}.`);
    expect(text).toContain(
      `in which you changed only ${RESTAMP_EXCEPTIONS}, which keep`
    );
  });

  test("cites the repo files a record was written from", () => {
    // Given - the record skill's text
    const { text } = RECORD_SKILL;

    // When/Then - it says to list them in sources, footnoted by id
    expect(text).toContain(
      "List in `sources` each repo file or folder the record was written from"
    );
    expect(text).toContain("whose label is the source's `id`");
    expect(text).toContain(
      "Add a `sources` entry for each repo file or folder"
    );
  });
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
