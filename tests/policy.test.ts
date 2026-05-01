import { describe, expect, test } from "bun:test";

import type { Classification } from "../src/classifier/index.ts";
import { decide } from "../src/policy/index.ts";
import { safeLevel } from "../src/rules/index.ts";
import type { Action, Class, Profile } from "../src/rules/types.ts";

const baseProfile: Profile = { level: "safe", modules: ["_core"] };
const level = safeLevel();

const baseClassification = (cls: Class, ruleId?: string): Classification => ({
  class: cls,
  reason: "test",
  ...(ruleId !== undefined ? { ruleId } : {}),
});

const expectations: ReadonlyArray<readonly [Class, Action]> = [
  ["dangerous", "deny"],
  ["irreversible-remote", "ask"],
  ["irreversible-local", "ask"],
  ["eval", "ask"],
  ["write-remote", "ask"],
  ["write-local", "allow"],
  ["unknown", "ask"],
  ["read-remote", "allow"],
  ["read-local", "allow"],
];

describe("policy — safe level mapping", () => {
  for (const [cls, action] of expectations) {
    test(`${cls} → ${action}`, () => {
      const d = decide(baseClassification(cls), baseProfile, level);
      expect(d.action).toBe(action);
      expect(d.class).toBe(cls);
    });
  }
});

describe("policy — overrides", () => {
  test("profile override beats level mapping", () => {
    const profile: Profile = {
      ...baseProfile,
      overrides: { dangerous: "ask" },
    };
    const d = decide(baseClassification("dangerous"), profile, level);
    expect(d.action).toBe("ask");
  });

  test("override only affects the listed class", () => {
    const profile: Profile = {
      ...baseProfile,
      overrides: { dangerous: "ask" },
    };
    const d = decide(baseClassification("read-local"), profile, level);
    expect(d.action).toBe("allow");
  });
});

describe("policy — Decision shape", () => {
  test("preserves ruleId and matchedSegment when provided", () => {
    const cls: Classification = {
      class: "dangerous",
      reason: "rm -rf root",
      ruleId: "core.rm.rf.root",
      matchedSegment: "rm -rf /",
    };
    const d = decide(cls, baseProfile, level);
    expect(d.matchedRule).toBe("core.rm.rf.root");
    expect(d.segment).toBe("rm -rf /");
    expect(d.reason).toBe("rm -rf root");
  });

  test("omits matchedRule and segment when classification has none", () => {
    const d = decide(baseClassification("unknown"), baseProfile, level);
    expect(d.matchedRule).toBeUndefined();
    expect(d.segment).toBeUndefined();
  });
});
