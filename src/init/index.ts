import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const HOOK_COMMAND = "cc-shisa hook";
const HOOK_TIMEOUT = 10;
const MATCHER = "Bash";

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}

interface MatcherEntry {
  matcher?: string;
  hooks?: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    PreToolUse?: MatcherEntry[];
    [event: string]: unknown;
  };
  [key: string]: unknown;
}

export interface InitResult {
  status: "added" | "already-present" | "error";
  message: string;
}

/**
 * Idempotently register cc-shisa as a PreToolUse hook in
 * ~/.claude/settings.json (or whatever path is supplied). If the file
 * already references cc-shisa anywhere under PreToolUse, no-op. Otherwise,
 * back up the file and append the hook to the Bash matcher entry,
 * creating the entry if needed.
 */
export function runInit(settingsPath: string): InitResult {
  let settings: ClaudeSettings = {};
  let existed = false;

  if (existsSync(settingsPath)) {
    existed = true;
    try {
      const content = readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(content) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {
          status: "error",
          message: `${settingsPath} is not a JSON object`,
        };
      }
      settings = parsed as ClaudeSettings;
    } catch (err) {
      return {
        status: "error",
        message: `failed to parse ${settingsPath}: ${(err as Error).message}`,
      };
    }
  }

  if (alreadyRegistered(settings)) {
    return {
      status: "already-present",
      message: `cc-shisa hook already registered in ${settingsPath}`,
    };
  }

  if (existed) {
    copyFileSync(settingsPath, `${settingsPath}.bak`);
  } else {
    mkdirSync(dirname(settingsPath), { recursive: true });
  }

  const updated = withHookAdded(settings);
  writeFileSync(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");

  return {
    status: "added",
    message: existed
      ? `registered cc-shisa hook in ${settingsPath} (backup at ${settingsPath}.bak)`
      : `created ${settingsPath} with cc-shisa hook`,
  };
}

function alreadyRegistered(settings: ClaudeSettings): boolean {
  const pre = settings.hooks?.PreToolUse;
  if (!pre) return false;
  return pre.some((entry) =>
    entry.hooks?.some((h) => typeof h.command === "string" && h.command.includes("cc-shisa")),
  );
}

function withHookAdded(settings: ClaudeSettings): ClaudeSettings {
  const pre = settings.hooks?.PreToolUse ?? [];
  const newHook: HookEntry = {
    type: "command",
    command: HOOK_COMMAND,
    timeout: HOOK_TIMEOUT,
  };

  const bashIndex = pre.findIndex((e) => e.matcher === MATCHER);
  const updatedPre =
    bashIndex >= 0
      ? pre.map((entry, i) =>
          i === bashIndex
            ? { ...entry, hooks: [...(entry.hooks ?? []), newHook] }
            : entry,
        )
      : [...pre, { matcher: MATCHER, hooks: [newHook] }];

  return {
    ...settings,
    hooks: {
      ...settings.hooks,
      PreToolUse: updatedPre,
    },
  };
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"];
  if (home === undefined || home === "") {
    throw new Error("init: HOME is not set; cannot resolve ~/.claude/settings.json");
  }
  return `${home}/.claude/settings.json`;
}
