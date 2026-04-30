import { evaluate } from "../pipeline.ts";

interface FixtureCase {
  name: string;
  command: string;
  expect: { action: string; class?: string; ruleId?: string };
}

export async function runTest(pathArg: string | undefined): Promise<number> {
  const path = pathArg ?? "tests/fixtures/cases.json";
  let cases: FixtureCase[];
  try {
    const raw: unknown = await Bun.file(path).json();
    cases = parseFixtures(raw);
  } catch (err) {
    process.stderr.write(`cc-shisa test: failed to load ${path}: ${(err as Error).message}\n`);
    return 2;
  }

  let pass = 0;
  let fail = 0;
  for (const tc of cases) {
    const d = evaluate(tc.command);
    const ok =
      d.action === tc.expect.action &&
      (tc.expect.class === undefined || d.class === tc.expect.class) &&
      (tc.expect.ruleId === undefined || d.matchedRule === tc.expect.ruleId);
    if (ok) {
      pass += 1;
    } else {
      fail += 1;
      console.log(
        `FAIL  ${tc.name}\n  cmd:      ${tc.command}\n  expected: ${tc.expect.action}${tc.expect.class ? `/${tc.expect.class}` : ""}${tc.expect.ruleId ? ` (${tc.expect.ruleId})` : ""}\n  got:      ${d.action}/${d.class}${d.matchedRule ? ` (${d.matchedRule})` : ""}`,
      );
    }
  }
  console.log(`\n${pass} pass, ${fail} fail (of ${cases.length})`);
  return fail > 0 ? 1 : 0;
}

function parseFixtures(raw: unknown): FixtureCase[] {
  if (!Array.isArray(raw)) {
    throw new Error("fixtures must be a JSON array");
  }
  return raw.map((item, i) => parseFixtureCase(item, i));
}

function parseFixtureCase(raw: unknown, index: number): FixtureCase {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`fixtures[${index}]: expected object`);
  }
  const obj = raw as Record<string, unknown>;
  const name = obj["name"];
  const command = obj["command"];
  const expect = obj["expect"];
  if (typeof name !== "string") throw new Error(`fixtures[${index}]: missing name`);
  if (typeof command !== "string") throw new Error(`fixtures[${index}]: missing command`);
  if (typeof expect !== "object" || expect === null) {
    throw new Error(`fixtures[${index}]: missing expect`);
  }
  const exp = expect as Record<string, unknown>;
  if (typeof exp["action"] !== "string") {
    throw new Error(`fixtures[${index}]: expect.action must be a string`);
  }
  return {
    name,
    command,
    expect: {
      action: exp["action"],
      ...(typeof exp["class"] === "string" ? { class: exp["class"] } : {}),
      ...(typeof exp["ruleId"] === "string" ? { ruleId: exp["ruleId"] } : {}),
    },
  };
}
