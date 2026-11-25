/*
 * Property tests for `planBundle`: generate a bundle of nested records whose
 * links are written from the bundle root, as v0.2 bundles wrote them, and
 * check every rewrite on each one.
 *
 * - Every link and path field it rewrites must name, from its own file's
 *   folder, the file it named from the bundle root.
 *
 * - Nothing else in the text may change: the prose, the code, a link's
 *   fragment, and its angle brackets.
 *
 * - The seed is fixed so CI is deterministic; a failure prints its seed and
 *   path, which `RUN_OPTIONS` takes to replay it.
 */
import fc from "fast-check";
import path from "node:path";
import { describe, expect, test } from "vitest";

import type { PlannedFile } from "./migrate-plan.ts";

import { planBundle } from "./migrate-plan.ts";

/** A piece of a record's text: kept as it is, or a path the plan may rewrite. */
type Piece =
  | {
      /**
       * Text the plan must keep byte for byte: prose, code, or frontmatter.
       *
       * @example "kept"
       */
      kind: "kept";

      /**
       * The text.
       *
       * @example "See `[A](a/x.md)` and "
       */
      text: string;
    }
  | {
      /**
       * What closes it, which it never holds: `)`, `>`, or a line break.
       *
       * @example ")"
       */
      closer: string;

      /**
       * A path the plan may rewrite: a link target or a path field's value.
       *
       * @example "path"
       */
      kind: "path";

      /**
       * What follows the path inside the target, kept as it is.
       *
       * @example "#usage"
       */
      suffix: string;

      /**
       * The path from the bundle root, as written.
       *
       * @example "a/x.md"
       */
      target: string;
    };

/** A generated record: where it sits, and what it says, in pieces. */
type RecordModel = {
  /**
   * Its path from the bundle root.
   *
   * @example "a/b/x.md"
   */
  filePath: string;

  /**
   * Its text, in pieces.
   *
   * @example `[{ kind: "kept", text: "---\n" }, …]`
   */
  pieces: Piece[];
};

/** The generated bundle's folder, from the repo root. */
const BUNDLE = "docs/kb";

/** A v0.2 index with a title and description, so only its version changes. */
const INDEX = '---\nokf_version: "0.2"\ntitle: K\ndescription: D\n---\n# K\n';

/** Fixed so CI is deterministic; see the file's comment for replaying one. */
const RUN_OPTIONS = { numRuns: 300, seed: 59 };

/** A record's path from the bundle root: up to three folders, then a name. */
const RECORD_PATH_ARB: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.constantFrom("a", "b", "notes"), { maxLength: 3 }),
    fc.constantFrom("x.md", "y.md", "a.md", "read me.md")
  )
  .map(([folders, name]) => [...folders, name].join("/"));

/** Prose between links, which holds no link syntax of its own. */
const PROSE_ARB: fc.Arbitrary<string> = fc.constantFrom(
  " ",
  "\n",
  " and ",
  "\n\nMore prose.\n",
  " (an aside) "
);

/** Build the pieces of one link to `target`, in a random form. */
function linkArb(target: string): fc.Arbitrary<Piece[]> {
  const isAngled = /\s/u.test(target);

  return fc
    .tuple(
      fc.constantFrom("", "#usage", "?raw"),
      fc.constantFrom("link", "image", "code", "fence", "reference")
    )
    .map(([suffix, form]): Piece[] => {
      const open = isAngled ? "<" : "";
      const closer = isAngled ? ">" : ")";
      const written = `${open}${target}${suffix}${isAngled ? ">" : ""}`;

      if (form === "code") {
        return [{ kind: "kept", text: `\`[C](${written})\`` }];
      }

      if (form === "fence") {
        return [{ kind: "kept", text: `\n\`\`\`\n[F](${written})\n\`\`\`\n` }];
      }

      if (form === "reference") {
        return [
          { kind: "kept", text: `\n[r]: ${open}` },
          { closer: isAngled ? ">" : "\n", kind: "path", suffix, target },
          { kind: "kept", text: isAngled ? ">\n" : "\n" },
        ];
      }

      return [
        { kind: "kept", text: `${form === "image" ? "!" : ""}[L](${open}` },
        { closer, kind: "path", suffix, target },
        { kind: "kept", text: isAngled ? ">)" : ")" },
      ];
    });
}

/** Build one record at `filePath`, linking to some of `targets`. */
function recordArb(params: {
  filePath: string;
  targets: readonly string[];
}): fc.Arbitrary<RecordModel> {
  const { filePath, targets } = params;
  const target = fc.constantFrom(...targets);

  // A path field's value with whitespace is a scope descriptor, not a path.
  const fieldTargets = targets.filter((value) => !/\s/u.test(value));
  const resourceArb =
    fieldTargets.length === 0
      ? fc.constant(null)
      : fc.option(fc.constantFrom(...fieldTargets));

  return fc
    .tuple(
      resourceArb,
      fc.array(fc.tuple(PROSE_ARB, target.chain(linkArb)), { maxLength: 5 })
    )
    .map(([resource, links]) => ({
      filePath,
      pieces: [
        { kind: "kept", text: "---\ntype: Decision\n" },
        ...(resource === null
          ? []
          : ([
              { kind: "kept", text: "resource: " },
              { closer: "\n", kind: "path", suffix: "", target: resource },
              { kind: "kept", text: "\n" },
            ] satisfies Piece[])),
        { kind: "kept", text: "---\n\n# Title\n" },
        ...links.flatMap(([prose, pieces]): Piece[] => [
          { kind: "kept", text: prose },
          ...pieces,
        ]),
        { kind: "kept", text: "\n" },
      ],
    }));
}

