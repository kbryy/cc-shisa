import coreData from "./data/_core.json" with { type: "json" };
import defaultProfileData from "./data/profiles/default.json" with { type: "json" };

import type { Action, Class, Level, Module, Profile, Rule } from "./types.ts";

const STRICTNESS: Readonly<Record<Class, number>> = {
  dangerous: 6,
  irreversible: 5,
  "arbitrary-code": 4,
  "write-remote": 3,
  unknown: 2,
  "write-local": 1,
  read: 0,
};

export function strictnessRank(c: Class): number {
  return STRICTNESS[c];
}

export function safeLevel(): Level {
  return {
    name: "safe",
    mapping: {
      dangerous: "deny",
      irreversible: "ask",
      "arbitrary-code": "ask",
      "write-remote": "ask",
      "write-local": "allow",
      unknown: "ask",
      read: "allow",
    },
  };
}

export function loadDefaults(): {
  module: Module;
  profile: Profile;
  level: Level;
} {
  return {
    module: validateModule(coreData),
    profile: validateProfile(defaultProfileData),
    level: safeLevel(),
  };
}

const VALID_CLASSES: ReadonlySet<Class> = new Set([
  "dangerous",
  "irreversible",
  "arbitrary-code",
  "write-remote",
  "write-local",
  "read",
  "unknown",
]);

const VALID_ACTIONS: ReadonlySet<Action> = new Set(["allow", "ask", "deny"]);

function validateModule(data: unknown): Module {
  if (typeof data !== "object" || data === null) {
    throw new Error("module: expected object");
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj["name"] !== "string") {
    throw new Error("module: missing name");
  }
  if (!Array.isArray(obj["rules"])) {
    throw new Error("module: rules must be an array");
  }
  const rules: Rule[] = obj["rules"].map((r, i) => validateRule(r, i, obj["name"] as string));
  const description = typeof obj["description"] === "string" ? obj["description"] : undefined;
  return description !== undefined
    ? { name: obj["name"] as string, description, rules }
    : { name: obj["name"] as string, rules };
}

function validateRule(data: unknown, index: number, moduleName: string): Rule {
  if (typeof data !== "object" || data === null) {
    throw new Error(`${moduleName}.rules[${index}]: expected object`);
  }
  const r = data as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : null;
  if (id === null) {
    throw new Error(`${moduleName}.rules[${index}]: missing id`);
  }
  const cls = r["class"];
  if (typeof cls !== "string" || !VALID_CLASSES.has(cls as Class)) {
    throw new Error(`rule ${id}: invalid class`);
  }
  const reason = r["reason"];
  if (typeof reason !== "string" || reason.length === 0) {
    throw new Error(`rule ${id}: missing reason`);
  }

  if (r["match"] === "regex") {
    if (typeof r["pattern"] !== "string") {
      throw new Error(`rule ${id}: regex match needs pattern`);
    }
    return {
      id,
      class: cls as Class,
      reason,
      match: "regex",
      pattern: r["pattern"],
    };
  }

  if (r["match"] === "ast") {
    const binary = r["binary"];
    const binaries = r["binaries"];
    if (typeof binary !== "string" && !Array.isArray(binaries)) {
      throw new Error(`rule ${id}: ast match needs binary or binaries`);
    }
    const base = {
      id,
      class: cls as Class,
      reason,
      match: "ast" as const,
      ...(typeof r["subcommand"] === "string" ? { subcommand: r["subcommand"] } : {}),
      ...(Array.isArray(r["flags"]) ? { flags: r["flags"] as string[] } : {}),
      ...(Array.isArray(r["any_flags"]) ? { any_flags: r["any_flags"] as string[] } : {}),
      ...(Array.isArray(r["path_globs"]) ? { path_globs: r["path_globs"] as string[] } : {}),
    };
    if (typeof binary === "string") {
      return { ...base, binary };
    }
    if (Array.isArray(binaries) && binaries.length > 0 && binaries.every((x) => typeof x === "string")) {
      return { ...base, binaries: binaries as [string, ...string[]] };
    }
    throw new Error(`rule ${id}: ast match needs binary or non-empty binaries`);
  }

  throw new Error(`rule ${id}: invalid match kind`);
}

function validateProfile(data: unknown): Profile {
  if (typeof data !== "object" || data === null) {
    throw new Error("profile: expected object");
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj["level"] !== "string") {
    throw new Error("profile: missing level");
  }
  if (!Array.isArray(obj["modules"])) {
    throw new Error("profile: modules must be an array");
  }
  const overrides = obj["overrides"];
  const overridesValid: Partial<Record<Class, Action>> = {};
  if (overrides !== undefined) {
    if (typeof overrides !== "object" || overrides === null) {
      throw new Error("profile: overrides must be an object");
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (!VALID_CLASSES.has(k as Class)) {
        throw new Error(`profile: unknown override class ${k}`);
      }
      if (typeof v !== "string" || !VALID_ACTIONS.has(v as Action)) {
        throw new Error(`profile: invalid override action ${String(v)}`);
      }
      overridesValid[k as Class] = v as Action;
    }
  }

  return {
    level: obj["level"],
    modules: obj["modules"] as string[],
    ...(Object.keys(overridesValid).length > 0 ? { overrides: overridesValid } : {}),
  };
}
