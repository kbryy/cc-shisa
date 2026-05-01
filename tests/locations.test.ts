import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyLocation,
  findLocation,
  type LocationEntry,
  type LocationsConfig,
  locationsPath,
  type NormalizedPath,
  normalizePath,
  readLocations,
  safeNormalizePath,
  writeLocations,
} from "../src/rules/locations.ts";
import type { Profile } from "../src/rules/types.ts";

function tmpHome(): { dir: string; resolvedDir: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "cc-shisa-locations-"));
  const resolvedDir = realpathSync.native(dir);
  return { dir, resolvedDir, env: { HOME: resolvedDir, XDG_CONFIG_HOME: resolvedDir } };
}

function makeNormalized(path: string): NormalizedPath {
  return path as NormalizedPath;
}

describe("locationsPath", () => {
  test("derives from XDG_CONFIG_HOME", () => {
    expect(locationsPath({ XDG_CONFIG_HOME: "/x", HOME: "/h" })).toBe(
      "/x/cc-shisa/locations.json",
    );
  });
});

describe("findLocation — longest-prefix match", () => {
  const config: LocationsConfig = {
    "/Users/kbryy/work": { level: "strict" },
    "/Users/kbryy/work/sensitive": { level: "strict", overrides: { "remote.write": "deny" } },
    "/Users/kbryy/.ghq/github.com/kbryy": { level: "loose" },
  };

  test("exact match returns the entry", () => {
    const r = findLocation(makeNormalized("/Users/kbryy/work"), config);
    expect(r?.path).toBe(makeNormalized("/Users/kbryy/work"));
    expect(r?.entry.level).toBe("strict");
  });

  test("descendant of a registered ancestor matches the longest prefix", () => {
    const r = findLocation(makeNormalized("/Users/kbryy/work/sensitive/src"), config);
    expect(r?.path).toBe(makeNormalized("/Users/kbryy/work/sensitive"));
  });

  test("descendant of a single registered ancestor matches it", () => {
    const r = findLocation(makeNormalized("/Users/kbryy/work/proj-x/src"), config);
    expect(r?.path).toBe(makeNormalized("/Users/kbryy/work"));
  });

  test("unrelated directory returns null", () => {
    const r = findLocation(makeNormalized("/tmp/foo"), config);
    expect(r).toBeNull();
  });

  test("does not treat /work as a prefix of /work-other", () => {
    const r = findLocation(makeNormalized("/Users/kbryy/work-other"), config);
    expect(r).toBeNull();
  });
});

describe("normalizePath", () => {
  test("expands ~ to HOME", () => {
    const { dir, resolvedDir, env } = tmpHome();
    try {
      expect(normalizePath("~", env)).toBe(makeNormalized(resolvedDir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("expands ~/sub to HOME/sub", () => {
    const { dir, resolvedDir, env } = tmpHome();
    const sub = join(resolvedDir, "sub");
    mkdirSync(sub);
    try {
      expect(normalizePath("~/sub", env)).toBe(makeNormalized(sub));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves symlinks (realpath)", () => {
    const { dir, resolvedDir, env } = tmpHome();
    const real = join(resolvedDir, "real");
    const link = join(resolvedDir, "link");
    mkdirSync(real);
    symlinkSync(real, link);
    try {
      expect(normalizePath(link, env)).toBe(makeNormalized(real));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws on non-existent path", () => {
    expect(() => normalizePath("/definitely/does/not/exist/anywhere", { HOME: "/h" })).toThrow();
  });
});

describe("safeNormalizePath", () => {
  test("returns null on non-existent path", () => {
    expect(safeNormalizePath("/definitely/does/not/exist/anywhere", { HOME: "/h" })).toBeNull();
  });

  test("returns the realpath for valid input", () => {
    const { dir, resolvedDir, env } = tmpHome();
    try {
      expect(safeNormalizePath(resolvedDir, env)).toBe(makeNormalized(resolvedDir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("applyLocation", () => {
  const baseProfile: Profile = {
    level: "safe",
    modules: ["_core", "git"],
    overrides: { "remote.write": "ask" },
  };

  test("location level overrides user level", () => {
    const merged = applyLocation(baseProfile, { level: "strict" });
    expect(merged.level).toBe("strict");
    expect(merged.overrides).toEqual({ "remote.write": "ask" });
  });

  test("location overrides merge with user overrides per class", () => {
    const merged = applyLocation(baseProfile, {
      overrides: { "local.write.destroy": "deny" },
    });
    expect(merged.overrides).toEqual({
      "remote.write": "ask",
      "local.write.destroy": "deny",
    });
  });

  test("same-class override: location wins", () => {
    const merged = applyLocation(baseProfile, {
      overrides: { "remote.write": "deny" },
    });
    expect(merged.overrides?.["remote.write"]).toBe("deny");
  });

  test("modules are not affected by location", () => {
    const merged = applyLocation(baseProfile, {
      level: "loose",
      overrides: { "remote.write": "allow" },
    });
    expect(merged.modules).toEqual(["_core", "git"]);
  });

  test("empty location entry returns the profile unchanged", () => {
    const merged = applyLocation(baseProfile, {});
    expect(merged).toEqual(baseProfile);
  });
});

describe("readLocations", () => {
  test("returns {} when file is missing", () => {
    const { dir, env } = tmpHome();
    try {
      expect(readLocations(env)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns {} on parse error", () => {
    const { dir, resolvedDir, env } = tmpHome();
    const path = locationsPath(env);
    mkdirSync(join(resolvedDir, "cc-shisa"));
    writeFileSync(path, "{ not valid json");
    try {
      expect(readLocations(env)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips invalid entries (unknown level / unknown class)", () => {
    const { dir, resolvedDir, env } = tmpHome();
    const path = locationsPath(env);
    mkdirSync(join(resolvedDir, "cc-shisa"));
    writeFileSync(
      path,
      JSON.stringify({
        "/p1": { level: "strict" },
        "/p2": { level: "no-such-level" },
        "/p3": { overrides: { "no.such.class": "deny" } },
        "/p4": {},
      }),
    );
    try {
      const out = readLocations(env);
      expect(Object.keys(out).sort()).toEqual(["/p1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("round-trips via writeLocations", () => {
    const { dir, env } = tmpHome();
    const config: LocationsConfig = {
      "/Users/me/work": { level: "strict", overrides: { "remote.write": "deny" } },
      "/Users/me/personal": { level: "loose" },
    };
    try {
      writeLocations(config, env);
      expect(readLocations(env)).toEqual(config);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readLocations — empty entry handling", () => {
  test("entry with both level and overrides undefined is rejected", () => {
    const { dir, resolvedDir, env } = tmpHome();
    const path = locationsPath(env);
    mkdirSync(join(resolvedDir, "cc-shisa"));
    writeFileSync(path, JSON.stringify({ "/p": {} }));
    try {
      expect(readLocations(env)).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
