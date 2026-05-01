import { describe, expect, test } from "bun:test";

import { classify } from "../src/classifier/index.ts";
import { parse } from "../src/parser/index.ts";
import { decide } from "../src/policy/index.ts";
import {
  BUILTIN_MODULES,
  LEVEL_NAMES,
  levelByName,
  loadModule,
  looseLevel,
  safeLevel,
  strictLevel,
} from "../src/rules/index.ts";

const allModules = Object.keys(BUILTIN_MODULES).map(loadModule);
const allModuleNames = Object.keys(BUILTIN_MODULES);

function evaluateAt(level: ReturnType<typeof safeLevel>, command: string) {
  const cls = classify(parse(command), allModules);
  return decide(cls, { level: level.name, modules: allModuleNames }, level);
}

describe("level registry", () => {
  test("LEVEL_NAMES lists strict / safe / loose", () => {
    expect([...LEVEL_NAMES]).toEqual(["strict", "safe", "loose"]);
  });

  test("levelByName returns matching factory output", () => {
    expect(levelByName("strict").name).toBe("strict");
    expect(levelByName("safe").name).toBe("safe");
    expect(levelByName("loose").name).toBe("loose");
  });

  test("levelByName falls back to safe on unknown name", () => {
    expect(levelByName("typo").name).toBe("safe");
  });
});

describe("strict level", () => {
  test("denies irreversible (git push --force)", () => {
    const d = evaluateAt(strictLevel(), "git push --force origin main");
    expect(d.action).toBe("deny");
    expect(d.class).toBe("write.remote.destroy");
  });

  test("write.remote → deny (mapping)", () => {
    expect(strictLevel().mapping["write.remote"]).toBe("deny");
  });

  test("asks dynamic (bash -c)", () => {
    const d = evaluateAt(strictLevel(), "bash -c whoami");
    expect(d.action).toBe("ask");
    expect(d.class).toBe("dynamic");
  });

  test("asks write.local.destroy (git reset --hard)", () => {
    const d = evaluateAt(strictLevel(), "git reset --hard HEAD~1");
    expect(d.action).toBe("ask");
    expect(d.class).toBe("write.local.destroy");
  });

  test("allows write.local (git commit, mkdir)", () => {
    const commit = evaluateAt(strictLevel(), "git commit -m fix");
    expect(commit.action).toBe("allow");
    expect(commit.class).toBe("write.local");
    const mkdir = evaluateAt(strictLevel(), "mkdir foo");
    expect(mkdir.action).toBe("allow");
    expect(mkdir.class).toBe("write.local");
  });

  test("allows read.remote (gh pr list)", () => {
    const d = evaluateAt(strictLevel(), "gh pr list");
    expect(d.action).toBe("allow");
    expect(d.class).toBe("read.remote");
  });

  test("still asks unknown commands", () => {
    const d = evaluateAt(strictLevel(), "mybinary foo");
    expect(d.action).toBe("ask");
    expect(d.class).toBe("unknown");
  });

  test("read.local still flows", () => {
    const d = evaluateAt(strictLevel(), "ls");
    expect(d.action).toBe("allow");
  });
});

describe("safe level (default)", () => {
  test("asks irreversible", () => {
    const d = evaluateAt(safeLevel(), "git push --force origin main");
    expect(d.action).toBe("ask");
    expect(d.class).toBe("write.remote.destroy");
  });

  test("asks eval", () => {
    const d = evaluateAt(safeLevel(), "bash -c whoami");
    expect(d.action).toBe("ask");
    expect(d.class).toBe("dynamic");
  });

  test("denies dangerous", () => {
    const d = evaluateAt(safeLevel(), "rm -rf /");
    expect(d.action).toBe("deny");
  });
});

describe("loose level", () => {
  test("allows eval (bash -c)", () => {
    const d = evaluateAt(looseLevel(), "bash -c whoami");
    expect(d.action).toBe("allow");
    expect(d.class).toBe("dynamic");
  });

  test("allows unknown commands", () => {
    const d = evaluateAt(looseLevel(), "mybinary foo");
    expect(d.action).toBe("allow");
    expect(d.class).toBe("unknown");
  });

  test("still denies dangerous (rm -rf /)", () => {
    const d = evaluateAt(looseLevel(), "rm -rf /");
    expect(d.action).toBe("deny");
  });

  test("allows write.remote.destroy (git push --force) — only dangerous denies", () => {
    const d = evaluateAt(looseLevel(), "git push --force origin main");
    expect(d.action).toBe("allow");
    expect(d.class).toBe("write.remote.destroy");
  });
});
