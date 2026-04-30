import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defaultLogDir } from "../shadow/index.ts";

const LOG_FILENAME = "decisions.jsonl";

export interface LogEntry {
  ts: string;
  command: string;
  originalAction: "allow" | "ask" | "deny";
  class: string;
  reason: string;
  matchedRule?: string;
  segment?: string;
}

export function logFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultLogDir(env), LOG_FILENAME);
}

export function readLog(env: NodeJS.ProcessEnv = process.env): LogEntry[] {
  const path = logFilePath(env);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf-8");
  const out: LogEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      out.push(JSON.parse(trimmed) as LogEntry);
    } catch {
      // skip malformed lines silently — better to show partial than crash
    }
  }
  return out;
}

export interface Summary {
  path: string;
  total: number;
  earliest?: string;
  latest?: string;
  byAction: Record<string, number>;
  topRules: Array<{ ruleId: string; count: number; samples: string[] }>;
  topAsk: Array<{ reason: string; count: number; samples: string[] }>;
  topDeny: Array<{ ruleId: string; count: number; samples: string[] }>;
}

export function summarize(entries: readonly LogEntry[], path: string): Summary {
  const byAction: Record<string, number> = {};
  const ruleAgg = new Map<string, { count: number; samples: string[] }>();
  const askAgg = new Map<string, { count: number; samples: string[] }>();
  const denyAgg = new Map<string, { count: number; samples: string[] }>();

  for (const e of entries) {
    byAction[e.originalAction] = (byAction[e.originalAction] ?? 0) + 1;

    if (e.matchedRule) {
      bumpAgg(ruleAgg, e.matchedRule, e.command);
    }
    if (e.originalAction === "ask") {
      bumpAgg(askAgg, e.matchedRule ?? e.reason, e.command);
    }
    if (e.originalAction === "deny" && e.matchedRule) {
      bumpAgg(denyAgg, e.matchedRule, e.command);
    }
  }

  const earliest = entries[0]?.ts;
  const latest = entries[entries.length - 1]?.ts;

  const summary: Summary = {
    path,
    total: entries.length,
    byAction,
    topRules: topN(ruleAgg, 10).map(([ruleId, v]) => ({ ruleId, ...v })),
    topAsk: topN(askAgg, 5).map(([reason, v]) => ({ reason, ...v })),
    topDeny: topN(denyAgg, 5).map(([ruleId, v]) => ({ ruleId, ...v })),
  };
  if (earliest !== undefined) summary.earliest = earliest;
  if (latest !== undefined) summary.latest = latest;
  return summary;
}

function bumpAgg(
  agg: Map<string, { count: number; samples: string[] }>,
  key: string,
  command: string,
): void {
  const cur = agg.get(key);
  if (cur) {
    cur.count += 1;
    if (cur.samples.length < 3 && !cur.samples.includes(command)) {
      cur.samples.push(command);
    }
  } else {
    agg.set(key, { count: 1, samples: [command] });
  }
}

function topN<V extends { count: number }>(
  agg: Map<string, V>,
  n: number,
): Array<[string, V]> {
  return [...agg.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n);
}

export function renderSummary(s: Summary): string {
  if (s.total === 0) {
    return `Log:     ${s.path}\nEntries: 0 (run with CC_SHISA_LOG=1 or CC_SHISA_SHADOW=1 to populate)`;
  }
  const lines: string[] = [];
  lines.push(`Log:     ${s.path}`);
  if (s.earliest && s.latest) {
    lines.push(`Entries: ${s.total} (${s.earliest} → ${s.latest})`);
  } else {
    lines.push(`Entries: ${s.total}`);
  }
  lines.push("");
  lines.push("By original action:");
  for (const [action, count] of Object.entries(s.byAction).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / s.total) * 100).toFixed(1);
    lines.push(`  ${action.padEnd(6)} ${String(count).padStart(5)}  ${pct}%`);
  }
  appendSection(lines, "Top matched rules", s.topRules.map((r) => ({ key: r.ruleId, count: r.count, samples: r.samples })));
  appendSection(lines, 'Top "ask" reasons', s.topAsk.map((r) => ({ key: r.reason, count: r.count, samples: r.samples })));
  appendSection(lines, 'Top "deny" entries', s.topDeny.map((r) => ({ key: r.ruleId, count: r.count, samples: r.samples })));
  return lines.join("\n");
}

function appendSection(
  out: string[],
  title: string,
  rows: ReadonlyArray<{ key: string; count: number; samples: readonly string[] }>,
): void {
  if (rows.length === 0) return;
  out.push("");
  out.push(`${title}:`);
  const keyWidth = Math.max(...rows.map((r) => r.key.length));
  for (const r of rows) {
    const samples = r.samples.join(", ");
    out.push(`  ${r.key.padEnd(keyWidth)}  ${String(r.count).padStart(4)}  ${samples}`);
  }
}

export function renderTail(entries: readonly LogEntry[], n: number): string {
  if (entries.length === 0) {
    return "(no entries)";
  }
  const tail = entries.slice(-n);
  return tail
    .map((e) => {
      const rule = e.matchedRule ?? "-";
      return `${e.ts}  ${e.originalAction.padEnd(5)}  ${e.class.padEnd(14)}  ${rule.padEnd(20)}  ${e.command}`;
    })
    .join("\n");
}
