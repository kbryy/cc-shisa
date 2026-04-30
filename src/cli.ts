#!/usr/bin/env bun
import { runCheck } from "./cli/check.ts";
import { printHelp } from "./cli/help.ts";
import { runHook } from "./cli/hook.ts";
import { runInit } from "./cli/init.ts";
import { runLogs } from "./cli/logs.ts";
import { runModules } from "./cli/modules.ts";
import { runTest } from "./cli/test.ts";
import { VERSION } from "./version.ts";

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const sub = argv[0] ?? "hook";

  switch (sub) {
    case "hook":
      return runHook();
    case "check":
      return runCheck(argv[1]);
    case "test":
      return runTest(argv[1]);
    case "init":
      return runInit(argv[1]);
    case "modules":
      return runModules(argv.slice(1));
    case "logs":
      return runLogs(argv.slice(1));
    case "version":
    case "-v":
    case "--version":
      console.log(VERSION);
      return 0;
    case "help":
    case "-h":
    case "--help":
      printHelp();
      return 0;
    default:
      console.error(`cc-shisa: unknown subcommand "${sub}"`);
      printHelp();
      return 2;
  }
}

const code = await main().catch((err: unknown) => {
  console.error("cc-shisa: internal error", err);
  return 1;
});

process.exit(code);
