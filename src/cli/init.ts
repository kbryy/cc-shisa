import { defaultSettingsPath, runInit as runInitImpl } from "../init/index.ts";

export function runInit(pathArg: string | undefined): number {
  let path: string;
  try {
    path = pathArg ?? defaultSettingsPath();
  } catch (err) {
    process.stderr.write(`cc-shisa init: ${(err as Error).message}\n`);
    return 1;
  }
  const result = runInitImpl(path);
  console.log(result.message);
  return result.status === "error" ? 1 : 0;
}
