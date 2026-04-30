import { listAllModules, MANDATORY_MODULE, resolveProfile } from "../rules/index.ts";
import {
  readUserProfile,
  userProfilePath,
  writeUserProfile,
  type RawProfile,
} from "../rules/user-config.ts";

export type ChangeStatus =
  | "added"
  | "removed"
  | "already-on"
  | "already-off"
  | "noop-mandatory"
  | "unknown";

export interface ChangeResult {
  name: string;
  status: ChangeStatus;
}

export function enableModules(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ChangeResult[] {
  const known = knownNames(env);
  const profile = readOrInitProfile(env);
  const enabled = new Set(profile.modules ?? []);
  const results: ChangeResult[] = [];

  for (const name of names) {
    if (name === MANDATORY_MODULE) {
      results.push({ name, status: "noop-mandatory" });
      continue;
    }
    if (!known.has(name)) {
      results.push({ name, status: "unknown" });
      continue;
    }
    if (enabled.has(name)) {
      results.push({ name, status: "already-on" });
      continue;
    }
    enabled.add(name);
    results.push({ name, status: "added" });
  }

  if (results.some((r) => r.status === "added")) {
    writeUserProfile({ ...profile, modules: [...enabled] }, env);
  }
  return results;
}

export function disableModules(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ChangeResult[] {
  const profile = readOrInitProfile(env);
  const enabled = new Set(profile.modules ?? []);
  const results: ChangeResult[] = [];

  for (const name of names) {
    if (name === MANDATORY_MODULE) {
      results.push({ name, status: "noop-mandatory" });
      continue;
    }
    if (!enabled.has(name)) {
      results.push({ name, status: "already-off" });
      continue;
    }
    enabled.delete(name);
    results.push({ name, status: "removed" });
  }

  if (results.some((r) => r.status === "removed")) {
    writeUserProfile({ ...profile, modules: [...enabled] }, env);
  }
  return results;
}

export function profilePathHint(env: NodeJS.ProcessEnv = process.env): string {
  return userProfilePath(env);
}

function knownNames(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(listAllModules(env).map((m) => m.name));
}

function readOrInitProfile(env: NodeJS.ProcessEnv): RawProfile {
  const existing = readUserProfile(env);
  if (existing) {
    return {
      level: existing.level ?? "safe",
      modules: existing.modules ?? [],
    };
  }
  const resolved = resolveProfile(env);
  return {
    level: resolved.level,
    modules: [...resolved.modules].filter((m) => m !== MANDATORY_MODULE),
  };
}
