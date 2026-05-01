import {
  applyLocation,
  findLocation,
  type LocationEntry,
  type LocationsConfig,
  normalizePath,
  type NormalizedPath,
  readLocations,
  writeLocations,
} from "../rules/locations.ts";
import { LEVEL_NAMES, levelByName } from "../rules/level.ts";
import { resolveProfile } from "../rules/index.ts";
import type { Action, Class } from "../rules/types.ts";
import { VALID_ACTIONS, VALID_CLASSES } from "../rules/validate.ts";

export function runHere(args: readonly string[]): number {
  const sub = args[0];
  if (sub === undefined) return showHere();
  switch (sub) {
    case "set-level":
      return setLevel(args[1]);
    case "set-override":
      return setOverride(args[1], args[2]);
    case "clear-override":
      return clearOverride(args[1]);
    case "unset":
      return unsetHere();
    default:
      process.stderr.write(`cc-shisa here: unknown subcommand "${sub}"\n`);
      return 2;
  }
}

function showHere(): number {
  const cwd = currentNormalizedPath();
  const config = readLocations();
  const match = findLocation(cwd, config);
  const userProfile = resolveProfile();

  console.log(`cwd:      ${cwd}`);
  if (match === null) {
    console.log("source:   user profile (no matching location entry)");
    console.log(`level:    ${userProfile.level}`);
    printOverrides(userProfile.overrides);
    return 0;
  }

  console.log(`location: ${match.path}`);
  console.log("source:   location override");
  const effective = applyLocation(userProfile, match.entry);
  console.log(`level:    ${effective.level}${match.entry.level !== undefined ? " (location)" : " (user)"}`);
  printOverrides(effective.overrides, match.entry.overrides);

  // Reaching levelByName here surfaces typos in the location entry early
  // (debug message via env). Result is unused for display but the side
  // effect — debug log on unknown level — matters.
  levelByName(effective.level);
  return 0;
}

function setLevel(name: string | undefined): number {
  if (name === undefined) {
    process.stderr.write("usage: cc-shisa here set-level <strict|safe|loose>\n");
    return 2;
  }
  if (!LEVEL_NAMES.includes(name)) {
    process.stderr.write(`cc-shisa here: unknown level "${name}". Choose one of: ${LEVEL_NAMES.join(", ")}\n`);
    return 2;
  }
  const cwd = currentNormalizedPath();
  const config = readLocations();
  const updated = updateEntry(config, cwd, (e) => ({ ...e, level: name }));
  writeLocations(updated);
  console.log(`set level=${name} for ${cwd}`);
  return 0;
}

function setOverride(rawClass: string | undefined, rawAction: string | undefined): number {
  if (rawClass === undefined || rawAction === undefined) {
    process.stderr.write("usage: cc-shisa here set-override <class> <allow|ask|deny>\n");
    return 2;
  }
  if (!VALID_CLASSES.has(rawClass as Class)) {
    process.stderr.write(`cc-shisa here: unknown class "${rawClass}"\n`);
    return 2;
  }
  if (!VALID_ACTIONS.has(rawAction as Action)) {
    process.stderr.write(`cc-shisa here: unknown action "${rawAction}". Choose one of: allow, ask, deny\n`);
    return 2;
  }
  const cls = rawClass as Class;
  const action = rawAction as Action;
  const cwd = currentNormalizedPath();
  const config = readLocations();
  const updated = updateEntry(config, cwd, (e) => ({
    ...e,
    overrides: { ...(e.overrides ?? {}), [cls]: action },
  }));
  writeLocations(updated);
  console.log(`set override ${cls}=${action} for ${cwd}`);
  return 0;
}

function clearOverride(rawClass: string | undefined): number {
  if (rawClass === undefined) {
    process.stderr.write("usage: cc-shisa here clear-override <class>\n");
    return 2;
  }
  if (!VALID_CLASSES.has(rawClass as Class)) {
    process.stderr.write(`cc-shisa here: unknown class "${rawClass}"\n`);
    return 2;
  }
  const cls = rawClass as Class;
  const cwd = currentNormalizedPath();
  const config = readLocations();
  const existing = config[cwd];
  if (existing === undefined || existing.overrides === undefined || !(cls in existing.overrides)) {
    console.log(`(no override for ${cls} at ${cwd})`);
    return 0;
  }
  const remaining = withoutKey(existing.overrides, cls);
  const next: LocationEntry = {
    ...(existing.level !== undefined ? { level: existing.level } : {}),
    ...(Object.keys(remaining).length > 0 ? { overrides: remaining } : {}),
  };
  const updated = isEmpty(next) ? withoutKey(config, cwd) : { ...config, [cwd]: next };
  writeLocations(updated);
  console.log(`cleared override ${cls} at ${cwd}`);
  return 0;
}

function unsetHere(): number {
  const cwd = currentNormalizedPath();
  const config = readLocations();
  if (!(cwd in config)) {
    console.log(`(no location entry for ${cwd})`);
    return 0;
  }
  const updated = withoutKey(config, cwd);
  writeLocations(updated);
  console.log(`removed location entry for ${cwd}`);
  return 0;
}

function currentNormalizedPath(): NormalizedPath {
  return normalizePath(process.cwd());
}

function updateEntry(
  config: LocationsConfig,
  path: NormalizedPath,
  mutate: (current: LocationEntry) => LocationEntry,
): LocationsConfig {
  const current = config[path] ?? {};
  return { ...config, [path]: mutate(current) };
}

function printOverrides(
  overrides: Readonly<Partial<Record<Class, Action>>> | undefined,
  fromLocation?: Readonly<Partial<Record<Class, Action>>>,
): void {
  if (overrides === undefined || Object.keys(overrides).length === 0) {
    console.log("overrides:  (none)");
    return;
  }
  console.log("overrides:");
  for (const [cls, action] of Object.entries(overrides)) {
    const tag = fromLocation && cls in fromLocation ? "location" : "user";
    console.log(`  ${cls.padEnd(22)} ${action} (${tag})`);
  }
}

function withoutKey<T extends Record<string, unknown>>(obj: T, key: keyof T): T {
  const { [key]: _omit, ...rest } = obj;
  return rest as T;
}

function isEmpty(entry: LocationEntry): boolean {
  return entry.level === undefined && entry.overrides === undefined;
}
