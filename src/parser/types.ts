/** A single normalized "what would actually run" view of a command segment. */
export interface Segment {
  /** Resolved command name after peeling sudo/timeout/env-style prefixes. */
  binary: string;
  /** Args after Binary; literal where statically resolvable, "<expr>" otherwise. */
  args: string[];
  /** Re-rendered text used for regex matching. */
  raw: string;
  /** True if any word contained an unresolvable expansion (variable, $(...), <(...), etc.). */
  hasExpr: boolean;
  /** True if this segment originated from $() or <()/>(). */
  fromSubsh: boolean;
  /** True if the surrounding statement carries a heredoc-style redirection. */
  hasHeredoc: boolean;
}

/** Output of parser.parse(). When parseErr is set, callers must fail-safe to ask. */
export interface ParseResult {
  original: string;
  segments: Segment[];
  parseErr?: Error;
}
