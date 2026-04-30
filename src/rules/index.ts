import coreData from "./data/_core.json" with { type: "json" };
import coreutilsData from "./data/coreutils.json" with { type: "json" };
import gitData from "./data/git.json" with { type: "json" };
import ghData from "./data/gh.json" with { type: "json" };
import pnpmData from "./data/pnpm.json" with { type: "json" };
import defaultProfileData from "./data/profiles/default.json" with { type: "json" };

import type { Action, Class, Level, Module, Profile, Rule } from "./types.ts";
import { discoverUserModules, readUserProfile } from "./user-config.ts";

export const MANDATORY_MODULE = "_core";

export const BUILTIN_MODULES: Readonly<Record<string, unknown>> = {
  _core: coreData,
  coreutils: coreutilsData,
  git: gitData,
  gh: ghData,
  pnpm: pnpmData,
};

const BUILTIN_NAMES: ReadonlySet<string> = new Set(Object.keys(BUILTIN_MODULES));

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

export function loadModule(name: string): Module {
  const data = BUILTIN_MODULES[name];
  if (data === undefined) {
    throw new Error(`unknown module: ${name}`);
  }
  return validateModule(data);
}

export interface ModuleEntry {
  name: string;
  source: "built-in" | "user";
  status: "on" | "off";
  module: Module;
}

/**
 * Walk both registries and report status against the resolved profile.
 * Used by `cc-shisa modules list`.
 */
export function listAllModules(env: NodeJS.ProcessEnv = process.env): readonly ModuleEntry[] {
  const profile = resolveProfile(env);
  const userModuleData = discoverUserModules(BUILTIN_NAMES, env);
  const enabled = new Set(profile.modules);
  enabled.add(MANDATORY_MODULE);

  const out: ModuleEntry[] = [];
  for (const [name, data] of Object.entries(BUILTIN_MODULES)) {
    out.push({
      name,
      source: "built-in",
      status: enabled.has(name) ? "on" : "off",
      module: validateModule(data),
    });
  }
  for (const [name, data] of userModuleData) {
    out.push({
      name,
      source: "user",
      status: "on",
      module: validateModule(data),
    });
  }
  return out;
}

/**
 * Resolve the active profile: user override at ~/.config/cc-shisa/profile.json
 * if present, else the built-in default. _core is always added because the
 * safety baseline is non-negotiable.
 */
export function resolveProfile(env: NodeJS.ProcessEnv = process.env): Profile {
  const raw = readUserProfile(env);
  const source: unknown = raw ?? defaultProfileData;
  const profile = validateProfile(source);
  if (!profile.modules.includes(MANDATORY_MODULE)) {
    return { ...profile, modules: [MANDATORY_MODULE, ...profile.modules] };
  }
  return profile;
}

export function loadDefaults(env: NodeJS.ProcessEnv = process.env): {
  modules: readonly Module[];
  profile: Profile;
  level: Level;
} {
  const profile = resolveProfile(env);
  const userModuleData = discoverUserModules(BUILTIN_NAMES, env);

  const seen = new Set<string>();
  const modules: Module[] = [];
  for (const name of profile.modules) {
    if (seen.has(name)) continue;
    seen.add(name);
    const builtIn = BUILTIN_MODULES[name];
    if (builtIn !== undefined) {
      modules.push(validateModule(builtIn));
      continue;
    }
    const user = userModuleData.get(name);
    if (user !== undefined) {
      modules.push(validateModule(user));
      continue;
    }
    if (env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: profile references unknown module "${name}"; skipping\n`);
    }
  }
  for (const [name, data] of userModuleData) {
    if (seen.has(name)) continue;
    seen.add(name);
    modules.push(validateModule(data));
  }
  return { modules, profile, level: safeLevel() };
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
    const subcommand = normalizeSubcommand(r["subcommand"], id);
    const base = {
      id,
      class: cls as Class,
      reason,
      match: "ast" as const,
      ...(subcommand !== undefined ? { subcommand } : {}),
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

function normalizeSubcommand(
  raw: unknown,
  ruleId: string,
): string | readonly [string, ...string[]] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === "string")) {
    return raw as [string, ...string[]];
  }
  throw new Error(`rule ${ruleId}: subcommand must be a string or non-empty string array`);
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
