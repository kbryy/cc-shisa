#!/usr/bin/env bun
/**
 * cc-shisa CLI entry. Subcommands: hook (default), check, test, init, version, help.
 * `init` is still a stub — Phase 4 territory.
 */

import { readInput, writeOutput } from "./hookio/index.ts";
import { defaultSettingsPath, runInit as runInitImpl } from "./init/index.ts";
import { evaluate } from "./pipeline.ts";
import { apply as applyShadow } from "./shadow/index.ts";
import { VERSION } from "./version.ts";

function printHelp(): void {
  console.log(`cc-shisa — static analysis hook for Claude Code Bash tool

Usage:
  cc-shisa hook                  Read PreToolUse JSON from stdin, write decision to stdout
  cc-shisa check '<command>'     Evaluate a command and print the decision
  cc-shisa test [path]           Run testdata cases end-to-end
  cc-shisa init                  Register hook in ~/.claude/settings.json (stub)
  cc-shisa version               Print version

Environment:
  CC_SHISA_SHADOW=1              Force allow on every decision and log to ~/.local/state/cc-shisa/decisions.jsonl
  CC_SHISA_DEBUG=1               Print debug info to stderr`);
}

function emitFailSafeAsk(reason: string): void {
  writeOutput("ask", reason);
}

async function runHook(): Promise<number> {
  let input;
  try {
    input = await readInput();
  } catch (err) {
    if (process.env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: ${(err as Error).message}\n`);
    }
    emitFailSafeAsk("cc-shisa could not read hook input; asking for safety");
    return 0;
  }

  if (input.tool_name !== "Bash") {
    emitFailSafeAsk(`cc-shisa only handles Bash; got ${input.tool_name}`);
    return 0;
  }

  try {
    const decision = evaluate(input.tool_input.command);
    const finalDecision = applyShadow(decision, input.tool_input.command);
    writeOutput(finalDecision.action, finalDecision.reason);
    return 0;
  } catch (err) {
    if (process.env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: ${(err as Error).message}\n`);
    }
    emitFailSafeAsk("cc-shisa internal error; asking for safety");
    return 0;
  }
}

function runCheck(cmd: string | undefined): number {
  if (cmd === undefined || cmd === "") {
    process.stderr.write("usage: cc-shisa check '<command>'\n");
    return 2;
  }
  const decision = evaluate(cmd);
  console.log(`Action:  ${decision.action}`);
  console.log(`Class:   ${decision.class}`);
  console.log(`Reason:  ${decision.reason}`);
  if (decision.matchedRule !== undefined) {
    console.log(`Rule:    ${decision.matchedRule}`);
  }
  if (decision.segment !== undefined) {
    console.log(`Segment: ${decision.segment}`);
  }
  return 0;
}

interface FixtureCase {
  name: string;
  command: string;
  expect: { action: string; class?: string; ruleId?: string };
}

async function runTest(pathArg: string | undefined): Promise<number> {
  const path = pathArg ?? "tests/fixtures/cases.json";
  let cases: FixtureCase[];
  try {
    cases = (await Bun.file(path).json()) as FixtureCase[];
  } catch (err) {
    process.stderr.write(`cc-shisa test: failed to load ${path}: ${(err as Error).message}\n`);
    return 2;
  }

  let pass = 0;
  let fail = 0;
  for (const tc of cases) {
    const d = evaluate(tc.command);
    const ok =
      d.action === tc.expect.action &&
      (tc.expect.class === undefined || d.class === tc.expect.class) &&
      (tc.expect.ruleId === undefined || d.matchedRule === tc.expect.ruleId);
    if (ok) {
      pass += 1;
    } else {
      fail += 1;
      console.log(
        `FAIL  ${tc.name}\n  cmd:      ${tc.command}\n  expected: ${tc.expect.action}${tc.expect.class ? `/${tc.expect.class}` : ""}${tc.expect.ruleId ? ` (${tc.expect.ruleId})` : ""}\n  got:      ${d.action}/${d.class}${d.matchedRule ? ` (${d.matchedRule})` : ""}`,
      );
    }
  }
  console.log(`\n${pass} pass, ${fail} fail (of ${cases.length})`);
  return fail > 0 ? 1 : 0;
}

function runInit(pathArg: string | undefined): number {
  let path: string;
  try {
    path = pathArg ?? defaultSettingsPath();
  } catch (err) {
    process.stderr.write(`cc-shisa init: ${(err as Error).message}\n`);
    return 1;
  }
  const result = runInitImpl(path);
  console.log(result.message);
  return result.status === "error" ? 1 : 0;
}

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
