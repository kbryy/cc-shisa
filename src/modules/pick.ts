export type Key = "up" | "down" | "toggle" | "all" | "none" | "save" | "cancel";

export interface PickModule {
  name: string;
  description: string;
}

export interface PickState {
  cursor: number;
  enabled: Set<string>;
  status: "active" | "saved" | "cancelled";
}

export interface PickResult {
  finalEnabled: Set<string>;
  saved: boolean;
}

export function initialState(
  modules: readonly PickModule[],
  initiallyEnabled: ReadonlySet<string>,
): PickState {
  return {
    cursor: 0,
    enabled: new Set(initiallyEnabled),
    status: "active",
  };
}

/**
 * Pure state transition. Tests drive this directly; the interactive loop
 * just feeds it keys parsed from stdin and renders the result.
 */
export function reduce(
  state: PickState,
  key: Key,
  modules: readonly PickModule[],
): PickState {
  if (state.status !== "active") return state;
  if (modules.length === 0) {
    if (key === "save") return { ...state, status: "saved" };
    if (key === "cancel") return { ...state, status: "cancelled" };
    return state;
  }
  switch (key) {
    case "up":
      return { ...state, cursor: (state.cursor - 1 + modules.length) % modules.length };
    case "down":
      return { ...state, cursor: (state.cursor + 1) % modules.length };
    case "toggle": {
      const name = modules[state.cursor]?.name;
      if (name === undefined) return state;
      const enabled = new Set(state.enabled);
      if (enabled.has(name)) enabled.delete(name);
      else enabled.add(name);
      return { ...state, enabled };
    }
    case "all":
      return { ...state, enabled: new Set(modules.map((m) => m.name)) };
    case "none":
      return { ...state, enabled: new Set() };
    case "save":
      return { ...state, status: "saved" };
    case "cancel":
      return { ...state, status: "cancelled" };
  }
}

/**
 * Map raw stdin bytes to picker keys. Returns the parsed key plus how many
 * bytes were consumed, or null if the buffer doesn't yet contain a complete
 * sequence (caller should append more bytes and retry).
 *
 * Recognises arrow keys (CSI A/B), a few control bytes, and ASCII letters
 * j/k/a/n/q/space/enter.
 */
export function parseKey(buf: Uint8Array): { key: Key | null; consumed: number } | null {
  if (buf.length === 0) return null;
  const b0 = buf[0]!;

  if (b0 === 0x1b) {
    if (buf.length === 1) return null;
    if (buf[1] === 0x5b) {
      if (buf.length < 3) return null;
      switch (buf[2]) {
        case 0x41: return { key: "up", consumed: 3 };
        case 0x42: return { key: "down", consumed: 3 };
        default: return { key: null, consumed: 3 };
      }
    }
    return { key: "cancel", consumed: 1 };
  }

  if (b0 === 0x03) return { key: "cancel", consumed: 1 };
  if (b0 === 0x0d || b0 === 0x0a) return { key: "save", consumed: 1 };
  if (b0 === 0x20) return { key: "toggle", consumed: 1 };
  if (b0 === 0x71) return { key: "cancel", consumed: 1 };
  if (b0 === 0x6a) return { key: "down", consumed: 1 };
  if (b0 === 0x6b) return { key: "up", consumed: 1 };
  if (b0 === 0x61) return { key: "all", consumed: 1 };
  if (b0 === 0x6e) return { key: "none", consumed: 1 };

  return { key: null, consumed: 1 };
}

export interface RenderOptions {
  modules: readonly PickModule[];
  state: PickState;
}

export function renderFrame(opts: RenderOptions): string {
  const { modules, state } = opts;
  const lines: string[] = [];
  lines.push(
    "Pick optional modules — space toggle, ↑/↓ or j/k move, a all, n none, Enter save, q cancel.",
  );
  lines.push("");
  const nameWidth = modules.length === 0
    ? 0
    : Math.max(...modules.map((m) => m.name.length));
  for (let i = 0; i < modules.length; i += 1) {
    const m = modules[i]!;
    const cursor = i === state.cursor ? ">" : " ";
    const mark = state.enabled.has(m.name) ? "x" : " ";
    lines.push(`${cursor} [${mark}] ${m.name.padEnd(nameWidth)}  ${m.description}`);
  }
  return lines.join("\n");
}

export interface PickIO {
  keys: AsyncIterable<Key>;
  write: (s: string) => void;
}

/**
 * Drive the picker: render initial state, then for each incoming key feed
 * reduce() and re-render. Exits when state.status leaves "active". The
 * caller decides how to source keys (tests use a scripted async iterable;
 * the CLI parses raw stdin) and how to write (tests capture; CLI writes
 * to stdout with cursor controls).
 */
export async function pickLoop(
  modules: readonly PickModule[],
  initiallyEnabled: ReadonlySet<string>,
  io: PickIO,
): Promise<PickResult> {
  let state = initialState(modules, initiallyEnabled);
  io.write(renderFrame({ modules, state }));
  for await (const key of io.keys) {
    state = reduce(state, key, modules);
    io.write(renderFrame({ modules, state }));
    if (state.status !== "active") break;
  }
  return {
    finalEnabled: state.enabled,
    saved: state.status === "saved",
  };
}
