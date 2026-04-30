import { classify } from "./classifier/index.ts";
import { parse } from "./parser/index.ts";
import { decide } from "./policy/index.ts";
import { loadDefaults } from "./rules/index.ts";
import type { Decision } from "./policy/types.ts";
import type { Level, Module, Profile } from "./rules/types.ts";

let cached: { module: Module; profile: Profile; level: Level } | null = null;

function getDefaults(): { module: Module; profile: Profile; level: Level } {
  if (!cached) {
    cached = loadDefaults();
  }
  return cached;
}

/**
 * Run a Bash command string through parse → classify → decide using the
 * default safe profile + _core module. Used by the CLI hook handler and the
 * end-to-end fixture tests so they stay in lockstep.
 */
export function evaluate(command: string): Decision {
  const { module, profile, level } = getDefaults();
  const parseResult = parse(command);
  const classification = classify(parseResult, [module]);
  return decide(classification, profile, level);
}
