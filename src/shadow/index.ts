import { appendFileSync, mkdirSync } from "node:fs";

import type { Decision } from "../policy/types.ts";

const SHADOW_ENV = "CC_SHISA_SHADOW";
const LOG_FILENAME = "decisions.jsonl";

interface LogEntry {
  ts: string;
  command: string;
  originalAction: string;
  class: string;
  reason: string;
  matchedRule?: string;
  segment?: string;
}

export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHADOW_ENV] === "1";
}

/**
 * If shadow mode is enabled, override the action to "allow" and append a
 * JSONL line recording what the original decision would have been. Log
 * write failures are swallowed silently — letting the user's session break
 * over a log line is worse than a missing log entry.
 */
export function apply(
  decision: Decision,
  command: string,
  options: { logDir?: string; env?: NodeJS.ProcessEnv } = {},
): Decision {
  const env = options.env ?? process.env;
  if (!isEnabled(env)) return decision;

  const dir = options.logDir ?? defaultLogDir(env);
  writeLogEntry(dir, {
    ts: new Date().toISOString(),
    command,
    originalAction: decision.action,
    class: decision.class,
    reason: decision.reason,
    ...(decision.matchedRule !== undefined ? { matchedRule: decision.matchedRule } : {}),
    ...(decision.segment !== undefined ? { segment: decision.segment } : {}),
  });

  return {
    action: "allow",
    class: decision.class,
    reason: `${decision.reason} (shadow: would have been ${decision.action})`,
    ...(decision.matchedRule !== undefined ? { matchedRule: decision.matchedRule } : {}),
    ...(decision.segment !== undefined ? { segment: decision.segment } : {}),
  };
}

export function defaultLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env["XDG_STATE_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : `${env["HOME"] ?? ""}/.local/state`;
  return `${base}/cc-shisa`;
}

function writeLogEntry(dir: string, entry: LogEntry): void {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(`${dir}/${LOG_FILENAME}`, `${JSON.stringify(entry)}\n`);
  } catch {
    // intentionally swallow — logging must never break the hook flow
  }
}
