import type { Action, Class, Module, Profile, Rule } from "./types.ts";

export const VALID_CLASSES: ReadonlySet<Class> = new Set([
  // Flat specials
  "dangerous",
  "dynamic",
  "unknown",
  // Local hierarchy
  "local.read",
  "local.write",
  "local.write.destroy",
  // Remote hierarchy
  "remote.read",
  "remote.write",
  "remote.write.destroy",
]);

const VALID_ACTIONS: ReadonlySet<Action> = new Set(["allow", "ask", "deny"]);

export function validateModule(data: unknown): Module {
  if (typeof data !== "object" || data === null) {
    throw new Error("module: expected object");
  }
  const obj = data as Record<string, unknown>;
  const name = obj["name"];
  if (typeof name !== "string") {
    throw new Error("module: missing name");
  }
  if (!Array.isArray(obj["rules"])) {
    throw new Error("module: rules must be an array");
  }
  const rules: Rule[] = obj["rules"].map((r, i) => validateRule(r, i, name));
  const description = typeof obj["description"] === "string" ? obj["description"] : undefined;
  return description !== undefined
    ? { name, description, rules }
    : { name, rules };
}

export function validateRule(data: unknown, index: number, moduleName: string): Rule {
  if (typeof data !== "object" || data === null) {
    throw new Error(`${moduleName}.rules[${index}]: expected object`);
  }
  const r = data as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : null;
  if (id === null) {
    throw new Error(`${moduleName}.rules[${index}]: missing id`);
  }
  const rawCls = r["class"];
  if (typeof rawCls !== "string" || !VALID_CLASSES.has(rawCls as Class)) {
    throw new Error(`rule ${id}: invalid class "${String(rawCls)}"`);
  }
  const cls = rawCls as Class;
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
      class: cls,
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
      class: cls,
      reason,
      match: "ast" as const,
      ...(subcommand !== undefined ? { subcommand } : {}),
      ...(Array.isArray(r["flags"]) ? { flags: r["flags"] as string[] } : {}),
      ...(Array.isArray(r["any_flags"]) ? { any_flags: r["any_flags"] as string[] } : {}),
      ...(Array.isArray(r["excluded_flags"]) ? { excluded_flags: r["excluded_flags"] as string[] } : {}),
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

export function validateProfile(data: unknown): Profile {
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
        throw new Error(`profile: unknown override class "${k}"`);
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
