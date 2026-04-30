export interface PickModule {
  name: string;
  description: string;
}

export interface PickConfig {
  modules: readonly PickModule[];
  initiallyEnabled: ReadonlySet<string>;
  readLine: () => string | null;
  write: (line: string) => void;
}

export interface PickResult {
  finalEnabled: Set<string>;
  saved: boolean;
}

/**
 * Pure interactive picker. The caller supplies a readLine / write pair so
 * the loop is testable without touching stdin/stdout.
 *
 * Commands:
 *   <name>   toggle that module
 *   all      enable everything in the list
 *   none     disable everything in the list
 *   done     save current selection and exit
 *   cancel   exit without saving
 *   (EOF)    same as cancel
 */
export function runPick(cfg: PickConfig): PickResult {
  const enabled = new Set(cfg.initiallyEnabled);
  const valid = new Set(cfg.modules.map((m) => m.name));

  cfg.write("Toggle by name. Special: all, none, done, cancel.");
  while (true) {
    cfg.write("");
    renderState(cfg, enabled);
    const raw = cfg.readLine();
    if (raw === null) return { finalEnabled: enabled, saved: false };
    const line = raw.trim();
    if (line === "") continue;
    if (line === "done") return { finalEnabled: enabled, saved: true };
    if (line === "cancel") return { finalEnabled: enabled, saved: false };
    if (line === "all") {
      for (const m of cfg.modules) enabled.add(m.name);
      continue;
    }
    if (line === "none") {
      enabled.clear();
      continue;
    }
    if (!valid.has(line)) {
      cfg.write(`unknown module: ${line}`);
      continue;
    }
    if (enabled.has(line)) enabled.delete(line);
    else enabled.add(line);
  }
}

function renderState(cfg: PickConfig, enabled: ReadonlySet<string>): void {
  const nameWidth = Math.max(...cfg.modules.map((m) => m.name.length));
  for (const m of cfg.modules) {
    const mark = enabled.has(m.name) ? "x" : " ";
    cfg.write(`  [${mark}] ${m.name.padEnd(nameWidth)}  ${m.description}`);
  }
}
