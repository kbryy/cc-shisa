import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

import { LEVEL_NAMES } from "./level.ts";
import type { Action, Class, Profile } from "./types.ts";
import { configDir } from "./user-config.ts";
import { VALID_ACTIONS, VALID_CLASSES } from "./validate.ts";

/**
 * Branded path type. Forces callers to go through `normalizePath()` before
 * calling `findLocation` — catches "forgot to realpath" bugs at compile time.
 */
export type NormalizedPath = string & { readonly __brand: "NormalizedPath" };

export interface LocationEntry {
  readonly level?: string;
  readonly overrides?: Readonly<Partial<Record<Class, Action>>>;
}

export type LocationsConfig = Readonly<Record<string, LocationEntry>>;

const FILENAME = "locations.json";

export function locationsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), FILENAME);
}

export function readLocations(env: NodeJS.ProcessEnv = process.env): LocationsConfig {
  const path = locationsPath(env);
  if (!existsSync(path)) return {};

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    if (env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: failed to parse ${path}: ${(err as Error).message}\n`);
    }
    return {};
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    if (env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: ${path} root is not an object; ignoring\n`);
    }
    return {};
  }

  const out: Record<string, LocationEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseLocationEntry(value);
    if (entry === null) {
      if (env["CC_SHISA_DEBUG"] === "1") {
        process.stderr.write(`cc-shisa: ${path}["${key}"] is not a valid entry; skipping\n`);
      }
      continue;
    }
    out[key] = entry;
  }
  return out;
}

export function writeLocations(
  config: LocationsConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = locationsPath(env);
  mkdirSync(configDir(env), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

/**
 * Expand `~` and resolve to an absolute realpath. Always run input through
 * this before storing or looking up. Throws if the path cannot be resolved.
 */
export function normalizePath(input: string, env: NodeJS.ProcessEnv = process.env): NormalizedPath {
  const expanded = expandTilde(input, env);
  return realpathSync.native(expanded) as NormalizedPath;
}

/**
 * Same as `normalizePath` but returns `null` instead of throwing when the
 * path cannot be resolved (non-existent dir, broken symlink). Used by the
 * hook entry where a malformed `cwd` should fall back to the user profile.
 */
export function safeNormalizePath(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): NormalizedPath | null {
  try {
    return normalizePath(input, env);
  } catch {
    return null;
  }
}

/**
 * Find the longest-path-prefix entry whose key is an ancestor of `cwd`
 * (or equal to `cwd`). Caller MUST pass an already-normalized path.
 */
export function findLocation(
  cwd: NormalizedPath,
  config: LocationsConfig,
): { readonly path: NormalizedPath; readonly entry: LocationEntry } | null {
  let best: { path: string; entry: LocationEntry } | null = null;
  for (const [key, entry] of Object.entries(config)) {
    if (!isAncestorOrEqual(key, cwd)) continue;
    if (best === null || key.length > best.path.length) {
      best = { path: key, entry };
    }
  }
  if (best === null) return null;
  return { path: best.path as NormalizedPath, entry: best.entry };
}

/**
 * Apply a location entry on top of a user profile. Pure: the caller decides
 * how `cwd` resolution happens at the boundary.
 */
export function applyLocation(profile: Profile, entry: LocationEntry): Profile {
  const merged: Profile = {
    ...profile,
    ...(entry.level !== undefined ? { level: entry.level } : {}),
    ...(entry.overrides !== undefined
      ? { overrides: { ...profile.overrides, ...entry.overrides } }
      : {}),
  };
  return merged;
}

function expandTilde(input: string, env: NodeJS.ProcessEnv): string {
  if (input === "~") {
    const home = env["HOME"];
    if (home === undefined || home === "") {
      throw new Error("cannot expand ~: HOME is not set");
    }
    return home;
  }
  if (input.startsWith("~/")) {
    const home = env["HOME"];
    if (home === undefined || home === "") {
      throw new Error("cannot expand ~/: HOME is not set");
    }
    return join(home, input.slice(2));
  }
  return input;
}

function isAncestorOrEqual(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  return descendant.startsWith(ancestor + sep);
}

function parseLocationEntry(raw: unknown): LocationEntry | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const level = parseLevel(obj["level"]);
  if (level === "invalid") return null;

  const overrides = parseOverrides(obj["overrides"]);
  if (overrides === "invalid") return null;

  if (level === undefined && overrides === undefined) return null;

  return {
    ...(level !== undefined ? { level } : {}),
    ...(overrides !== undefined ? { overrides } : {}),
  };
}

function parseLevel(raw: unknown): string | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return "invalid";
  if (!LEVEL_NAMES.includes(raw)) return "invalid";
  return raw;
}

function parseOverrides(
  raw: unknown,
): Readonly<Partial<Record<Class, Action>>> | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "invalid";

  const out: Partial<Record<Class, Action>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_CLASSES.has(k as Class)) return "invalid";
    if (typeof v !== "string" || !VALID_ACTIONS.has(v as Action)) return "invalid";
    out[k as Class] = v as Action;
  }
  if (Object.keys(out).length === 0) return undefined;
  return out;
}
