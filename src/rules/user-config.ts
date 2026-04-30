import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
