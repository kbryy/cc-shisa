import type { Action } from "../rules/types.ts";

/** PreToolUse hook input as delivered by Claude Code on stdin. */
export interface HookInput {
  tool_name: string;
  tool_input: ToolInput;
  cwd?: string;
  hook_event_name?: string;
}

export interface ToolInput {
  command: string;
}

/** PreToolUse hook output. Claude Code reads this JSON from stdout. */
export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: Action;
    permissionDecisionReason?: string;
  };
}
