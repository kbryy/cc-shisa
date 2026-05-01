/**
 * Per-prefix table of flags that take a value (so the next token must be
 * consumed too). Empty set means the prefix accepts only valueless flags.
 */
const PREFIX_FLAG_TAKES_VALUE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["sudo", new Set(["-u", "-g", "-p", "-h", "-C", "-D", "-r", "-t", "-T"])],
  ["timeout", new Set(["-s", "-k", "--signal", "--kill-after"])],
  ["nice", new Set(["-n", "-c", "-p"])],
  ["ionice", new Set(["-n", "-c", "-p"])],
  ["env", new Set(["-u", "-C", "-S"])],
  ["exec", new Set(["-a"])],
  ["command", new Set()],
  ["time", new Set()],
]);

/**
 * Prefixes that, after their flags, take a single mandatory positional
 * argument (e.g. `timeout 30 ...`, `nice 10 ...`). The next token after
 * the flag list belongs to the prefix, not the wrapped command.
 */
const PREFIX_TAKES_POSITIONAL: ReadonlySet<string> = new Set(["timeout", "nice", "ionice"]);

const PREFIX_WRAPPERS: ReadonlySet<string> = new Set(PREFIX_FLAG_TAKES_VALUE.keys());

const MAX_PREFIX_DEPTH = 2;

/** Strip the directory portion from a binary path: `/usr/bin/sudo` → `sudo`. */
export function lastPath(s: string): string {
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * A backend-agnostic token: the literal text and whether it's purely
 * literal (no `$VAR` / `$(...)` / etc.). Backend implementations convert
 * their native AST nodes into this shape before calling `peelPrefixes`.
 */
export interface ResolvedToken {
  text: string;
  isLiteral: boolean;
}

/**
 * Walk `rest` from index 0 and return how many tokens belong to `prefix`'s
 * own option/argument list. Stops at the first non-flag positional, which
 * the caller treats as the next command name.
 */
export function consumePrefixArgs(
  prefix: string,
  rest: readonly ResolvedToken[],
): number {
  const flagsTakingValue = PREFIX_FLAG_TAKES_VALUE.get(prefix);
  if (!flagsTakingValue) return 0;

  let i = 0;
  while (i < rest.length) {
    const tok = rest[i];
    if (!tok || !tok.text.startsWith("-")) break;
    if (tok.text === "--") {
      i += 1;
      break;
    }
    if (flagsTakingValue.has(tok.text)) {
      i += 2;
      continue;
    }
    i += 1;
  }

  if (PREFIX_TAKES_POSITIONAL.has(prefix)) {
    const next = rest[i];
    if (next && !next.text.startsWith("-")) {
      i += 1;
    }
  }

  return i;
}

export interface PeeledTokens {
  binary: string;
  args: readonly string[];
  hasExpr: boolean;
}

/**
 * Take the resolved [name, ...suffix] tokens of a Command and peel the
 * sudo/timeout/etc. wrappers up to two layers deep. Returns the binary
 * + remaining args. `hasExpr` carries forward if any consumed token was
 * non-literal.
 */
export function peelPrefixes(tokens: readonly ResolvedToken[]): PeeledTokens {
  let cursor = tokens;
  let hasExpr = !cursor.every((t) => t.isLiteral);

  for (let depth = 0; depth < MAX_PREFIX_DEPTH; depth += 1) {
    const head = cursor[0];
    if (!head) break;
    const headName = lastPath(head.text);
    if (!PREFIX_WRAPPERS.has(headName)) break;
    if (!head.isLiteral) break;

    const consumed = consumePrefixArgs(headName, cursor.slice(1));
    cursor = cursor.slice(1 + consumed);
  }

  const head = cursor[0];
  if (!head) {
    return { binary: "", args: [], hasExpr };
  }

  return {
    binary: lastPath(head.text),
    args: cursor.slice(1).map((t) => t.text),
    hasExpr: hasExpr || cursor.some((t) => !t.isLiteral),
  };
}

