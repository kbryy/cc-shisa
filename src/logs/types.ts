import type { Action, Class } from "../rules/types.ts";

/** One JSONL row in the decisions log. shadow writes it; logs reads it. */
export interface LogEntry {
  ts: string;
  command: string;
  originalAction: Action;
  class: Class;
  reason: string;
  matchedRule?: string;
  segment?: string;
}
