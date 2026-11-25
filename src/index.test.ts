import { describe, expect, test } from "vitest";

import * as library from "./index.ts";

describe("the library entry", () => {
  test("exports the checks beside the edit and the read", () => {
    // When - listing what the package exports at run time
    const names = Object.keys(library).sort();

    // Then - the frontmatter checks are among them
    expect(names).toStrictEqual([
      "ENTRY_STYLES",
      "EXIT_CODES",
      "RECORD_STATUSES",
      "REFUSAL_KINDS",
      "TRUST_TIERS",
      "findEditProblem",
      "findFrontmatterProblem",
      "getRecordState",
      "getTrustTier",
      "readRecordSummary",
      "run",
      "verifyRecord",
    ]);
  });
});
