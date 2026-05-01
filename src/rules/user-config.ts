import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Class } from "./types.ts";
import { VALID_CLASSES } from "./validate.ts";

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env["XDG_CONFIG_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : `${env["HOME"] ?? ""}/.config`;
  return `${base}/cc-shisa`;
}

export function userProfilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "profile.json");
}

export function userModulesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "modules");
}

/**
 * Discover JSON modules under the user modules directory. Skips files whose
 * stem collides with a built-in module name (those names are reserved by
 * cc-shisa to keep the safety baseline immutable). Files that fail to parse
 * are reported on stderr and skipped — one bad file should not break the
 * whole hook.
 */
export function discoverUserModules(
  reservedNames: ReadonlySet<string>,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, unknown> {
  const dir = userModulesDir(env);
  const out = new Map<string, unknown>();
  if (!existsSync(dir)) return out;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const name = file.slice(0, -".json".length);

    if (reservedNames.has(name)) {
      if (env["CC_SHISA_DEBUG"] === "1") {
        process.stderr.write(
          `cc-shisa: ignoring ~/.config/cc-shisa/modules/${file} — name "${name}" is reserved\n`,
        );
      }
      continue;
    }

    try {
      const data = JSON.parse(readFileSync(join(dir, file), "utf-8")) as unknown;
      out.set(name, data);
    } catch (err) {
      if (env["CC_SHISA_DEBUG"] === "1") {
        process.stderr.write(
          `cc-shisa: failed to load ${file}: ${(err as Error).message}\n`,
        );
      }
    }
  }
  return out;
}

export interface RawProfile {
  level?: string;
  modules?: string[];
}

export function readUserProfile(env: NodeJS.ProcessEnv = process.env): RawProfile | null {
  const path = userProfilePath(env);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as RawProfile;
  } catch (err) {
    if (env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: failed to read ${path}: ${(err as Error).message}\n`);
    }
    return null;
  }
}

export function writeUserProfile(profile: RawProfile, env: NodeJS.ProcessEnv = process.env): void {
  const path = userProfilePath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, "utf-8");
}

/**
 * Optional user whitelist for `python -c <code>` style inline content.
 * Lives at `~/.config/cc-shisa/interpreter.json` and lets users register
 * project-specific modules (e.g. openpyxl, python-pptx, pandas) that the
 * inspector should treat as a known class instead of falling back to
 * dynamic. Format:
 *
 *   {
 *     "python": {
 *       "modules": {
 *         "openpyxl":     "local.write",
 *         "python-pptx":  "local.write",
 *         "pandas":       "local.read"
 *       }
 *     }
 *   }
 */
export interface LanguageConfig {
  modules?: Readonly<Record<string, Class>>;
}

export interface InterpreterConfig {
  python?: LanguageConfig;
  node?: LanguageConfig;
  ruby?: LanguageConfig;
  perl?: LanguageConfig;
}

export function interpreterConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "interpreter.json");
}

export function readInterpreterConfig(
  env: NodeJS.ProcessEnv = process.env,
): InterpreterConfig | null {
  const path = interpreterConfigPath(env);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    if (env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: failed to parse ${path}: ${(err as Error).message}\n`);
    }
    return null;
  }
  return validateInterpreterConfig(raw, env);
}

function validateInterpreterConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv,
): InterpreterConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const out: InterpreterConfig = {};
  for (const lang of ["python", "node", "ruby", "perl"] as const) {
    const langCfg = parseLanguageConfig(obj[lang], lang, env);
    if (langCfg !== null) {
      out[lang] = langCfg;
    }
  }
  return out;
}

function parseLanguageConfig(
  raw: unknown,
  lang: string,
  env: NodeJS.ProcessEnv,
): LanguageConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const modulesRaw = (raw as Record<string, unknown>)["modules"];
  if (typeof modulesRaw !== "object" || modulesRaw === null) return null;
  const modules: Record<string, Class> = {};
  for (const [name, cls] of Object.entries(modulesRaw as Record<string, unknown>)) {
    if (typeof cls !== "string" || !VALID_CLASSES.has(cls as Class)) {
      if (env["CC_SHISA_DEBUG"] === "1") {
        process.stderr.write(
          `cc-shisa: interpreter.json ${lang}.modules["${name}"] has invalid class "${String(cls)}"; skipping\n`,
        );
      }
      continue;
    }
    modules[name] = cls as Class;
  }
  return Object.keys(modules).length > 0 ? { modules } : null;
}

