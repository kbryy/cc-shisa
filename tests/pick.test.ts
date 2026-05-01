import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeStdoutWriter, pickWith, showCursor } from "../src/modules/index.ts";
import {
  initialState,
  parseKey,
  pickLoop,
  reduce,
  renderFrame,
  type Key,
  type PickModule,
} from "../src/modules/pick.ts";

const sampleModules: PickModule[] = [
  { name: "coreutils", description: "ls/cat/grep/..." },
  { name: "git", description: "git read subcommands" },
  { name: "gh", description: "gh pr list/view/..." },
  { name: "pnpm", description: "pnpm test/typecheck/..." },
];

describe("reduce — cursor movement", () => {
  test("down moves forward, wrapping at end", () => {
    let s = initialState(sampleModules, new Set());
    s = reduce(s, "down", sampleModules);
    expect(s.cursor).toBe(1);
    s = reduce(s, "down", sampleModules);
    s = reduce(s, "down", sampleModules);
    s = reduce(s, "down", sampleModules);
    expect(s.cursor).toBe(0);
  });

  test("up moves backward, wrapping at top", () => {
    let s = initialState(sampleModules, new Set());
    s = reduce(s, "up", sampleModules);
    expect(s.cursor).toBe(sampleModules.length - 1);
  });
});

describe("reduce — toggle", () => {
  test("space adds the row under cursor", () => {
    let s = initialState(sampleModules, new Set());
    s = reduce(s, "down", sampleModules);
    s = reduce(s, "toggle", sampleModules);
    expect([...s.enabled]).toEqual(["git"]);
  });

  test("space removes already-enabled row", () => {
    let s = initialState(sampleModules, new Set(["coreutils"]));
    s = reduce(s, "toggle", sampleModules);
    expect([...s.enabled]).toEqual([]);
  });
});

describe("reduce — bulk", () => {
  test("'all' enables every row", () => {
    let s = initialState(sampleModules, new Set());
    s = reduce(s, "all", sampleModules);
    expect(s.enabled.size).toBe(sampleModules.length);
  });

  test("'none' clears", () => {
    let s = initialState(sampleModules, new Set(["git", "gh"]));
    s = reduce(s, "none", sampleModules);
    expect(s.enabled.size).toBe(0);
  });
});

describe("reduce — terminal states", () => {
  test("save flips status to saved", () => {
    let s = initialState(sampleModules, new Set());
    s = reduce(s, "save", sampleModules);
    expect(s.status).toBe("saved");
  });

  test("cancel flips status to cancelled", () => {
    let s = initialState(sampleModules, new Set(["git"]));
    s = reduce(s, "cancel", sampleModules);
    expect(s.status).toBe("cancelled");
    expect([...s.enabled]).toEqual(["git"]);
  });

  test("further keys after save are no-ops", () => {
    let s = initialState(sampleModules, new Set());
    s = reduce(s, "save", sampleModules);
    s = reduce(s, "toggle", sampleModules);
    expect(s.enabled.size).toBe(0);
  });
});

describe("parseKey", () => {
  test("ASCII single-byte mappings", () => {
    expect(parseKey(new Uint8Array([0x20]))).toEqual({ key: "toggle", consumed: 1 });
    expect(parseKey(new Uint8Array([0x0d]))).toEqual({ key: "save", consumed: 1 });
    expect(parseKey(new Uint8Array([0x6a]))).toEqual({ key: "down", consumed: 1 });
    expect(parseKey(new Uint8Array([0x6b]))).toEqual({ key: "up", consumed: 1 });
    expect(parseKey(new Uint8Array([0x71]))).toEqual({ key: "cancel", consumed: 1 });
    expect(parseKey(new Uint8Array([0x03]))).toEqual({ key: "cancel", consumed: 1 });
    expect(parseKey(new Uint8Array([0x61]))).toEqual({ key: "all", consumed: 1 });
    expect(parseKey(new Uint8Array([0x6e]))).toEqual({ key: "none", consumed: 1 });
  });

  test("CSI arrow sequences", () => {
    expect(parseKey(new Uint8Array([0x1b, 0x5b, 0x41]))).toEqual({ key: "up", consumed: 3 });
    expect(parseKey(new Uint8Array([0x1b, 0x5b, 0x42]))).toEqual({ key: "down", consumed: 3 });
  });

  test("partial ESC sequence returns null (wait for more)", () => {
    expect(parseKey(new Uint8Array([0x1b]))).toBeNull();
    expect(parseKey(new Uint8Array([0x1b, 0x5b]))).toBeNull();
  });

  test("ESC alone after non-CSI byte → cancel", () => {
    expect(parseKey(new Uint8Array([0x1b, 0x71]))).toEqual({ key: "cancel", consumed: 1 });
  });

  test("empty buffer returns null", () => {
    expect(parseKey(new Uint8Array())).toBeNull();
  });
});

