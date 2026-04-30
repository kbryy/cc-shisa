import { evaluate } from "../pipeline.ts";

export function runCheck(cmd: string | undefined): number {
  if (cmd === undefined || cmd === "") {
    process.stderr.write("usage: cc-shisa check '<command>'\n");
    return 2;
  }
  const decision = evaluate(cmd);
  console.log(`Action:  ${decision.action}`);
  console.log(`Class:   ${decision.class}`);
  console.log(`Reason:  ${decision.reason}`);
  if (decision.matchedRule !== undefined) {
    console.log(`Rule:    ${decision.matchedRule}`);
  }
  if (decision.segment !== undefined) {
    console.log(`Segment: ${decision.segment}`);
  }
  return 0;
}
