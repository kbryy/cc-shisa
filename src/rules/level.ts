import type { Class, Level } from "./types.ts";

const STRICTNESS: Readonly<Record<Class, number>> = {
  dangerous: 6,
  irreversible: 5,
  eval: 4,
  "write-remote": 3,
  unknown: 2,
  "write-local": 1,
  read: 0,
};

export function strictnessRank(c: Class): number {
  return STRICTNESS[c];
}

/**
 * "strict" — anything that is not a clear local or read operation
 * is denied or asked. `git push --force`, `eval`, `npm publish` etc.
 * become deny rather than ask.
 */
export function strictLevel(): Level {
  return {
    name: "strict",
    mapping: {
      dangerous: "deny",
      irreversible: "deny",
      eval: "deny",
      "write-remote": "deny",
      "write-local": "ask",
      unknown: "ask",
      read: "allow",
    },
  };
}

/**
 * "safe" — the default. Only dangerous commands deny outright;
 * irreversible / eval / write-remote / unknown ask;
 * write-local and read flow.
 */
export function safeLevel(): Level {
  return {
    name: "safe",
    mapping: {
      dangerous: "deny",
      irreversible: "ask",
      eval: "ask",
      "write-remote": "ask",
      "write-local": "allow",
      unknown: "ask",
      read: "allow",
    },
  };
}

/**
 * "loose" — dangerous still denied, but eval / write-remote / unknown
 * auto-allow. For trusted environments (your own laptop, sandboxes,
 * CI agents) where the goal is to keep cc-shisa as a dangerous-only
 * guard.
 */
export function looseLevel(): Level {
  return {
    name: "loose",
    mapping: {
      dangerous: "deny",
      irreversible: "ask",
      eval: "allow",
      "write-remote": "allow",
      "write-local": "allow",
      unknown: "allow",
      read: "allow",
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
