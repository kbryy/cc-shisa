import type { ParseResult, Segment, ShellParser } from "./types.ts";

/**
 * Recovery strategy when the primary parse fails. Two attempts:
 *
 *   1. Strip quoted-heredoc bodies and re-parse. bash-parser chokes on
 *      certain content (e.g. parens) inside `<<'TAG' ... TAG`. Since
 *      quoted heredocs are literal, removing the body never changes the
 *      semantic of the surrounding shell script.
 *   2. Split on top-level newlines and parse each line independently.
 *      We lose compound semantics (`&&`, `||`) but at least each line
 *      can be classified, and most-strict-wins still catches dangerous
 *      lines.
 *
 * If both fail we return the primary parseErr so the caller fails safe
 * to `ask`.
 */
export function recoverParse(
  command: string,
  backend: ShellParser,
  primary: ParseResult,
): ParseResult {
  const stripped = stripQuotedHeredocBodies(command);
  if (stripped !== command) {
    const r = backend.parse(stripped);
    if (!r.parseErr && r.segments.length > 0) {
      return { original: command, segments: r.segments };
    }
  }

  const lineSegments: Segment[] = [];
  for (const line of splitOnNewlines(command)) {
    const r = backend.parse(line);
    if (!r.parseErr) lineSegments.push(...r.segments);
  }
  if (lineSegments.length > 0) {
    return { original: command, segments: lineSegments };
  }

  return primary;
}

/**
 * Replace bodies of quoted heredocs (`<<'TAG' ... TAG` / `<<"TAG" ... TAG`)
 * with an empty body so the surrounding shell parser doesn't have to
 * inspect literal content. Unquoted heredocs (`<<TAG ... TAG`) are left
 * alone — their contents support expansions and shouldn't be elided.
 */
function stripQuotedHeredocBodies(command: string): string {
  const headerRe = /<<(-?)\s*['"](\w+)['"]/g;
  const matches = [...command.matchAll(headerRe)];
  if (matches.length === 0) return command;

  const out: string[] = [];
  let lastEnd = 0;
  for (const m of matches) {
    const idx = m.index;
    if (idx === undefined || idx < lastEnd) continue;
    const dash = m[1] ?? "";
    const tag = m[2];
    if (tag === undefined) continue;
    const headerEnd = idx + m[0].length;
    const newlineIdx = command.indexOf("\n", headerEnd);
    if (newlineIdx === -1) continue;
    const closer = findHeredocCloser(command, newlineIdx + 1, tag, dash === "-");
    if (closer === -1) continue;
    out.push(command.slice(lastEnd, idx));
    out.push(`<<${dash}'${tag}'\n${tag}\n`);
    lastEnd = closer;
  }
  out.push(command.slice(lastEnd));
  return out.join("");
}

/**
 * Find the byte offset just past the closing `TAG` line of a heredoc that
 * started at `bodyStart`. Returns -1 if not found.
 */
function findHeredocCloser(
  command: string,
  bodyStart: number,
  tag: string,
  allowLeadingTabs: boolean,
): number {
  let cursor = bodyStart;
  while (cursor < command.length) {
    const lineEnd = command.indexOf("\n", cursor);
    const line = lineEnd === -1 ? command.slice(cursor) : command.slice(cursor, lineEnd);
    const trimmed = allowLeadingTabs ? line.replace(/^[\t ]+/, "") : line;
    if (trimmed === tag) {
      return lineEnd === -1 ? command.length : lineEnd + 1;
    }
    if (lineEnd === -1) return -1;
    cursor = lineEnd + 1;
  }
  return -1;
}

function splitOnNewlines(command: string): string[] {
  return command
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
