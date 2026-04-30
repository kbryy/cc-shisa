import type { Action } from "../rules/types.ts";
import type { HookInput, HookOutput } from "./types.ts";

/**
 * Read the entire stdin payload and validate it as a Claude Code PreToolUse
 * HookInput. Throws on non-JSON or shape mismatches; the caller is expected
 * to emit a fail-safe ask and exit 0 in that case.
 */
export async function readInput(): Promise<HookInput> {
  const text = await Bun.stdin.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`hookio: invalid JSON on stdin: ${(err as Error).message}`);
  }
  return validateInput(raw);
}

function validateInput(raw: unknown): HookInput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("hookio: input must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj["tool_name"] !== "string") {
    throw new Error("hookio: missing tool_name");
  }
  const ti = obj["tool_input"];
  if (typeof ti !== "object" || ti === null) {
    throw new Error("hookio: missing tool_input");
  }
  const tiObj = ti as Record<string, unknown>;
  if (typeof tiObj["command"] !== "string") {
    throw new Error("hookio: missing tool_input.command");
  }
  return {
    tool_name: obj["tool_name"],
    tool_input: { command: tiObj["command"] },
    ...(typeof obj["cwd"] === "string" ? { cwd: obj["cwd"] } : {}),
    ...(typeof obj["hook_event_name"] === "string"
      ? { hook_event_name: obj["hook_event_name"] }
      : {}),
  };
}

/** Serialize a HookOutput JSON to stdout. No newline; Claude Code reads the entire stream. */
export function writeOutput(action: Action, reason?: string): void {
  const payload: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: action,
      ...(reason !== undefined ? { permissionDecisionReason: reason } : {}),
    },
  };
  process.stdout.write(JSON.stringify(payload));
}
