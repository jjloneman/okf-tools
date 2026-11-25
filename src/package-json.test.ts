import { describe, expect, test } from "vitest";

import { writeOkfMember } from "./package-json.ts";

const VALUE = { bundles: ["docs"], verifiedBy: "human:x" };

describe("writeOkfMember", () => {
  test.each([
    {
      description: "an empty object",
      expected: '{"okf":{"bundles":["docs"],"verifiedBy":"human:x"}}\n',
      text: "{}\n",
    },
    {
      description: "a file whose arrays sit on one line",
      expected:
        '{\n  "files": ["dist"],\n  "okf": {\n    "bundles": ["docs"],\n    "verifiedBy": "human:x"\n  }\n}\n',
      text: '{\n  "files": ["dist"]\n}\n',
    },
    {
      description: "a file whose arrays break over lines",
      expected:
        '{\n  "files": [\n    "dist"\n  ],\n  "okf": {\n    "bundles": [\n      "docs"\n    ],\n    "verifiedBy": "human:x"\n  }\n}\n',
      text: '{\n  "files": [\n    "dist"\n  ]\n}\n',
    },
    {
      description: "a CRLF file",
      expected:
        '{\r\n  "a": 1,\r\n  "okf": {\r\n    "bundles": [\r\n      "docs"\r\n    ],\r\n    "verifiedBy": "human:x"\r\n  }\r\n}\r\n',
      text: '{\r\n  "a": 1\r\n}\r\n',
    },
  ])("adds the member to $description", ({ expected, text }) => {
    // When/Then - the member after the last one, in the file's layout
    expect(writeOkfMember({ text, value: VALUE })).toBe(expected);
  });

  test("replaces the okf value and keeps every other byte", () => {
    // Given - escapes, nesting, numbers, and a key holding a quote and braces
    const text =
      '{\n  "a\\"}{": "x\\\\\\u00e9",\n  "okf": { "bundles": ["old"] } ,\n  "nested": {"okf": [1.0, {"b": "]"}]}\n}';

    // When - writing a new value
    const written = writeOkfMember({ text, value: VALUE });

    // Then - only the top-level okf value changes
    expect(written).toBe(
      '{\n  "a\\"}{": "x\\\\\\u00e9",\n  "okf": {\n    "bundles": ["docs"],\n    "verifiedBy": "human:x"\n  } ,\n  "nested": {"okf": [1.0, {"b": "]"}]}\n}'
    );
    expect(JSON.parse(written)).toMatchObject({ okf: VALUE });
  });

  test("replaces the last okf member, as JSON.parse reads it", () => {
    // Given - two okf members
    const text = '{"okf":{},"okf":{"bundles":[]}}';

    // When/Then - the second is replaced
    expect(writeOkfMember({ text, value: VALUE })).toBe(
      '{"okf":{},"okf":{"bundles":["docs"],"verifiedBy":"human:x"}}'
    );
  });
});