async function* keysFrom(seq: readonly Key[]): AsyncIterable<Key> {
  for (const k of seq) yield k;
}

describe("pickLoop — async driver", () => {
  test("save returns saved=true with current selection", async () => {
    const frames: string[] = [];
    const result = await pickLoop(sampleModules, new Set(), {
      keys: keysFrom(["down", "toggle", "save"]),
      write: (s) => {
        frames.push(s);
      },
    });
    expect(result.saved).toBe(true);
    expect([...result.finalEnabled]).toEqual(["git"]);
    expect(frames.length).toBeGreaterThan(0);
  });

  test("cancel returns saved=false", async () => {
    const result = await pickLoop(sampleModules, new Set(["coreutils"]), {
      keys: keysFrom(["toggle", "cancel"]),
      write: () => {},
    });
    expect(result.saved).toBe(false);
  });
});

describe("renderFrame", () => {
  test("marks the cursor row with > and toggled rows with [x]", () => {
    const s = initialState(sampleModules, new Set(["git"]));
    const frame = renderFrame({ modules: sampleModules, state: s });
    const lines = frame.split("\n");
    expect(lines[0]).toContain("Pick optional modules");
    expect(lines.find((l) => l.startsWith("> "))).toContain("coreutils");
    expect(lines.find((l) => l.includes("[x] git"))).toBeDefined();
    expect(lines.find((l) => l.includes("[ ] gh"))).toBeDefined();
  });
});

describe("pickWith — full IO + profile persistence", () => {
  test("saves added/removed and writes profile.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-shisa-pick-"));
    try {
      const env = { XDG_CONFIG_HOME: dir, HOME: dir };
      const outcome = await pickWith(
        {
          keys: keysFrom(["toggle", "down", "toggle", "save"]),
          write: () => {},
        },
        env,
      );
      expect(outcome.saved).toBe(true);
      expect([...outcome.added].sort()).toEqual(["coreutils", "git"]);
      expect(outcome.removed).toEqual([]);

      const written = JSON.parse(
        readFileSync(`${dir}/cc-shisa/profile.json`, "utf-8"),
      ) as { modules: string[] };
      expect(written.modules.sort()).toEqual(["coreutils", "git"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cancel does not write profile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-shisa-pick-"));
    try {
      const env = { XDG_CONFIG_HOME: dir, HOME: dir };
      const outcome = await pickWith(
        {
          keys: keysFrom(["all", "cancel"]),
          write: () => {},
        },
        env,
      );
      expect(outcome.saved).toBe(false);
      expect(outcome.added).toEqual([]);
      expect(outcome.removed).toEqual([]);
      expect(() => readFileSync(`${dir}/cc-shisa/profile.json`)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("makeStdoutWriter — cursor control sequences", () => {
  test("emits hide-cursor escape on construction", () => {
    const out: string[] = [];
    makeStdoutWriter((s) => out.push(s));
    expect(out).toEqual(["\x1b[?25l"]);
  });

  test("first frame writes content + newline, no clear", () => {
    const out: string[] = [];
    const write = makeStdoutWriter((s) => out.push(s));
    out.length = 0;
    write("line1\nline2");
    expect(out).toEqual(["line1\nline2", "\n"]);
  });

  test("second frame moves cursor up by previous line count and clears below", () => {
    const out: string[] = [];
    const write = makeStdoutWriter((s) => out.push(s));
    write("line1\nline2"); // prevLines becomes 2 after this call
    out.length = 0;
    write("new1\nnew2\nnew3");
    expect(out[0]).toBe("\x1b[2A\x1b[J");
    expect(out[1]).toBe("new1\nnew2\nnew3");
    expect(out[2]).toBe("\n");
  });

  test("third frame uses the second frame's line count", () => {
    const out: string[] = [];
    const write = makeStdoutWriter((s) => out.push(s));
    write("a"); // prevLines = 1
    write("b\nc\nd\ne"); // prevLines = 4
    out.length = 0;
    write("x");
    expect(out[0]).toBe("\x1b[4A\x1b[J");
  });

  test("escape sequences are real ESC bytes (0x1b), not literal '['", () => {
    const out: string[] = [];
    makeStdoutWriter((s) => out.push(s));
    expect(out[0]?.charCodeAt(0)).toBe(0x1b);
    expect(out[0]).not.toMatch(/^\[/);
  });
});

describe("showCursor — emits show-cursor escape", () => {
  test("writes \\x1b[?25h", () => {
    const out: string[] = [];
    showCursor((s) => out.push(s));
    expect(out).toEqual(["\x1b[?25h"]);
    expect(out[0]?.charCodeAt(0)).toBe(0x1b);
  });
});
