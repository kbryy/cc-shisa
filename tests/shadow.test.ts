import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Decision } from "../src/policy/types.ts";
import {
  apply,
  isLogEnabled,
  isShadowEnabled,
} from "../src/shadow/index.ts";

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

describe("shadow.isShadowEnabled", () => {
  test("true only when CC_SHISA_SHADOW=1", () => {
    expect(isShadowEnabled({ CC_SHISA_SHADOW: "1" })).toBe(true);
    expect(isShadowEnabled({})).toBe(false);
    expect(isShadowEnabled({ CC_SHISA_SHADOW: "0" })).toBe(false);
    expect(isShadowEnabled({ CC_SHISA_SHADOW: "true" })).toBe(false);
  });
});

describe("shadow.isLogEnabled", () => {
  test("true when CC_SHISA_LOG=1", () => {
    expect(isLogEnabled({ CC_SHISA_LOG: "1" })).toBe(true);
  });
  test("true when CC_SHISA_SHADOW=1 (shadow always logs)", () => {
    expect(isLogEnabled({ CC_SHISA_SHADOW: "1" })).toBe(true);
  });
  test("false otherwise", () => {
    expect(isLogEnabled({})).toBe(false);
    expect(isLogEnabled({ CC_SHISA_LOG: "0" })).toBe(false);
  });
});

describe("shadow.apply — both flags off", () => {
  test("returns decision unchanged and writes nothing", () => {
    const dir = tmp();
    try {
      const d = dangerousDecision();
      const out = apply(d, "rm -rf /", { logDir: dir, env: {} });
      expect(out).toEqual(d);
      expect(existsSync(`${dir}/decisions.jsonl`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shadow.apply — CC_SHISA_LOG=1 only", () => {
  test("preserves the original decision but writes a log entry", () => {
    const dir = tmp();
    try {
      const d = dangerousDecision();
      const out = apply(d, "rm -rf /", {
        logDir: dir,
        env: { CC_SHISA_LOG: "1" },
      });
      expect(out).toEqual(d);
      const entry = JSON.parse(
        readFileSync(`${dir}/decisions.jsonl`, "utf-8").trim(),
      ) as Record<string, unknown>;
      expect(entry["originalAction"]).toBe("deny");
      expect(entry["command"]).toBe("rm -rf /");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shadow.apply — CC_SHISA_SHADOW=1", () => {
  test("forces allow and notes the would-have-been action", () => {
    const dir = tmp();
    try {
      const d = dangerousDecision();
      const out = apply(d, "rm -rf /", {
        logDir: dir,
        env: { CC_SHISA_SHADOW: "1" },
      });
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
      const entry = JSON.parse(
        readFileSync(`${dir}/decisions.jsonl`, "utf-8").trim(),
      ) as Record<string, unknown>;
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

describe("shadow.apply — both flags on (shadow wins)", () => {
  test("CC_SHISA_SHADOW=1 + CC_SHISA_LOG=1 still overrides to allow with one log line", () => {
    const dir = tmp();
    try {
      const out = apply(dangerousDecision(), "rm -rf /", {
        logDir: dir,
        env: { CC_SHISA_SHADOW: "1", CC_SHISA_LOG: "1" },
      });
      expect(out.action).toBe("allow");
      const lines = readFileSync(`${dir}/decisions.jsonl`, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

