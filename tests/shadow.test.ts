import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Decision } from "../src/policy/types.ts";
import { apply, defaultLogDir, isEnabled } from "../src/shadow/index.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cc-shisa-shadow-"));
}

function dangerousDecision(): Decision {
  return {
    action: "deny",
    class: "dangerous",
    reason: "rm -rf root",
    matchedRule: "core.rm.rf.root",
    segment: "rm -rf /",
  };
}

describe("shadow.isEnabled", () => {
  test("true when CC_SHISA_SHADOW=1", () => {
    expect(isEnabled({ CC_SHISA_SHADOW: "1" })).toBe(true);
  });
  test("false otherwise", () => {
    expect(isEnabled({})).toBe(false);
    expect(isEnabled({ CC_SHISA_SHADOW: "0" })).toBe(false);
    expect(isEnabled({ CC_SHISA_SHADOW: "true" })).toBe(false);
  });
});

describe("shadow.apply — disabled", () => {
  test("returns decision unchanged", () => {
    const dir = tmp();
    try {
      const d = dangerousDecision();
      const out = apply(d, "rm -rf /", { logDir: dir, env: {} });
      expect(out).toEqual(d);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shadow.apply — enabled", () => {
  test("forces allow and notes the would-have-been action", () => {
    const dir = tmp();
    try {
      const d = dangerousDecision();
      const out = apply(d, "rm -rf /", { logDir: dir, env: { CC_SHISA_SHADOW: "1" } });
      expect(out.action).toBe("allow");
      expect(out.class).toBe("dangerous");
      expect(out.reason).toContain("shadow: would have been deny");
      expect(out.matchedRule).toBe("core.rm.rf.root");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appends a JSONL log entry with the original decision", () => {
    const dir = tmp();
    try {
      apply(dangerousDecision(), "rm -rf /", {
        logDir: dir,
        env: { CC_SHISA_SHADOW: "1" },
      });
      const content = readFileSync(`${dir}/decisions.jsonl`, "utf-8");
      const entry = JSON.parse(content.trim()) as Record<string, unknown>;
      expect(entry["command"]).toBe("rm -rf /");
      expect(entry["originalAction"]).toBe("deny");
      expect(entry["class"]).toBe("dangerous");
      expect(entry["matchedRule"]).toBe("core.rm.rf.root");
      expect(typeof entry["ts"]).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two calls produce two JSONL lines", () => {
    const dir = tmp();
    try {
      apply(dangerousDecision(), "rm -rf /", {
        logDir: dir,
        env: { CC_SHISA_SHADOW: "1" },
      });
      apply(dangerousDecision(), "rm -rf /etc", {
        logDir: dir,
        env: { CC_SHISA_SHADOW: "1" },
      });
      const content = readFileSync(`${dir}/decisions.jsonl`, "utf-8");
      expect(content.trim().split("\n")).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shadow.defaultLogDir", () => {
  test("respects XDG_STATE_HOME", () => {
    expect(defaultLogDir({ XDG_STATE_HOME: "/x", HOME: "/h" })).toBe("/x/cc-shisa");
  });
  test("falls back to ~/.local/state", () => {
    expect(defaultLogDir({ HOME: "/h" })).toBe("/h/.local/state/cc-shisa");
  });
});
