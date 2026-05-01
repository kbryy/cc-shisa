import { classify } from "./classifier/index.ts";
import { parse } from "./parser/index.ts";
import { decide } from "./policy/index.ts";
import { loadDefaults } from "./rules/index.ts";
import type { Decision } from "./policy/types.ts";
import type { Level, Module, Profile } from "./rules/types.ts";

type DefaultsContext = { modules: readonly Module[]; profile: Profile; level: Level };

let cachedNoCwd: DefaultsContext | null = null;

/**
 * Run a Bash command string through parse → classify → decide. When `cwd`
 * is provided, locations.json is consulted at the boundary so the active
 * directory's per-location profile applies. Without `cwd`, the user-global
 * profile is used (and cached, since it does not vary).
 */
export function evaluate(command: string, cwd?: string): Decision {
  const ctx =
    cwd === undefined
      ? (cachedNoCwd ??= loadDefaults())
      : loadDefaults(process.env, cwd);
  const parseResult = parse(command);
  const classification = classify(parseResult, ctx.modules);
  return decide(classification, ctx.profile, ctx.level);
}
