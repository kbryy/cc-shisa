import type { Word } from "./walker.ts";

const PREFIX_WRAPPERS = new Set([
  "sudo",
  "timeout",
  "nice",
  "ionice",
  "env",
  "exec",
  "command",
  "time",
]);

const MAX_PREFIX_DEPTH = 2;

/** Strip the directory portion from a binary path: `/usr/bin/sudo` → `sudo`. */
export function lastPath(s: string): string {
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

/**
 * Flatten a Word to its literal string if it contains no expansion;
 * return null if any expansion was present (variable, command sub, etc.).
 */
export function litString(word: Word): string | null {
  if (word.expansion && word.expansion.length > 0) return null;
  return word.text;
}

interface ResolvedToken {
  text: string;
  isLiteral: boolean;
}

export function resolveWord(word: Word): ResolvedToken {
  const lit = litString(word);
  return lit !== null
    ? { text: lit, isLiteral: true }
    : { text: "<expr>", isLiteral: false };
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
  let i = 0;

  while (i < rest.length) {
    const tok = rest[i];
    if (!tok) break;
    const t = tok.text;

    if (!t.startsWith("-")) break;

    if (prefix === "sudo") {
      if (t === "--") {
        i += 1;
        break;
      }
      if (t === "-u" || t === "-g" || t === "-p" || t === "-h" || t === "-C" || t === "-D" || t === "-r" || t === "-t" || t === "-T") {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (prefix === "timeout") {
      if (t === "--") {
        i += 1;
        break;
      }
      if (t === "-s" || t === "-k" || t === "--signal" || t === "--kill-after") {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (prefix === "nice" || prefix === "ionice") {
      if (t === "--") {
        i += 1;
        break;
      }
      if (t === "-n" || t === "-c" || t === "-p") {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (prefix === "env") {
      if (t === "--") {
        i += 1;
        break;
      }
      if (t === "-u" || t === "-C" || t === "-S") {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (prefix === "exec" || prefix === "command" || prefix === "time") {
      if (t === "--") {
        i += 1;
        break;
      }
      if (prefix === "exec" && t === "-a") {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    break;
  }

  if (prefix === "timeout" || prefix === "nice" || prefix === "ionice") {
    if (i < rest.length && rest[i] && !rest[i]!.text.startsWith("-")) {
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

export type { ResolvedToken };
