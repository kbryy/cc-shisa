/**
 * Static-analysis severity bucket assigned to a parsed segment.
 * Strictness ordering: dangerous > irreversible > arbitrary-code > write-remote > unknown > write-local > read.
 */
export type Class =
  | "dangerous"
  | "irreversible"
  | "arbitrary-code"
  | "write-remote"
  | "write-local"
  | "read"
  | "unknown";

/** Final decision returned to Claude Code. */
export type Action = "allow" | "ask" | "deny";

/** Match strategy. `ast` inspects resolved binary/subcommand/flags/paths; `regex` runs a pattern against Segment.raw. */
export type MatchKind = "ast" | "regex";

/** A single rule definition, loaded from JSON. `reason` is required because cc-shisa treats it as user-facing explanation. */
export interface Rule {
  id: string;
  match: MatchKind;
  pattern?: string;
  binary?: string;
  binaries?: string[];
  subcommand?: string;
  flags?: string[];
  any_flags?: string[];
  path_globs?: string[];
  class: Class;
  reason: string;
}

/** A bundle of related rules. */
export interface Module {
  name: string;
  description?: string;
  rules: Rule[];
}

/** Maps each Class to an Action. The bundled "safe" level lives in code, not JSON. */
export interface Level {
  name: string;
  mapping: Record<Class, Action>;
}

/** Selects a level + which modules to apply, with optional per-class overrides. */
export interface Profile {
  level: string;
  modules: string[];
  overrides?: Partial<Record<Class, Action>>;
}
