import type { Segment } from "../parser/types.ts";
import type { AstRule, RegexRule } from "../rules/types.ts";

/**
 * Expand a flag bundle string like "-rf" into ["-r", "-f"], split
 * "--long=value" into ["--long", "value"], and leave non-flag tokens or
 * already-split tokens alone.
 */
export function expandFlagBundle(args: readonly string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a === "-" || a === "--") {
      out.push(a);
      continue;
    }
    if (a.startsWith("--") && a.includes("=")) {
      const eq = a.indexOf("=");
      out.push(a.slice(0, eq), a.slice(eq + 1));
      continue;
    }
    if (a.startsWith("-") && !a.startsWith("--") && a.length > 2) {
      for (const ch of a.slice(1)) {
        out.push(`-${ch}`);
      }
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Return the positional arguments interpreted as paths. Tokens after a `--`
 * sentinel are all paths regardless of leading dash; otherwise non-flag
 * tokens are paths.
 */
export function extractPaths(args: readonly string[]): string[] {
  const expanded = expandFlagBundle(args);
  const out: string[] = [];
  let afterDash = false;
  for (const tok of expanded) {
    if (!afterDash && tok === "--") {
      afterDash = true;
      continue;
    }
    if (afterDash || !tok.startsWith("-")) {
      out.push(tok);
    }
  }
  return out;
}

/**
 * Match a Segment against an AstRule. Returns true when every constraint the
 * rule declares is satisfied: binary/binaries, optional subcommand, required
 * flags (AND), any_flags (OR), and path_globs (any-arg matches any-glob).
 */
export function matchAst(seg: Segment, rule: AstRule): boolean {
  if (rule.binary !== undefined) {
    if (seg.binary !== rule.binary) return false;
  } else {
    if (!rule.binaries.includes(seg.binary)) return false;
  }

  const expanded = expandFlagBundle(seg.args);

  if (rule.subcommand !== undefined) {
    const expected = typeof rule.subcommand === "string" ? [rule.subcommand] : rule.subcommand;
    const positionals = expanded.filter((t) => !t.startsWith("-"));
    for (let i = 0; i < expected.length; i += 1) {
      if (positionals[i] !== expected[i]) return false;
    }
  }

  if (rule.flags) {
    for (const f of rule.flags) {
      if (!expanded.includes(f)) return false;
    }
  }

  if (rule.any_flags) {
    if (!rule.any_flags.some((pat) => expanded.some((tok) => matchGlob(pat, tok)))) {
      return false;
    }
  }

  if (rule.excluded_flags) {
    if (rule.excluded_flags.some((pat) => seg.args.some((tok) => matchGlob(pat, tok)))) {
      return false;
    }
  }

  if (rule.path_globs) {
    const paths = extractPaths(seg.args);
    const matchesAny = paths.some((p) =>
      rule.path_globs!.some((g) => matchGlob(g, p)),
    );
    if (!matchesAny) return false;
  }

  return true;
}

const REGEX_CACHE = new Map<string, RegExp>();

/** Match a regex rule against the original command text. */
export function matchRegex(original: string, rule: RegexRule): boolean {
  let re = REGEX_CACHE.get(rule.pattern);
  if (!re) {
    re = new RegExp(rule.pattern);
    REGEX_CACHE.set(rule.pattern, re);
  }
  return re.test(original);
}

const GLOB_CACHE = new Map<string, Bun.Glob>();

function matchGlob(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  let g = GLOB_CACHE.get(pattern);
  if (!g) {
    g = new Bun.Glob(pattern);
    GLOB_CACHE.set(pattern, g);
  }
  return g.match(path);
}
