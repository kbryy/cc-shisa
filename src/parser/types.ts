/**
 * Backend-agnostic parser interface. Implementations live in
 * src/parser/impl/* and convert their native AST shape into the canonical
 * `Segment[]` representation. The active backend is selected at module
 * load time (`CC_SHISA_PARSER` env var), so the rest of the codebase only
 * imports `parse()` from `../parser/index.ts`.
 */
export interface ShellParser {
  readonly name: string;
  parse(command: string): ParseResult;
}

/** A single normalized "what would actually run" view of a command segment. */
export interface Segment {
  /** Resolved command name after peeling sudo/timeout/env-style prefixes. */
  binary: string;
  /** Args after binary; literal where statically resolvable, "<expr>" otherwise. */
  args: readonly string[];
  /** Re-rendered text used for regex matching. */
  raw: string;
  /** True if any word contained an unresolvable expansion (variable, $(...), <(...), etc.). */
  hasExpr: boolean;
  /** True if this segment originated from $() or <()/>() / backticks. */
  fromSubsh: boolean;
  /** True if the surrounding statement carries a heredoc-style redirection. */
  hasHeredoc: boolean;
}

/** Output of parser.parse(). When parseErr is set, callers must fail-safe to ask. */
export interface ParseResult {
  original: string;
  segments: readonly Segment[];
  parseErr?: Error;
}
