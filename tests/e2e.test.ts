import { describe, expect, test } from "bun:test";

import casesData from "./fixtures/cases.json" with { type: "json" };
import redteamData from "./fixtures/redteam.json" with { type: "json" };

import { classify } from "../src/classifier/index.ts";
import { parse } from "../src/parser/index.ts";
import { decide } from "../src/policy/index.ts";
import { BUILTIN_MODULES, loadModule, safeLevel } from "../src/rules/index.ts";
import type { Decision } from "../src/policy/types.ts";

interface FixtureCase {
  name: string;
  command: string;
  expect: { action: string; class?: string; ruleId?: string };
}

const cases: FixtureCase[] = casesData as FixtureCase[];
const redteam: FixtureCase[] = redteamData as FixtureCase[];

const allBuiltinModules = Object.keys(BUILTIN_MODULES).map(loadModule);
const level = safeLevel();
const fullProfile = { level: "safe" as const, modules: Object.keys(BUILTIN_MODULES) };

function evaluateWithAll(command: string): Decision {
  const result = parse(command);
  const cls = classify(result, allBuiltinModules);
  return decide(cls, fullProfile, level);
}

describe("e2e — cases.json fixtures", () => {
  for (const tc of cases) {
    test(tc.name, () => {
      const d = evaluateWithAll(tc.command);
      expect(d.action).toBe(tc.expect.action as never);
      if (tc.expect.class !== undefined) {
        expect(d.class).toBe(tc.expect.class as never);
      }
      if (tc.expect.ruleId !== undefined) {
        expect(d.matchedRule).toBe(tc.expect.ruleId);
      }
    });
  }
});

describe("e2e — redteam.json fixtures", () => {
  for (const tc of redteam) {
    test(tc.name, () => {
      const d = evaluateWithAll(tc.command);
      expect(d.action).toBe(tc.expect.action as never);
      if (tc.expect.class !== undefined) {
        expect(d.class).toBe(tc.expect.class as never);
      }
      if (tc.expect.ruleId !== undefined) {
        expect(d.matchedRule).toBe(tc.expect.ruleId);
      }
    });
  }
});

const SUBPROCESS_ENV = {
  ...process.env,
  XDG_CONFIG_HOME: `${process.cwd()}/tests/fixtures/full-profile`,
};

describe("e2e — full hook protocol via subprocess", () => {
  test("dangerous command → deny JSON, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "hook"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: SUBPROCESS_ENV,
    });
    proc.stdin.write(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
        cwd: "/tmp",
        hook_event_name: "PreToolUse",
      }),
    );
    await proc.stdin.end();
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("benign read command → allow JSON, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "hook"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: SUBPROCESS_ENV,
    });
    proc.stdin.write(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
      }),
    );
    await proc.stdin.end();
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  test("unmatched command → ask JSON, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "hook"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: SUBPROCESS_ENV,
    });
    proc.stdin.write(
      JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "totally-fictional-bin --do-things" },
      }),
    );
    await proc.stdin.end();
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  test("malformed JSON → fail-safe ask, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "hook"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: SUBPROCESS_ENV,
    });
    proc.stdin.write("not json");
    await proc.stdin.end();
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  test("non-Bash tool_name → fail-safe ask, exit 0", async () => {
    const proc = Bun.spawn(["bun", "run", "src/cli.ts", "hook"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: SUBPROCESS_ENV,
    });
    proc.stdin.write(
      JSON.stringify({
        tool_name: "Read",
        tool_input: { command: "anything" },
      }),
    );
    await proc.stdin.end();
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
  });
});
