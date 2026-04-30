import type { Action, Class } from "../rules/types.ts";

/** Final decision passed to hookio.write(). */
export interface Decision {
  action: Action;
  class: Class;
  reason: string;
  matchedRule?: string;
  segment?: string;
}
