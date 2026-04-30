import {
  disableModules,
  enableModules,
  listModules,
  profilePathHint,
  runPickInteractive,
  type ChangeResult,
} from "../modules/index.ts";

export async function runModules(args: readonly string[]): Promise<number> {
  const sub = args[0] ?? "list";
  switch (sub) {
    case "list":
      console.log(listModules());
      return 0;
    case "enable":
      return runModulesChange(args.slice(1), enableModules);
    case "disable":
      return runModulesChange(args.slice(1), disableModules);
    case "pick":
      return runModulesPick();
    default:
      process.stderr.write(`cc-shisa modules: unknown subcommand "${sub}"\n`);
      return 2;
  }
}

async function runModulesPick(): Promise<number> {
  let outcome;
  try {
    outcome = await runPickInteractive();
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }

  if (!outcome.saved) {
    console.log("(cancelled — profile unchanged)");
    return 0;
  }
  if (outcome.added.length === 0 && outcome.removed.length === 0) {
    console.log("(no changes)");
    return 0;
  }
  for (const n of outcome.added) console.log(`+ ${n}`);
  for (const n of outcome.removed) console.log(`- ${n}`);
  console.log(`profile: ${profilePathHint()}`);
  return 0;
}

function runModulesChange(
  names: readonly string[],
  fn: (names: readonly string[]) => ChangeResult[],
): number {
  if (names.length === 0) {
    process.stderr.write("usage: cc-shisa modules <enable|disable> <name>...\n");
    return 2;
  }
  const results = fn(names);
  for (const r of results) {
    console.log(`${r.name}: ${r.status}`);
  }
  if (results.some((r) => r.status === "added" || r.status === "removed")) {
    console.log(`profile: ${profilePathHint()}`);
  }
  return results.some((r) => r.status === "unknown") ? 1 : 0;
}
