#!/usr/bin/env bun
/**
 * cc-shisa CLI entry. Phase 0 stub: only `version` and `help` are wired up.
 * `hook` returns a fail-safe ask payload (per Claude Code hook contract: must
 * exit 0 with stdout JSON, never crash). `check`/`test`/`init` print a
 * not-implemented message — they are not part of the hook contract.
 */

import { VERSION } from "./version.ts";
import type { HookOutput } from "./hookio/types.ts";

const PHASE0_ASK: HookOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason:
      "cc-shisa Phase 0 stub: enforcement not yet wired (asking by default)",
  },
};

function printHelp(): void {
  console.log(`cc-shisa — static analysis hook for Claude Code Bash tool

Usage:
  cc-shisa hook                  Read PreToolUse JSON from stdin, write decision to stdout
  cc-shisa check '<command>'     Evaluate a command and print the decision
  cc-shisa test [path]           Run testdata cases end-to-end
  cc-shisa init                  Register hook in ~/.claude/settings.json
  cc-shisa version               Print version

Environment:
  CC_SHISA_SHADOW=1              Force allow on every decision and log to ~/.local/state/cc-shisa/decisions.jsonl
  CC_SHISA_DEBUG=1               Print debug info to stderr`);
}

function notImplemented(name: string): number {
  console.error(`cc-shisa ${name}: not implemented yet (Phase 0 stub)`);
  return 1;
}

function emitFailSafeAsk(): number {
  process.stdout.write(JSON.stringify(PHASE0_ASK));
  return 0;
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const sub = argv[0] ?? "hook";

  switch (sub) {
    case "hook":
      return emitFailSafeAsk();
    case "check":
      return notImplemented("check");
    case "test":
      return notImplemented("test");
    case "init":
      return notImplemented("init");
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
