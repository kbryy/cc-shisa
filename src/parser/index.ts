import bashParse from "bash-parser";

import type { ParseResult, Segment } from "./types.ts";
import { walk, type AstNode } from "./walker.ts";

/**
 * Parse a shell command string into normalized segments. On any thrown error
 * from the underlying parser, return an empty segments list with `parseErr`
 * set so callers can fail-safe to ask.
 */
export function parse(cmd: string): ParseResult {
  if (cmd.trim() === "") {
    return { original: cmd, segments: [] };
  }

  let ast: unknown;
  try {
    ast = bashParse(cmd);
  } catch (err) {
    return {
      original: cmd,
      segments: [],
      parseErr: err instanceof Error ? err : new Error(String(err)),
    };
  }

  const segments: Segment[] = walk(ast as AstNode);
  return { original: cmd, segments };
}
