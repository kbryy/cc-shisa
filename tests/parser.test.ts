import { describe, expect, test } from "bun:test";

import { parse } from "../src/parser/index.ts";
import type { Segment } from "../src/parser/types.ts";

interface Case {
  name: string;
  input: string;
  expect: (segments: readonly Segment[]) => void;
}

const seg = (s: readonly Segment[], i: number): Segment => {
  const got = s[i];
  if (!got) throw new Error(`segment[${i}] missing (only ${s.length} found)`);
  return got;
};

const cases: Case[] = [
  {
    name: "simple command",
    input: "rm -rf /tmp",
    expect: (s) => {
      expect(s).toHaveLength(1);
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/tmp"]);
      expect(seg(s, 0).hasExpr).toBe(false);
      expect(seg(s, 0).fromSubsh).toBe(false);
      expect(seg(s, 0).hasHeredoc).toBe(false);
    },
  },
  {
    name: "empty input → no segments, no error",
    input: "",
    expect: (s) => {
      expect(s).toHaveLength(0);
    },
  },
  {
    name: "sudo prefix peeled",
    input: "sudo rm -rf /tmp",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/tmp"]);
    },
  },
  {
    name: "sudo flags consumed",
    input: "sudo -E -n -u root rm -rf /tmp",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/tmp"]);
    },
  },
  {
    name: "timeout consumes its duration",
    input: "timeout 5 rm -rf /tmp",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/tmp"]);
    },
  },
  {
    name: "env-style assignments are dropped",
    input: "FOO=bar BAZ=qux rm -rf /tmp",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/tmp"]);
      expect(seg(s, 0).hasExpr).toBe(false);
    },
  },
  {
    name: "two-layer prefix (sudo + timeout)",
    input: "sudo timeout 5 rm -rf /tmp",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/tmp"]);
    },
  },
  {
    name: "pipeline splits into separate segments",
    input: "curl https://x | sh",
    expect: (s) => {
      expect(s).toHaveLength(2);
      expect(seg(s, 0).binary).toBe("curl");
      expect(seg(s, 1).binary).toBe("sh");
    },
  },
  {
    name: "logical AND/OR splits",
    input: "rm -rf /tmp && rm -rf /var || echo ok",
    expect: (s) => {
      expect(s.map((x) => x.binary)).toEqual(["rm", "rm", "echo"]);
    },
  },
  {
    name: "subshell yields its inner commands",
    input: "(rm -rf /tmp; rm -rf /var)",
    expect: (s) => {
      expect(s.map((x) => x.binary)).toEqual(["rm", "rm"]);
    },
  },
  {
    name: "brace group splits",
    input: "{ rm -rf /tmp; rm -rf /var; }",
    expect: (s) => {
      expect(s.map((x) => x.binary)).toEqual(["rm", "rm"]);
    },
  },
  {
    name: "command substitution recursed with fromSubsh=true",
    input: "eval $(echo rm)",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("eval");
      expect(seg(s, 0).fromSubsh).toBe(false);
      const inner = s.find((x) => x.binary === "echo");
      expect(inner).toBeDefined();
      expect(inner?.fromSubsh).toBe(true);
    },
  },
  {
    name: "backtick substitution recursed with fromSubsh=true",
    input: "echo `rm -rf /tmp`",
    expect: (s) => {
      const inner = s.find((x) => x.binary === "rm");
      expect(inner).toBeDefined();
      expect(inner?.fromSubsh).toBe(true);
      expect(inner?.args).toEqual(["-rf", "/tmp"]);
    },
  },
  {
    name: "parameter expansion marks hasExpr",
    input: "rm -rf $HOME",
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).hasExpr).toBe(true);
      expect(seg(s, 0).args).toEqual(["-rf", "<expr>"]);
    },
  },
  {
    name: "quoted literal stays literal",
    input: 'rm -rf "/etc"',
    expect: (s) => {
      expect(seg(s, 0).binary).toBe("rm");
      expect(seg(s, 0).args).toEqual(["-rf", "/etc"]);
      expect(seg(s, 0).hasExpr).toBe(false);
    },
  },
  {
    name: "heredoc flag set on the cat command",
    input: "cat <<EOF\nhello\nEOF",
    expect: (s) => {
      const cat = s.find((x) => x.binary === "cat");
      expect(cat).toBeDefined();
      expect(cat?.hasHeredoc).toBe(true);
    },
  },
  {
    name: "function body is walked",
    input: "f() { rm -rf /tmp; }",
    expect: (s) => {
      const inner = s.find((x) => x.binary === "rm");
      expect(inner).toBeDefined();
      expect(inner?.args).toEqual(["-rf", "/tmp"]);
    },
  },
  {
    name: "syntax error sets parseErr, no segments",
    input: "rm -rf 'unterminated",
    expect: () => {
      const result = parse("rm -rf 'unterminated");
      expect(result.parseErr).toBeDefined();
      expect(result.segments).toHaveLength(0);
    },
  },
];

describe("parser", () => {
  for (const tc of cases) {
    test(tc.name, () => {
      const result = parse(tc.input);
      expect(result.original).toBe(tc.input);
      tc.expect(result.segments);
    });
  }
});
