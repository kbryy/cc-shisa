import { appendFileSync, mkdirSync } from "node:fs";

import { defaultLogDir, LOG_FILENAME } from "../logs/path.ts";
import type { LogEntry } from "../logs/types.ts";
import type { Decision } from "../policy/types.ts";

const SHADOW_ENV = "CC_SHISA_SHADOW";
const LOG_ENV = "CC_SHISA_LOG";

export function isShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHADOW_ENV] === "1";
}

/**
 * True when decisions should be logged to JSONL — either because shadow mode
 * is on (which always logs) or because CC_SHISA_LOG=1 was set explicitly to
 * keep enforcement intact while still capturing an audit trail.
 */
export function isLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LOG_ENV] === "1" || isShadowEnabled(env);
}

/**
 * Compose enforcement and logging behaviour:
 *
 * - CC_SHISA_SHADOW=1               force allow + log + tag the reason
 * - CC_SHISA_LOG=1 (without shadow) keep the original decision + log
 * - neither                          pass the decision through unchanged
 *
 * Log write failures are swallowed silently — losing one line is preferable
 * to crashing the user's session over a disk problem.
 */
export function apply(
  decision: Decision,
  command: string,
  options: { logDir?: string; env?: NodeJS.ProcessEnv } = {},
): Decision {
  const env = options.env ?? process.env;
  const shadow = isShadowEnabled(env);
  const log = isLogEnabled(env);

  if (!shadow && !log) return decision;

  if (log) {
    const dir = options.logDir ?? defaultLogDir(env);
    writeLogEntry(dir, {
      ts: new Date().toISOString(),
      command,
      originalAction: decision.action,
      class: decision.class,
      reason: decision.reason,
      ...cloneDecisionMeta(decision),
    });
  }

  if (!shadow) return decision;

  return {
    action: "allow",
    class: decision.class,
    reason: `${decision.reason} (shadow: would have been ${decision.action})`,
    ...cloneDecisionMeta(decision),
  };
}

function cloneDecisionMeta(d: Decision): Pick<Decision, "matchedRule" | "segment"> {
  return {
    ...(d.matchedRule !== undefined ? { matchedRule: d.matchedRule } : {}),
    ...(d.segment !== undefined ? { segment: d.segment } : {}),
  };
}

function writeLogEntry(dir: string, entry: LogEntry): void {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(`${dir}/${LOG_FILENAME}`, `${JSON.stringify(entry)}\n`);
  } catch {
    // intentionally swallow — logging must never break the hook flow
  }
}
