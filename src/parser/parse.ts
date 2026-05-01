import { BashParserBackend } from "./impl/bash-parser.ts";
import { recoverParse } from "./recovery.ts";
import type { ParseResult, ShellParser } from "./types.ts";

const ACTIVE: ShellParser = selectBackend(process.env);

function selectBackend(env: NodeJS.ProcessEnv): ShellParser {
  const name = env["CC_SHISA_PARSER"];
  if (name === undefined || name === "" || name === "bash-parser") {
    return BashParserBackend;
  }
  if (env["CC_SHISA_DEBUG"] === "1") {
    process.stderr.write(`cc-shisa: unknown parser "${name}"; falling back to bash-parser\n`);
  }
  return BashParserBackend;
}

/**
 * Parse a shell command string into normalized segments. On any thrown error
 * from the underlying parser — or a structurally unrecognizable result — try
 * recovery (see recovery.ts) before giving up. If even recovery fails, return
 * the original parseErr so callers can fail-safe to ask.
 */
export function parse(command: string): ParseResult {
  if (command.trim() === "") {
    return { original: command, segments: [] };
  }

  const primary = ACTIVE.parse(command);
  if (!primary.parseErr) return primary;

  return recoverParse(command, ACTIVE, primary);
}
