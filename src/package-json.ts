/*
 * Write the `okf` member of a `package.json` by position, so the rest of the
 * file keeps its text byte for byte.
 *
 * - Only the `okf` value is replaced, or one member is added before the
 *   closing brace; every other key, escape, number, and line keeps its form.
 *
 * - The new value follows the file's own layout: its indent, its line
 *   breaks, and whether its arrays sit on one line.
 */

/** Where a top-level member's value sits in the text. */
type MemberSpan = {
  /**
   * The offset just past the value's last character.
   *
   * @example 42
   */
  end: number;

  /**
   * The member's key, unescaped.
   *
   * @example "okf"
   */
  key: string;

  /**
   * The offset of the value's first character.
   *
   * @example 30
   */
  start: number;
};

/** The top-level object's braces and members, by position. */
type ObjectLayout = {
  /**
   * The offset of the closing `}`.
   *
   * @example 80
   */
  close: number;

  /**
   * Each member, in order.
   *
   * @example `[{ end: 18, key: "name", start: 12 }]`
   */
  members: MemberSpan[];

  /**
   * The offset of the opening `{`.
   *
   * @example 0
   */
  open: number;
};

/**
 * Write a value as the `okf` member of a `package.json`'s text.
 *
 * - The text must be valid JSON holding an object, as `readOkfConfig` has
 *   already checked; the last `okf` member is the one replaced, as
 *   `JSON.parse` reads the last.
 */
export function writeOkfMember(params: {
  /**
   * The `package.json` text.
   *
   * @example `"{\n  \"name\": \"x\"\n}\n"`
   */
  text: string;

  /**
   * The new `okf` value.
   *
   * @example `{ bundles: ["docs/decisions"] }`
   */
  value: Record<string, unknown>;
}): string {
  const { text, value } = params;
  const layout = readObjectLayout(text);
  const indent = /^(?<indent>[ \t]+)\S/mu.exec(text)?.groups?.indent;
  const lineBreak = text.includes("\r\n") ? "\r\n" : "\n";

  const json =
    indent === undefined
      ? JSON.stringify(value)
      : formatValue({
          indent,
          isInline: /\[[^\n\]]*"[^\n\]]*\]/u.test(text),
          lineBreak,
          value,
        });

  const existing = layout.members.filter(({ key }) => key === "okf").at(-1);

  if (existing !== undefined) {
    return `${text.slice(0, existing.start)}${json}${text.slice(existing.end)}`;
  }

  const member =
    indent === undefined
      ? `"okf":${json}`
      : `${lineBreak}${indent}"okf": ${json}`;

  const last = layout.members.at(-1);

  // An empty object has no indented line, so its member is always compact.
  if (last === undefined) {
    return `${text.slice(0, layout.open + 1)}${member}${text.slice(layout.close)}`;
  }

  return `${text.slice(0, last.end)},${member}${text.slice(last.end)}`;
}

/**
 * Format the `okf` value one level in, one key per line.
 *
 * - An array of strings sits on one line when the file keeps its arrays on
 *   one line, as Prettier does, and one item per line otherwise.
 */
function formatValue(params: {
  indent: string;
  isInline: boolean;
  lineBreak: string;
  value: Record<string, unknown>;
}): string {
  const { indent, isInline, lineBreak, value } = params;
  const inner = indent.repeat(2);

  const lines = Object.entries(value).map(([key, item]) => {
    const json =
      isInline && Array.isArray(item)
        ? `[${item.map((element) => JSON.stringify(element)).join(", ")}]`
        : JSON.stringify(item, undefined, indent).replaceAll(
            "\n",
            `${lineBreak}${inner}`
          );

    return `${inner}${JSON.stringify(key)}: ${json}`;
  });

  return `{${lineBreak}${lines.join(`,${lineBreak}`)}${lineBreak}${indent}}`;
}

/**
 * Find the top-level object's braces, and each member's key and value span,
 * in valid JSON text.
 */
function readObjectLayout(text: string): ObjectLayout {
  const members: MemberSpan[] = [];
  let depth = 0;
  let open = 0;
  let close = text.length;
  let key: string | undefined;
  let start = 0;
  let isKeyNext = false;
  let index = 0;

  /** Record the member whose value ends before `offset`. */
  const finishMember = (offset: number): void => {
    if (key !== undefined) {
      members.push({
        end: start + text.slice(start, offset).trimEnd().length,
        key,
        start,
      });
      key = undefined;
    }
  };

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === '"') {
      const end = skipString({ start: index, text });

      if (depth === 1 && isKeyNext) {
        key = JSON.parse(text.slice(index, end)) as string;
        isKeyNext = false;
      }

      index = end;
      continue;
    }

    if (depth === 1 && char === ":") {
      start = index + 1 + text.slice(index + 1).search(/\S/u);
    } else if (depth === 1 && char === ",") {
      finishMember(index);
      isKeyNext = true;
    } else if (char === "{" || char === "[") {
      if (depth === 0) {
        open = index;
        isKeyNext = true;
      }

      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;

      if (depth === 0) {
        finishMember(index);
        close = index;
        break;
      }
    }

    index += 1;
  }

  return { close, members, open };
}

/** The offset just past the string literal that opens at `start`. */
function skipString(params: { start: number; text: string }): number {
  const { start, text } = params;
  let index = start + 1;

  while (text.charAt(index) !== '"') {
    index += text.charAt(index) === "\\" ? 2 : 1;
  }

  return index + 1;
}
