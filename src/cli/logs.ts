import {
  logFilePath,
  readLog,
  renderSummary,
  renderTail,
  summarize,
} from "../logs/index.ts";

export function runLogs(args: readonly string[]): number {
  const sub = args[0] ?? "summary";
  switch (sub) {
    case "summary": {
      const path = logFilePath();
      const entries = readLog();
      console.log(renderSummary(summarize(entries, path)));
      return 0;
    }
    case "tail": {
      const n = parseTailCount(args.slice(1));
      if (n === null) {
        process.stderr.write("usage: cc-shisa logs tail [-n N]\n");
        return 2;
      }
      console.log(renderTail(readLog(), n));
      return 0;
    }
    case "path":
      console.log(logFilePath());
      return 0;
    default:
      process.stderr.write(`cc-shisa logs: unknown subcommand "${sub}"\n`);
      return 2;
  }
}

function parseTailCount(args: readonly string[]): number | null {
  if (args.length === 0) return 20;
  if (args[0] !== "-n" || args[1] === undefined) return null;
  const n = Number(args[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}
