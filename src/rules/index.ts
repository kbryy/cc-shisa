import { BUILTIN_MODULES, BUILTIN_NAMES, defaultProfileData, MANDATORY_MODULE } from "./registry.ts";
import { levelByName } from "./level.ts";
import type { Level, Module, Profile } from "./types.ts";
import { discoverUserModules, readUserProfile } from "./user-config.ts";
import { validateModule, validateProfile } from "./validate.ts";

export { BUILTIN_MODULES, MANDATORY_MODULE } from "./registry.ts";
export {
  LEVEL_NAMES,
  levelByName,
  looseLevel,
  safeLevel,
  strictLevel,
  strictnessRank,
} from "./level.ts";

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
  return { modules, profile, level: levelByName(profile.level, env) };
}