/** A bundle of records with distinct paths, linking to one another. */
const BUNDLE_ARB: fc.Arbitrary<RecordModel[]> = fc
  .uniqueArray(RECORD_PATH_ARB, { maxLength: 6, minLength: 1 })
  .chain((paths) =>
    fc.tuple(
      ...paths.map((filePath) => recordArb({ filePath, targets: paths }))
    )
  );

/**
 * Read a rewritten record back against the pieces it was written from.
 *
 * @returns each path piece's text as rewritten, or why the kept text changed.
 */
function readRewrites(params: {
  pieces: readonly Piece[];
  text: string;
}): { isOk: false; reason: string } | { isOk: true; paths: string[] } {
  const { pieces, text } = params;
  const paths: string[] = [];
  let cursor = 0;

  for (const piece of pieces) {
    if (piece.kind === "kept") {
      if (!text.startsWith(piece.text, cursor)) {
        return {
          isOk: false,
          reason: `expected ${JSON.stringify(piece.text)} at ${cursor} of ${JSON.stringify(text)}`,
        };
      }

      cursor += piece.text.length;
      continue;
    }

    const end = text.indexOf(piece.closer, cursor);
    const rewritten = text.slice(cursor, end);

    if (!rewritten.endsWith(piece.suffix)) {
      return {
        isOk: false,
        reason: `${JSON.stringify(rewritten)} lost its ${piece.suffix}`,
      };
    }

    paths.push(rewritten.slice(0, rewritten.length - piece.suffix.length));
    cursor = end;
  }

  return cursor === text.length
    ? { isOk: true, paths }
    : { isOk: false, reason: `extra text after ${cursor}` };
}

/** Render a record's pieces as its text. */
function render(pieces: readonly Piece[]): string {
  return pieces
    .map((piece) =>
      piece.kind === "kept" ? piece.text : `${piece.target}${piece.suffix}`
    )
    .join("");
}

describe("planBundle", () => {
  test("rewrites every root-relative path to name the same file", () => {
    fc.assert(
      fc.property(BUNDLE_ARB, (models) => {
        // Given - a bundle whose records link to one another from the root
        const repoPaths = models.map((model) =>
          path.posix.join(BUNDLE, model.filePath)
        );
        const records: PlannedFile[] = models.map((model) => ({
          filePath: path.posix.join(BUNDLE, model.filePath),
          text: render(model.pieces),
        }));

        const doesExist = (filePath: string): boolean =>
          repoPaths.some(
            (repoPath) =>
              repoPath === filePath || repoPath.startsWith(`${filePath}/`)
          );
        const isOnDisk = (bundlePath: string): boolean =>
          doesExist(path.posix.join(BUNDLE, decodeURIComponent(bundlePath)));

        // When - planning it
        const plan = planBundle({
          bundleDir: BUNDLE,
          doesExist,
          indexText: INDEX,
          records,
        });

        // Then - refused only over a path field that names two files, and
        // otherwise every path names its file from its own folder, all else
        // kept
        if (plan.state === "refused") {
          expect(plan.notes.some((note) => note.level === "blocked")).toBe(
            true
          );
          expect(plan.changes).toStrictEqual([]);

          return;
        }

        expect(plan.state).toBe("migrate");
        expect(plan.notes).toStrictEqual([]);

        for (const [index, model] of models.entries()) {
          const filePath = records[index]?.filePath;
          const change = plan.changes.find(
            (entry) => entry.filePath === filePath
          );
          const text = change?.after ?? records[index]?.text ?? "";
          const read = readRewrites({ pieces: model.pieces, text });

          expect(read).toMatchObject({ isOk: true });

          const fileDir = path.posix.dirname(model.filePath);
          // A path that already names a file from its own folder is kept,
          // since it means the same under both versions.
          const targets = model.pieces.flatMap((piece) => {
            if (piece.kind !== "path") {
              return [];
            }

            const fromFile = path.posix.join(fileDir, piece.target);

            return [isOnDisk(fromFile) ? fromFile : piece.target];
          });

          expect(
            (read.isOk ? read.paths : []).map((rewritten) =>
              path.posix.normalize(
                path.posix.join(fileDir, decodeURIComponent(rewritten))
              )
            )
          ).toStrictEqual(targets);
        }
      }),
      RUN_OPTIONS
    );
  });
});
