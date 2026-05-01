/**
 * Static-analysis severity bucket assigned to a parsed segment.
 * Strictness ordering: dangerous > irreversible > eval > write-remote > unknown > write-local > read.
 *
 * `eval` covers commands that execute a constructed string whose content
 * cc-shisa cannot statically inspect (eval, bash -c, curl|sh, node -e, etc.).
 * Old name "arbitrary-code" is accepted as an alias by validateRule/validateProfile.
 */
export type Class =
  | "dangerous"
  | "irreversible"
  | "eval"
  | "write-remote"
  | "write-local"
  | "read"
  | "unknown";

/** Final decision returned to Claude Code. */
export type Action = "allow" | "ask" | "deny";

/** Match strategy. `ast` inspects resolved binary/subcommand/flags/paths; `regex` runs a pattern against Segment.raw. */
export type MatchKind = "ast" | "regex";

interface RuleBase {
  id: string;
  class: Class;
  reason: string;
}

type AstSelector =
  | { binary: string; binaries?: never }
  | { binary?: never; binaries: readonly [string, ...string[]] };

export type AstRule = RuleBase & { match: "ast" } & AstSelector & {
  subcommand?: string | readonly [string, ...string[]];
  flags?: readonly string[];
  any_flags?: readonly string[];
  excluded_flags?: readonly string[];
  path_globs?: readonly string[];
};

export type RegexRule = RuleBase & {
  match: "regex";
  pattern: string;
};

/**
 * A single rule definition, loaded from JSON. Discriminated by `match`:
 * `ast` rules constrain by binary/subcommand/flags/paths,
 * `regex` rules match against the rendered segment text.
 */
export type Rule = AstRule | RegexRule;

/** A bundle of related rules. */
export interface Module {
  name: string;
  description?: string;
  rules: readonly Rule[];
}

/** Maps each Class to an Action. The bundled "safe" level lives in code, not JSON. */
export interface Level {
  name: string;
  mapping: Readonly<Record<Class, Action>>;
}

/** Selects a level + which modules to apply, with optional per-class overrides. */
export interface Profile {
  level: string;
  modules: readonly string[];
  overrides?: Readonly<Partial<Record<Class, Action>>>;
}
