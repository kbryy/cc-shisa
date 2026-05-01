import {
  type LocationEntry,
  type LocationsConfig,
  normalizePath,
  type NormalizedPath,
  readLocations,
  writeLocations,
} from "../rules/locations.ts";

export function runLocations(args: readonly string[]): number {
  const sub = args[0] ?? "list";
  switch (sub) {
    case "list":
      return list();
    case "unset":
      return unset(args[1]);
    default:
      process.stderr.write(`cc-shisa locations: unknown subcommand "${sub}"\n`);
      return 2;
  }
}

function list(): number {
  const config = readLocations();
  const entries = Object.entries(config);
  if (entries.length === 0) {
    console.log("(no location entries)");
    console.log("Use 'cc-shisa here set-level <name>' or 'cc-shisa here set-override <class> <action>' to add one.");
    return 0;
  }
  for (const [path, entry] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(path);
    if (entry.level !== undefined) console.log(`  level: ${entry.level}`);
    if (entry.overrides !== undefined) {
      console.log("  overrides:");
      for (const [cls, action] of Object.entries(entry.overrides)) {
        console.log(`    ${cls.padEnd(22)} ${action}`);
      }
    }
  }
  return 0;
}

function unset(rawPath: string | undefined): number {
  if (rawPath === undefined) {
    process.stderr.write("usage: cc-shisa locations unset <path>\n");
    return 2;
  }
  let target: NormalizedPath;
  try {
    target = normalizePath(rawPath);
  } catch (err) {
    process.stderr.write(`cc-shisa locations unset: cannot resolve ${rawPath}: ${(err as Error).message}\n`);
    return 1;
  }
  const config = readLocations();
  if (!(target in config)) {
    console.log(`(no location entry for ${target})`);
    return 0;
  }
  const updated = withoutKey(config, target);
  writeLocations(updated);
  console.log(`removed location entry for ${target}`);
  return 0;
}

function withoutKey(config: LocationsConfig, path: NormalizedPath): LocationsConfig {
  const { [path]: _omit, ...rest } = config;
  return rest as LocationsConfig;
}
