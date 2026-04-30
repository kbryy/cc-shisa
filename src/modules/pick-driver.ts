import { listAllModules, MANDATORY_MODULE } from "../rules/index.ts";
import { readUserProfile, writeUserProfile } from "../rules/user-config.ts";
import { pickLoop, parseKey, type Key, type PickIO, type PickModule, type PickResult } from "./pick.ts";

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
    const existing = readUserProfile(env);
    writeUserProfile(
      { level: existing?.level ?? "safe", modules: [...result.finalEnabled] },
      env,
    );
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
  process.stdout.write("[?25l");
  return (frame: string) => {
    if (prevLines > 0) {
      process.stdout.write(`[${prevLines}A[J`);
    }
    process.stdout.write(frame);
    process.stdout.write("\n");
    prevLines = frame.split("\n").length;
  };
}

export function showCursor(): void {
  process.stdout.write("[?25h");
}

/**
 * One-call wrapper for the CLI: enter raw stdin mode, render to stdout,
 * pick modules, then always restore the terminal. Hides every TTY detail
 * from cli/modules.ts so it can stay pure routing.
 */
export async function runPickInteractive(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PickOutcome> {
  const stream = streamStdinKeys();
  const writer = makeStdoutWriter();
  try {
    return await pickWith({ keys: stream.keys, write: writer }, env);
  } finally {
    stream.restore();
    showCursor();
  }
}
