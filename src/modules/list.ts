import { listAllModules, MANDATORY_MODULE, type ModuleEntry } from "../rules/index.ts";

export function renderList(entries: readonly ModuleEntry[]): string {
  const header = ["NAME", "STATUS", "SOURCE", "RULES", "DESCRIPTION"] as const;
  const rows = entries.map((e) => [
    e.name,
    e.name === MANDATORY_MODULE ? "on (locked)" : e.status,
    e.source,
    String(e.module.rules.length),
    e.module.description ?? "",
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmt = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [fmt(header), ...rows.map(fmt)].join("\n");
}

export function listModules(env: NodeJS.ProcessEnv = process.env): string {
  return renderList(listAllModules(env));
}
