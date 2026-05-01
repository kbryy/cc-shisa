import {
  LEVEL_NAMES,
  levelByName,
  resolveProfile,
} from "../rules/index.ts";
import { readUserProfile, writeUserProfile } from "../rules/user-config.ts";

export function runLevel(args: readonly string[]): number {
  const sub = args[0] ?? "get";
  switch (sub) {
    case "list":
      return runLevelList();
    case "get":
      return runLevelGet();
    case "set":
      return runLevelSet(args[1]);
    default:
      process.stderr.write(`cc-shisa level: unknown subcommand "${sub}"\n`);
      return 2;
  }
}

const CLASS_COLUMNS = [
  "dangerous",
  "dynamic",
  "unknown",
  "local.read",
  "local.write",
  "local.write.destroy",
  "remote.read",
  "remote.write",
  "remote.write.destroy",
] as const;

function runLevelList(): number {
  const headers = ["NAME", ...CLASS_COLUMNS];
  const rows = LEVEL_NAMES.map((name) => {
    const lvl = levelByName(name);
    return [name, ...CLASS_COLUMNS.map((c) => lvl.mapping[c])];
  });
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  console.log([fmt(headers), ...rows.map(fmt)].join("\n"));
  return 0;
}

function runLevelGet(): number {
  const profile = resolveProfile();
  const lvl = levelByName(profile.level);
  console.log(`Level:   ${lvl.name}${profile.level !== lvl.name ? ` (requested "${profile.level}", fell back)` : ""}`);
  console.log("");
  console.log("Class                 Action");
  console.log("--------------------  ------");
  for (const cls of CLASS_COLUMNS) {
    const action = lvl.mapping[cls];
    const overridden = profile.overrides?.[cls];
    const effective = overridden ?? action;
    const note = overridden !== undefined ? `  (override: ${overridden})` : "";
    console.log(`${cls.padEnd(20)}  ${effective}${note}`);
  }
  return 0;
}

function runLevelSet(name: string | undefined): number {
  if (name === undefined || name === "") {
    process.stderr.write(`usage: cc-shisa level set <${LEVEL_NAMES.join("|")}>\n`);
    return 2;
  }
  if (!LEVEL_NAMES.includes(name)) {
    process.stderr.write(
      `cc-shisa level: unknown level "${name}". Valid: ${LEVEL_NAMES.join(", ")}\n`,
    );
    return 1;
  }
  const existing = readUserProfile();
  writeUserProfile({
    level: name,
    modules: existing?.modules ?? [],
  });
  console.log(`level: ${name}`);
  return 0;
}
