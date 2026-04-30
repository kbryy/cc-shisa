import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  logFilePath,
  readLog,
  renderSummary,
  renderTail,
  summarize,
  type LogEntry,
} from "../src/logs/index.ts";

function tmpEnv(): { env: NodeJS.ProcessEnv; dir: string; logPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "cc-shisa-logs-"));
  const env = { XDG_STATE_HOME: dir, HOME: dir };
  const logDir = `${dir}/cc-shisa`;
  mkdirSync(logDir, { recursive: true });
  return { env, dir, logPath: `${logDir}/decisions.jsonl` };
}

const sampleEntries: LogEntry[] = [
  { ts: "2026-04-30T10:00:00Z", command: "ls", originalAction: "allow", class: "read", reason: "directory listing", matchedRule: "coreutils.list" },
  { ts: "2026-04-30T10:01:00Z", command: "ls -la", originalAction: "allow", class: "read", reason: "directory listing", matchedRule: "coreutils.list" },
  { ts: "2026-04-30T10:02:00Z", command: "git status", originalAction: "allow", class: "read", reason: "git status", matchedRule: "git.status" },
  { ts: "2026-04-30T10:03:00Z", command: "rm -rf /", originalAction: "deny", class: "dangerous", reason: "rm -rf root", matchedRule: "core.rm.rf.root" },
  { ts: "2026-04-30T10:04:00Z", command: "pnpm install", originalAction: "ask", class: "unknown", reason: "no rule matched" },
];

function writeEntries(path: string, entries: readonly LogEntry[]): void {
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

describe("logs.logFilePath", () => {
  test("uses XDG_STATE_HOME", () => {
    expect(logFilePath({ XDG_STATE_HOME: "/x", HOME: "/h" })).toBe(
      "/x/cc-shisa/decisions.jsonl",
    );
  });
  test("falls back to ~/.local/state", () => {
    expect(logFilePath({ HOME: "/h" })).toBe("/h/.local/state/cc-shisa/decisions.jsonl");
  });
});

describe("logs.readLog", () => {
  test("returns empty when file is missing", () => {
    const { env, dir } = tmpEnv();
    try {
      // No log file written
      expect(readLog(env)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("parses well-formed entries", () => {
    const { env, dir, logPath } = tmpEnv();
    try {
      writeEntries(logPath, sampleEntries);
      const got = readLog(env);
      expect(got).toHaveLength(5);
      expect(got[0]?.command).toBe("ls");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("skips malformed lines silently", () => {
    const { env, dir, logPath } = tmpEnv();
    try {
      writeFileSync(
        logPath,
        [
          JSON.stringify(sampleEntries[0]),
          "{ this is not json",
          JSON.stringify(sampleEntries[1]),
        ].join("\n"),
      );
      const got = readLog(env);
      expect(got).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("logs.summarize", () => {
  test("counts by action", () => {
    const s = summarize(sampleEntries, "/some/path");
    expect(s.total).toBe(5);
    expect(s.byAction).toEqual({ allow: 3, deny: 1, ask: 1 });
  });

  test("aggregates rule matches with samples", () => {
    const s = summarize(sampleEntries, "/some/path");
    const ls = s.topRules.find((r) => r.ruleId === "coreutils.list");
    expect(ls?.count).toBe(2);
    expect(ls?.samples).toContain("ls");
    expect(ls?.samples).toContain("ls -la");
  });

  test("groups asks by reason or matched rule", () => {
    const s = summarize(sampleEntries, "/some/path");
    const ask = s.topAsk[0]!;
    expect(ask.reason).toBe("no rule matched");
    expect(ask.count).toBe(1);
  });

  test("denies are listed separately", () => {
    const s = summarize(sampleEntries, "/some/path");
    expect(s.topDeny[0]?.ruleId).toBe("core.rm.rf.root");
  });

  test("first and last timestamps", () => {
    const s = summarize(sampleEntries, "/some/path");
    expect(s.earliest).toBe("2026-04-30T10:00:00Z");
    expect(s.latest).toBe("2026-04-30T10:04:00Z");
  });
});

describe("logs.renderSummary", () => {
  test("includes path and total", () => {
    const out = renderSummary(summarize(sampleEntries, "/x/y.jsonl"));
    expect(out).toContain("/x/y.jsonl");
    expect(out).toContain("5");
    expect(out).toContain("By original action");
    expect(out).toContain("Top matched rules");
  });

  test("handles empty log gracefully", () => {
    const out = renderSummary(summarize([], "/x/y.jsonl"));
    expect(out).toContain("0");
    expect(out).toContain("CC_SHISA_LOG=1");
  });
});

describe("logs.renderTail", () => {
  test("returns last N entries in order", () => {
    const out = renderTail(sampleEntries, 2);
    const lines = out.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("rm -rf /");
    expect(lines[1]).toContain("pnpm install");
  });

  test("placeholder when log is empty", () => {
    expect(renderTail([], 5)).toBe("(no entries)");
  });
});
