import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pickWith } from "../src/modules/index.ts";
import { runPick } from "../src/modules/pick.ts";

const sampleModules = [
  { name: "coreutils", description: "ls/cat/grep/..." },
  { name: "git", description: "git read subcommands" },
  { name: "gh", description: "gh pr list/view/..." },
  { name: "pnpm", description: "pnpm test/typecheck/..." },
] as const;

function scriptedReader(lines: readonly string[]): () => string | null {
  let i = 0;
  return () => (i < lines.length ? lines[i++] ?? null : null);
}

function captureWriter(): { writer: (line: string) => void; output: string[] } {
  const output: string[] = [];
  return {
    writer: (line: string) => {
      output.push(line);
    },
    output,
  };
}

describe("runPick", () => {
  test("toggle then done saves selection", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(),
      readLine: scriptedReader(["coreutils", "git", "done"]),
      write: writer,
    });
    expect(result.saved).toBe(true);
    expect([...result.finalEnabled].sort()).toEqual(["coreutils", "git"]);
  });

  test("toggle off when already enabled", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(["coreutils", "git"]),
      readLine: scriptedReader(["git", "done"]),
      write: writer,
    });
    expect([...result.finalEnabled]).toEqual(["coreutils"]);
  });

  test("'all' enables everything", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(),
      readLine: scriptedReader(["all", "done"]),
      write: writer,
    });
    expect(result.finalEnabled.size).toBe(sampleModules.length);
  });

  test("'none' clears", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(["coreutils", "git"]),
      readLine: scriptedReader(["none", "done"]),
      write: writer,
    });
    expect(result.finalEnabled.size).toBe(0);
  });

  test("'cancel' marks not-saved", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(["coreutils"]),
      readLine: scriptedReader(["git", "cancel"]),
      write: writer,
    });
    expect(result.saved).toBe(false);
    expect([...result.finalEnabled].sort()).toEqual(["coreutils", "git"]);
  });

  test("EOF behaves like cancel", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(["pnpm"]),
      readLine: scriptedReader([]),
      write: writer,
    });
    expect(result.saved).toBe(false);
  });

  test("unknown name is rejected, prompt continues", () => {
    const { writer, output } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(),
      readLine: scriptedReader(["typo-name", "git", "done"]),
      write: writer,
    });
    expect(result.saved).toBe(true);
    expect([...result.finalEnabled]).toEqual(["git"]);
    expect(output.some((l) => l.includes("unknown module: typo-name"))).toBe(true);
  });

  test("empty input is ignored", () => {
    const { writer } = captureWriter();
    const result = runPick({
      modules: sampleModules,
      initiallyEnabled: new Set(),
      readLine: scriptedReader(["", " ", "done"]),
      write: writer,
    });
    expect(result.saved).toBe(true);
    expect(result.finalEnabled.size).toBe(0);
  });
});

describe("pickWith — full IO + profile persistence", () => {
  test("saves added/removed and writes profile.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-shisa-pick-"));
    try {
      const env = { XDG_CONFIG_HOME: dir, HOME: dir };
      const outcome = pickWith(
        {
          readLine: scriptedReader(["coreutils", "git", "done"]),
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

  test("cancel does not write profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-shisa-pick-"));
    try {
      const env = { XDG_CONFIG_HOME: dir, HOME: dir };
      const outcome = pickWith(
        {
          readLine: scriptedReader(["all", "cancel"]),
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
