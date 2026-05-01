import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultSettingsPath, isHookRegistered, runInit } from "../src/init/index.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cc-shisa-init-"));
}

const HOOK = { type: "command", command: "cc-shisa hook", timeout: 10 };

describe("init.runInit — fresh settings file", () => {
  test("creates the settings file when it does not exist", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      const result = runInit(path);
      expect(result.status).toBe("added");
      const settings = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      expect(settings).toEqual({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [HOOK] }] },
      });
      expect(existsSync(`${path}.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("init.runInit — extending existing file", () => {
  test("appends to existing Bash matcher and writes a .bak", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      writeFileSync(
        path,
        JSON.stringify({
          model: "sonnet",
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "/some/other/tool" }],
              },
            ],
          },
        }),
      );
      const result = runInit(path);
      expect(result.status).toBe("added");
      const settings = JSON.parse(readFileSync(path, "utf-8")) as {
        hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
        model: string;
      };
      expect(settings.model).toBe("sonnet");
      const bash = settings.hooks.PreToolUse[0]!;
      expect(bash.hooks).toHaveLength(2);
      expect(bash.hooks[1]).toEqual(HOOK);
      expect(existsSync(`${path}.bak`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("creates a Bash matcher when none exists", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      writeFileSync(
        path,
        JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "x" }] }],
          },
        }),
      );
      const result = runInit(path);
      expect(result.status).toBe("added");
      const settings = JSON.parse(readFileSync(path, "utf-8")) as {
        hooks: { PreToolUse: { matcher: string }[] };
      };
      expect(settings.hooks.PreToolUse).toHaveLength(2);
      expect(settings.hooks.PreToolUse[1]?.matcher).toBe("Bash");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("init.runInit — idempotency", () => {
  test("second invocation is a no-op", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      runInit(path);
      const before = readFileSync(path, "utf-8");
      const result = runInit(path);
      expect(result.status).toBe("already-present");
      const after = readFileSync(path, "utf-8");
      expect(after).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("detects a hook that mentions cc-shisa under any matcher", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      writeFileSync(
        path,
        JSON.stringify({
          hooks: {
            PreToolUse: [
              {
                matcher: "Read",
                hooks: [{ type: "command", command: "cc-shisa hook --readonly" }],
              },
            ],
          },
        }),
      );
      const result = runInit(path);
      expect(result.status).toBe("already-present");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("init.runInit — error paths", () => {
  test("returns error on unparseable JSON without writing a backup", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      writeFileSync(path, "{ this is not json");
      const result = runInit(path);
      expect(result.status).toBe("error");
      expect(result.message).toContain("failed to parse");
      expect(existsSync(`${path}.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns error when file is JSON array (not an object)", () => {
    const dir = tmp();
    try {
      const path = `${dir}/settings.json`;
      writeFileSync(path, "[]");
      const result = runInit(path);
      expect(result.status).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("init.defaultSettingsPath", () => {
  test("expands $HOME", () => {
    expect(defaultSettingsPath({ HOME: "/tmp/h" })).toBe("/tmp/h/.claude/settings.json");
  });
  test("throws when HOME is unset", () => {
    expect(() => defaultSettingsPath({})).toThrow();
  });
});

describe("init.isHookRegistered", () => {
  test("false when settings file does not exist", () => {
    const dir = tmp();
    try {
      expect(isHookRegistered({ HOME: dir })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("false when HOME is unset", () => {
    expect(isHookRegistered({})).toBe(false);
  });

  test("false on unparseable settings", () => {
    const dir = tmp();
    try {
      mkdirSync(`${dir}/.claude`, { recursive: true });
      writeFileSync(`${dir}/.claude/settings.json`, "not json");
      expect(isHookRegistered({ HOME: dir })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("false when hooks block exists but cc-shisa is not in it", () => {
    const dir = tmp();
    try {
      mkdirSync(`${dir}/.claude`, { recursive: true });
      writeFileSync(
        `${dir}/.claude/settings.json`,
        JSON.stringify({
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other" }] }] },
        }),
      );
      expect(isHookRegistered({ HOME: dir })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("true after runInit registers the hook", () => {
    const dir = tmp();
    try {
      mkdirSync(`${dir}/.claude`, { recursive: true });
      runInit(`${dir}/.claude/settings.json`);
      expect(isHookRegistered({ HOME: dir })).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
