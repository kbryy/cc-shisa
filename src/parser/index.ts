import bashParse from "bash-parser";

import type { ParseResult, Segment } from "./types.ts";
import { walk, type AstNode } from "./walker.ts";

/**
 * Parse a shell command string into normalized segments. On any thrown error
 * from the underlying parser — or a structurally unrecognizable result —
 * return an empty segments list with `parseErr` set so callers can fail-safe
 * to ask.
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

  if (!isAstNode(ast)) {
    return {
      original: cmd,
      segments: [],
      parseErr: new Error("bash-parser returned a non-AST value"),
    };
  }

  const segments: Segment[] = walk(ast);
  return { original: cmd, segments };
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
