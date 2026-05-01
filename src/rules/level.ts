import type { Class, Level } from "./types.ts";

const STRICTNESS: Readonly<Record<Class, number>> = {
  dangerous: 8,
  "irreversible-remote": 7,
  "irreversible-local": 6,
  eval: 5,
  "write-remote": 4,
  unknown: 3,
  "write-local": 2,
  "read-remote": 1,
  "read-local": 0,
};

export function strictnessRank(c: Class): number {
  return STRICTNESS[c];
}

/**
 * "strict" — ask before anything that mutates or hits the network;
 * deny anything that touches remote state irrecoverably or evaluates
 * a constructed string. Only local read commands flow silently.
 */
export function strictLevel(): Level {
  return {
    name: "strict",
    mapping: {
      dangerous: "deny",
      "irreversible-remote": "deny",
      "irreversible-local": "deny",
      eval: "deny",
      "write-remote": "deny",
      "write-local": "ask",
      unknown: "ask",
      "read-remote": "ask",
      "read-local": "allow",
    },
  };
}

/**
 * "safe" — the default. Only dangerous deny; irreversible (remote+local) /
 * eval / write-remote / unknown ask; everything else flows.
 */
export function safeLevel(): Level {
  return {
    name: "safe",
    mapping: {
      dangerous: "deny",
      "irreversible-remote": "ask",
      "irreversible-local": "ask",
      eval: "ask",
      "write-remote": "ask",
      "write-local": "allow",
      unknown: "ask",
      "read-remote": "allow",
      "read-local": "allow",
    },
  };
}

/**
 * "loose" — dangerous still denied, irreversible-remote still asks
 * (force-push / push --delete / publish-style remote destruction is
 * always worth confirming), but local irreversible ops, eval, and
 * unknown auto-allow. For trusted laptops / sandboxes / CI agents.
 */
export function looseLevel(): Level {
  return {
    name: "loose",
    mapping: {
      dangerous: "deny",
      "irreversible-remote": "ask",
      "irreversible-local": "allow",
      eval: "allow",
      "write-remote": "allow",
      "write-local": "allow",
      unknown: "allow",
      "read-remote": "allow",
      "read-local": "allow",
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
