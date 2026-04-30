import {
  listAllModules,
  MANDATORY_MODULE,
  resolveProfile,
  type ModuleEntry,
} from "../rules/index.ts";
import {
  readUserProfile,
  userProfilePath,
  writeUserProfile,
  type RawProfile,
} from "../rules/user-config.ts";
import {
  parseKey,
  pickLoop,
  renderFrame,
  type Key,
  type PickIO,
  type PickModule,
  type PickResult,
} from "./pick.ts";

export type ChangeStatus = "added" | "removed" | "already-on" | "already-off" | "noop-mandatory" | "unknown";

export interface ChangeResult {
  name: string;
  status: ChangeStatus;
}

export function renderList(entries: readonly ModuleEntry[]): string {
  const header = ["NAME", "STATUS", "SOURCE", "RULES", "DESCRIPTION"] as const;
  const rows = entries.map((e) => [
    e.name,
    e.name === MANDATORY_MODULE ? "on (locked)" : e.status,
    e.source,
    String(e.module.rules.length),
    e.module.description ?? "",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [fmt(header), ...rows.map(fmt)].join("\n");
}

export function listModules(env: NodeJS.ProcessEnv = process.env): string {
  return renderList(listAllModules(env));
}

export function enableModules(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ChangeResult[] {
  const known = knownNames(env);
  const profile = readOrInitProfile(env);
  const enabled = new Set(profile.modules ?? []);
  const results: ChangeResult[] = [];

  for (const name of names) {
    if (name === MANDATORY_MODULE) {
      results.push({ name, status: "noop-mandatory" });
      continue;
    }
    if (!known.has(name)) {
      results.push({ name, status: "unknown" });
      continue;
    }
    if (enabled.has(name)) {
      results.push({ name, status: "already-on" });
      continue;
    }
    enabled.add(name);
    results.push({ name, status: "added" });
  }

  if (results.some((r) => r.status === "added")) {
    writeUserProfile({ ...profile, modules: [...enabled] }, env);
  }
  return results;
}

export function disableModules(
  names: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): ChangeResult[] {
  const profile = readOrInitProfile(env);
  const enabled = new Set(profile.modules ?? []);
  const results: ChangeResult[] = [];

  for (const name of names) {
    if (name === MANDATORY_MODULE) {
      results.push({ name, status: "noop-mandatory" });
      continue;
    }
    if (!enabled.has(name)) {
      results.push({ name, status: "already-off" });
      continue;
    }
    enabled.delete(name);
    results.push({ name, status: "removed" });
  }

  if (results.some((r) => r.status === "removed")) {
    writeUserProfile({ ...profile, modules: [...enabled] }, env);
  }
  return results;
}

function knownNames(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(listAllModules(env).map((m) => m.name));
}

function readOrInitProfile(env: NodeJS.ProcessEnv): RawProfile {
  const existing = readUserProfile(env);
  if (existing) {
    return {
      level: existing.level ?? "safe",
      modules: existing.modules ?? [],
    };
  }
  const resolved = resolveProfile(env);
  return { level: resolved.level, modules: [...resolved.modules].filter((m) => m !== MANDATORY_MODULE) };
}

export function profilePathHint(env: NodeJS.ProcessEnv = process.env): string {
  return userProfilePath(env);
}

export interface PickOutcome {
  saved: boolean;
  added: readonly string[];
  removed: readonly string[];
}

export async function pickWith(
  io: PickIO,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PickOutcome> {
  const all = listAllModules(env);
  const optional: PickModule[] = all
    .filter((m) => m.source === "built-in" && m.name !== MANDATORY_MODULE)
    .map((m) => ({ name: m.name, description: m.module.description ?? "" }));
  const initiallyEnabled = new Set(
    all
      .filter((m) => m.status === "on" && m.name !== MANDATORY_MODULE)
      .map((m) => m.name),
  );

  const result: PickResult = await pickLoop(optional, initiallyEnabled, io);

  if (!result.saved) {
    return { saved: false, added: [], removed: [] };
  }

  const added = [...result.finalEnabled].filter((n) => !initiallyEnabled.has(n));
  const removed = [...initiallyEnabled].filter((n) => !result.finalEnabled.has(n));

  if (added.length > 0 || removed.length > 0) {
    const profile = readUserProfile(env) ?? { level: "safe", modules: [] };
    profile.modules = [...result.finalEnabled];
    profile.level = profile.level ?? "safe";
    writeUserProfile(profile, env);
  }

  return { saved: true, added, removed };
}

/**
 * Stream stdin in raw mode and decode each chunk into picker keys.
 * The `restore` callback returns the terminal to its prior state and
 * MUST be called before the process exits.
 */
export function streamStdinKeys(): {
  keys: AsyncIterable<Key>;
  restore: () => void;
} {
  if (process.stdin.isTTY !== true) {
    throw new Error(
      "modules pick requires an interactive terminal; use 'modules enable/disable' instead",
    );
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const restore = (): void => {
    if (process.stdin.isTTY === true) process.stdin.setRawMode(false);
    process.stdin.pause();
  };

  async function* iter(): AsyncIterable<Key> {
    let buf = new Uint8Array(0);
    for await (const chunk of process.stdin) {
      const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
      const merged = new Uint8Array(buf.length + incoming.length);
      merged.set(buf);
      merged.set(incoming, buf.length);
      buf = merged;
      while (true) {
        const parsed = parseKey(buf);
        if (parsed === null) break;
        buf = buf.slice(parsed.consumed);
        if (parsed.key !== null) yield parsed.key;
      }
    }
  }

  return { keys: iter(), restore };
}

/**
 * Print a frame, tracking the previous frame's line count so the next
 * call clears the in-place region (no flicker, no scrollback noise).
 * Returns a writer suitable for PickIO.write.
 */
export function makeStdoutWriter(): (frame: string) => void {
  let prevLines = 0;
  process.stdout.write("[?25l");
  return (frame: string) => {
    if (prevLines > 0) {
      process.stdout.write(`[${prevLines}A[J`);
    }
    process.stdout.write(frame);
    process.stdout.write("\n");
    prevLines = frame.split("\n").length;
  };
}

export function showCursor(): void {
  process.stdout.write("[?25h");
}

export { renderFrame } from "./pick.ts";
