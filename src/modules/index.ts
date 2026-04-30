import {
  listAllModules,
  MANDATORY_MODULE,
  resolveProfile,
  type ModuleEntry,
} from "../rules/index.ts";
import {
  readUserProfile,
  userProfilePath,
  writeUserProfile,
  type RawProfile,
} from "../rules/user-config.ts";
import { runPick, type PickConfig, type PickResult } from "./pick.ts";

export type ChangeStatus = "added" | "removed" | "already-on" | "already-off" | "noop-mandatory" | "unknown";

export interface ChangeResult {
  name: string;
  status: ChangeStatus;
}

export function renderList(entries: readonly ModuleEntry[]): string {
  const header = ["NAME", "STATUS", "SOURCE", "RULES", "DESCRIPTION"] as const;
  const rows = entries.map((e) => [
    e.name,
    e.name === MANDATORY_MODULE ? "on (locked)" : e.status,
    e.source,
    String(e.module.rules.length),
    e.module.description ?? "",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [fmt(header), ...rows.map(fmt)].join("\n");
}

export function listModules(env: NodeJS.ProcessEnv = process.env): string {
  return renderList(listAllModules(env));
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
  return { level: resolved.level, modules: [...resolved.modules].filter((m) => m !== MANDATORY_MODULE) };
}

export function profilePathHint(env: NodeJS.ProcessEnv = process.env): string {
  return userProfilePath(env);
}

export interface PickOutcome {
  saved: boolean;
  added: readonly string[];
  removed: readonly string[];
}

export function pickWith(
  io: Pick<PickConfig, "readLine" | "write">,
  env: NodeJS.ProcessEnv = process.env,
): PickOutcome {
  const all = listAllModules(env);
  const optional = all.filter(
    (m) => m.source === "built-in" && m.name !== MANDATORY_MODULE,
  );
  const initiallyEnabled = new Set(
    all.filter((m) => m.status === "on" && m.name !== MANDATORY_MODULE).map((m) => m.name),
  );

  const result: PickResult = runPick({
    modules: optional.map((m) => ({
      name: m.name,
      description: m.module.description ?? "",
    })),
    initiallyEnabled,
    readLine: io.readLine,
    write: io.write,
  });

  if (!result.saved) {
    return { saved: false, added: [], removed: [] };
  }

  const added = [...result.finalEnabled].filter((n) => !initiallyEnabled.has(n));
  const removed = [...initiallyEnabled].filter((n) => !result.finalEnabled.has(n));

  if (added.length > 0 || removed.length > 0) {
    const profile = readUserProfile(env) ?? { level: "safe", modules: [] };
    profile.modules = [...result.finalEnabled];
    profile.level = profile.level ?? "safe";
    writeUserProfile(profile, env);
  }

  return { saved: true, added, removed };
}
