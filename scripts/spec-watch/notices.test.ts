import { describe, expect, test } from "vitest";

import { findLinkedRepos, findNewNotices, isSameRepo } from "./notices.ts";

describe("findNewNotices", () => {
  test("finds only notice lines that weren't there at the pin, once each", () => {
    // Given - a file that gained a notice twice, and kept an old one
    const pinText = "# Spec\n`deprecated` is a status.\n";
    const headText =
      "# Spec\n`deprecated` is a status.\nNo longer maintained.\n No longer maintained.\nPlain line.\n";

    // When - finding the new notices
    const notices = findNewNotices({ file: "SPEC", headText, pinText });

    // Then - the new one, once
    expect(notices).toStrictEqual([
      { file: "SPEC", line: "No longer maintained.", repos: [] },
    ]);
  });

  test("reads the repos linked from a notice's paragraph, in a GitHub alert", () => {
    // Given - an alert whose link is on the line after the notice, and a
    // link in the next paragraph
    const headText = [
      "# Spec",
      "",
      "> [!WARNING]",
      "> **This repository is deprecated.** It has moved to",
      "> [acme/next](https://github.com/acme/next),",
      "> which has the latest spec.",
      ">",
      "> See [elsewhere](https://github.com/acme/elsewhere).",
    ].join("\n");

    // When - finding the new notices, counting every one as new
    const notices = findNewNotices({ file: "README", headText, pinText: "" });

    // Then - the notice, with only its own paragraph's link
    expect(notices).toStrictEqual([
      {
        file: "README",
        line: "> **This repository is deprecated.** It has moved to",
        repos: ["acme/next"],
      },
    ]);
  });

  test("merges the repos of a notice line that appears twice", () => {
    // Given - the same notice line in two paragraphs, each with a link
    const headText = [
      "Now lives elsewhere: https://github.com/acme/first",
      "",
      "Now lives elsewhere: https://github.com/acme/first",
      "https://github.com/acme/second",
    ].join("\n");

    // When - finding the new notices
    const notices = findNewNotices({ file: "README", headText, pinText: "" });

    // Then - one notice, with both repos once each
    expect(notices).toStrictEqual([
      {
        file: "README",
        line: "Now lives elsewhere: https://github.com/acme/first",
        repos: ["acme/first", "acme/second"],
      },
    ]);
  });
});

describe("findLinkedRepos", () => {
  test("reads each linked repo once, ignoring case, keeping the first spelling", () => {
    // Given - links to a repo's files, a clone URL, a full stop, a case
    // variant, a link with no name, other hosts, pages that aren't repos,
    // and a `www.` link
    const text = [
      "https://github.com/Acme/Spec/blob/main/SPEC.md",
      "git clone https://github.com/acme/clone.git",
      "See github.com/acme/spec.",
      "Or github.com/acme/... for more",
      "Not a link: gitlab.com/acme/other",
      "Not repos: https://api.github.com/repos/acme/x, gist.github.com/u/1,",
      "github.com/sponsors/acme, github.com/user-attachments/assets/1,",
      "github.com/../etc, and myhub.github.com/a/b",
      "Also a repo: https://www.github.com/acme/www",
    ].join("\n");

    // When - finding the linked repos
    const repos = findLinkedRepos(text);

    // Then - each repo once, trimmed
    expect(repos).toStrictEqual(["Acme/Spec", "acme/clone", "acme/www"]);
  });
});

describe("isSameRepo", () => {
  test.each([
    {
      description: "the same name in another case",
      isExpected: true,
      right: "ACME/Spec",
    },
    { description: "another repo", isExpected: false, right: "acme/other" },
  ])("compares $description", ({ isExpected, right }) => {
    // Given - a repo and another name

    // When - comparing them
    const isSame = isSameRepo({ left: "acme/spec", right });

    // Then - equal only ignoring case
    expect(isSame).toBe(isExpected);
  });
});
