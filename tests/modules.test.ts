import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  disableModules,
  enableModules,
  listModules,
} from "../src/modules/index.ts";

function tmpEnv(): { env: NodeJS.ProcessEnv; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "cc-shisa-modules-"));
  return { dir, env: { XDG_CONFIG_HOME: dir, HOME: dir } };
}

describe("modules.list", () => {
  test("includes all built-ins, _core marked locked", () => {
    const { env, dir } = tmpEnv();
    try {
      const out = listModules(env);
      expect(out).toContain("_core");
      expect(out).toContain("on (locked)");
      expect(out).toContain("coreutils");
      expect(out).toContain("git");
      expect(out).toContain("gh");
      expect(out).toContain("pnpm");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("default profile (no user file) has only _core enabled", () => {
    const { env, dir } = tmpEnv();
    try {
      const out = listModules(env);
      const lines = out.split("\n");
      const coreutilsLine = lines.find((l) => l.startsWith("coreutils"))!;
      expect(coreutilsLine).toContain("off");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("user profile flips status", () => {
    const { env, dir } = tmpEnv();
    try {
      mkdirSync(`${dir}/cc-shisa`, { recursive: true });
      writeFileSync(
        `${dir}/cc-shisa/profile.json`,
        JSON.stringify({ level: "safe", modules: ["_core", "git"] }),
      );
      const out = listModules(env);
      const gitLine = out.split("\n").find((l) => l.startsWith("git "))!;
      expect(gitLine).toContain("on");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("includes user-custom modules from modules dir", () => {
    const { env, dir } = tmpEnv();
    try {
      mkdirSync(`${dir}/cc-shisa/modules`, { recursive: true });
      writeFileSync(
        `${dir}/cc-shisa/modules/our-team.json`,
        JSON.stringify({
          name: "our-team",
          rules: [
            {
              id: "team.test",
              match: "ast",
              binary: "kubectl",
              class: "irreversible-local",
              reason: "test",
            },
          ],
        }),
      );
      const out = listModules(env);
      expect(out).toContain("our-team");
      expect(out).toContain("user");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("modules.enable", () => {
  test("creates profile.json with the new module", () => {
    const { env, dir } = tmpEnv();
    try {
      const results = enableModules(["coreutils"], env);
      expect(results).toEqual([{ name: "coreutils", status: "added" }]);
      const written = JSON.parse(
        readFileSync(`${dir}/cc-shisa/profile.json`, "utf-8"),
      ) as { modules: string[] };
      expect(written.modules).toContain("coreutils");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects _core (mandatory, cannot be re-added)", () => {
    const { env, dir } = tmpEnv();
    try {
      const results = enableModules(["_core"], env);
      expect(results[0]?.status).toBe("noop-mandatory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports unknown for non-existent module", () => {
    const { env, dir } = tmpEnv();
    try {
      const results = enableModules(["nonexistent"], env);
      expect(results[0]?.status).toBe("unknown");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("idempotent: already-on if listed twice", () => {
    const { env, dir } = tmpEnv();
    try {
      enableModules(["git"], env);
      const second = enableModules(["git"], env);
      expect(second[0]?.status).toBe("already-on");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("modules.disable", () => {
  test("removes from profile", () => {
    const { env, dir } = tmpEnv();
    try {
      enableModules(["git", "coreutils"], env);
      const results = disableModules(["git"], env);
      expect(results[0]?.status).toBe("removed");
      const written = JSON.parse(
        readFileSync(`${dir}/cc-shisa/profile.json`, "utf-8"),
      ) as { modules: string[] };
      expect(written.modules).not.toContain("git");
      expect(written.modules).toContain("coreutils");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses to disable _core", () => {
    const { env, dir } = tmpEnv();
    try {
      const results = disableModules(["_core"], env);
      expect(results[0]?.status).toBe("noop-mandatory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("already-off when module was never enabled", () => {
    const { env, dir } = tmpEnv();
    try {
      const results = disableModules(["pnpm"], env);
      expect(results[0]?.status).toBe("already-off");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
