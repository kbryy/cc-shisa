import type { Class, Level } from "./types.ts";

const STRICTNESS: Readonly<Record<Class, number>> = {
  dangerous: 6,
  irreversible: 5,
  "arbitrary-code": 4,
  "write-remote": 3,
  unknown: 2,
  "write-local": 1,
  read: 0,
};

export function strictnessRank(c: Class): number {
  return STRICTNESS[c];
}

export function safeLevel(): Level {
  return {
    name: "safe",
    mapping: {
      dangerous: "deny",
      irreversible: "ask",
      "arbitrary-code": "ask",
      "write-remote": "ask",
      "write-local": "allow",
      unknown: "ask",
      read: "allow",
    },
  };
}
