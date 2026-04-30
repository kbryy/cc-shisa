import { readInput, writeOutput } from "../hookio/index.ts";
import { evaluate } from "../pipeline.ts";
import { apply as applyShadow } from "../shadow/index.ts";

function emitFailSafeAsk(reason: string): void {
  writeOutput("ask", reason);
}

export async function runHook(): Promise<number> {
  let input;
  try {
    input = await readInput();
  } catch (err) {
    if (process.env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: ${(err as Error).message}\n`);
    }
    emitFailSafeAsk("cc-shisa could not read hook input; asking for safety");
    return 0;
  }

  if (input.tool_name !== "Bash") {
    emitFailSafeAsk(`cc-shisa only handles Bash; got ${input.tool_name}`);
    return 0;
  }

  try {
    const decision = evaluate(input.tool_input.command);
    const finalDecision = applyShadow(decision, input.tool_input.command);
    writeOutput(finalDecision.action, finalDecision.reason);
    return 0;
  } catch (err) {
    if (process.env["CC_SHISA_DEBUG"] === "1") {
      process.stderr.write(`cc-shisa: ${(err as Error).message}\n`);
    }
    emitFailSafeAsk("cc-shisa internal error; asking for safety");
    return 0;
  }
}
