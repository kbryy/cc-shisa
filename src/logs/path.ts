import { join } from "node:path";

export const LOG_FILENAME = "decisions.jsonl";

export function defaultLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env["XDG_STATE_HOME"];
  const base = xdg && xdg.length > 0 ? xdg : `${env["HOME"] ?? ""}/.local/state`;
  return `${base}/cc-shisa`;
}

export function logFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultLogDir(env), LOG_FILENAME);
}
