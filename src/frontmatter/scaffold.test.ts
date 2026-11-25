import { describe, expect, test } from "vitest";
import { parseDocument } from "yaml";

import { scaffoldRecord } from "./scaffold.ts";

const AT = "2026-11-25T10:00:00Z";
const BY = "claude-code/2.2.0";

describe("scaffoldRecord", () => {
  test("writes only the type, the status, and generated when nothing else is given", () => {
    // When - scaffolding a record with no optional fields
    const text = scaffoldRecord({
      at: AT,
      by: BY,
      description: undefined,
      tags: [],
      title: undefined,
      type: "Decision",
    });

    // Then - a draft with an inline generated entry and no body
    expect(text).toBe(
      [
        "---",
        "type: Decision",
        "status: draft",
        `generated: { by: ${BY}, at: ${AT} }`,
        "---",
        "",
      ].join("\n")
    );
  });

  test("writes the title, description, and tags in order before the status", () => {
    // When - scaffolding a record with every field
    const text = scaffoldRecord({
      at: AT,
      by: BY,
      description: "Every export returns a fallback.",
      tags: ["cli", "api"],
      title: "What every export promises",
      type: "Decision",
    });

    // Then - the tags as a block list, in the order given
    expect(text).toBe(
      [
        "---",
        "type: Decision",
        "title: What every export promises",
        "description: Every export returns a fallback.",
        "tags:",
        "  - cli",
        "  - api",
        "status: draft",
        `generated: { by: ${BY}, at: ${AT} }`,
        "---",
        "",
      ].join("\n")
    );
  });

  test("quotes each value YAML would read as something else", () => {
    // Given - values that mean more than text when written plain
    const values = {
      description: "Why: a colon, then a # hash",
      tags: ["[x]", "*alias", "no", "on"],
      title: "#1 - true",
      type: "null",
    };

    // When - scaffolding the record
    const text = scaffoldRecord({ at: AT, by: BY, ...values });

    // Then - each reads back as the text given, with no verified entry
    const frontmatter = text.slice("---\n".length, -"---\n".length);
    expect(
      parseDocument(frontmatter, { schema: "failsafe" }).toJS()
    ).toStrictEqual({
      ...values,
      generated: { at: AT, by: BY },
      status: "draft",
    });
  });

  test.each([
    { description: "a YAML 1.1 boolean", value: "yes" },
    { description: "a YAML 1.1 date", value: "2026-11-25" },
    { description: "text YAML can't parse alone", value: "[" },
  ])("double-quotes $description", ({ value }) => {
    // When - scaffolding a record titled with it
    const text = scaffoldRecord({
      at: AT,
      by: BY,
      description: undefined,
      tags: [],
      title: value,
      type: "Decision",
    });

    // Then - quoted, so a YAML 1.1 reader reads it as text too
    expect(text).toContain(`title: "${value}"`);
  });
});
