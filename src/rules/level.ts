import type { Class, Level } from "./types.ts";

const STRICTNESS: Readonly<Record<Class, number>> = {
  // Flat specials
  dangerous: 8,
  dynamic: 5,
  unknown: 3,
  // Local hierarchy
  "local.read": 0,
  "local.write": 2,
  "local.write.destroy": 6,
  // Remote hierarchy
  "remote.read": 1,
  "remote.write": 4,
  "remote.write.destroy": 7,
};

export function strictnessRank(c: Class): number {
  return STRICTNESS[c];
}

/**
 * "strict" — for shared-resource environments (work / corp). Block any
 * remote write outright (push, publish, gh pr create) so the agent
 * cannot silently mutate something other people see. Local destructive
 * ops still ask. Routine local writes flow.
 */
export function strictLevel(): Level {
  return {
    name: "strict",
    mapping: {
      dangerous: "deny",
      dynamic: "ask",
      unknown: "ask",
      "local.read": "allow",
      "local.write": "allow",
      "local.write.destroy": "ask",
      "remote.read": "allow",
      "remote.write": "deny",
      "remote.write.destroy": "deny",
    },
  };
}

/**
 * "safe" — the default. Ask before destroy / dynamic content / unknown
 * binaries; routine reads + writes (including remote writes like
 * git push and npm publish) flow. Personal-use baseline.
 */
export function safeLevel(): Level {
  return {
    name: "safe",
    mapping: {
      dangerous: "deny",
      dynamic: "ask",
      unknown: "ask",
      "local.read": "allow",
      "local.write": "allow",
      "local.write.destroy": "ask",
      "remote.read": "allow",
      "remote.write": "allow",
      "remote.write.destroy": "ask",
    },
  };
}

/**
 * "loose" — sandbox / CI / trusted laptop. Only the catastrophic
 * `dangerous` patterns are blocked; everything else flows without
 * prompting. Use this when cc-shisa should be a "stop the truly
 * disastrous, get out of the way otherwise" guard.
 */
export function looseLevel(): Level {
  return {
    name: "loose",
    mapping: {
      dangerous: "deny",
      dynamic: "allow",
      unknown: "allow",
      "local.read": "allow",
      "local.write": "allow",
      "local.write.destroy": "allow",
      "remote.read": "allow",
      "remote.write": "allow",
      "remote.write.destroy": "allow",
    },
  };
}

const LEVELS: Readonly<Record<string, () => Level>> = {
  strict: strictLevel,
  safe: safeLevel,
  loose: looseLevel,
};

export const LEVEL_NAMES: readonly string[] = ["strict", "safe", "loose"];

/**
 * Resolve a level by name. Unknown names fall back to safe; an optional
 * env can be passed so callers may emit a debug note. We never throw —
 * a typo in profile.level should never break the hook.
 */
export function levelByName(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Level {
  const factory = LEVELS[name];
  if (factory !== undefined) return factory();
  if (env["CC_SHISA_DEBUG"] === "1") {
    process.stderr.write(`cc-shisa: unknown level "${name}"; falling back to safe\n`);
  }
  return safeLevel();
}
