import { describe, expect, test } from "bun:test";

import { BashParserBackend } from "../src/parser/impl/bash-parser.ts";
import { parse } from "../src/parser/index.ts";
import { recoverParse } from "../src/parser/recovery.ts";

describe("recoverParse — quoted heredoc with parens", () => {
  test("parens inside <<'EOF' body trigger primary parse failure", () => {
    const cmd = `git commit -m "$(cat <<'EOF'\nA (B) C\nEOF\n)"`;
    const primary = BashParserBackend.parse(cmd);
    expect(primary.parseErr).toBeDefined();
  });

  test("recoverParse strips heredoc body and reaches git commit", () => {
    const cmd = `git commit -m "$(cat <<'EOF'\nA (B) C\nEOF\n)"`;
    const primary = BashParserBackend.parse(cmd);
    const r = recoverParse(cmd, BashParserBackend, primary);
    expect(r.parseErr).toBeUndefined();
    expect(r.segments.some((s) => s.binary === "git" && s.args[0] === "commit")).toBe(true);
  });

  test("public parse() applies recovery automatically", () => {
    const cmd = `git commit -m "$(cat <<'EOF'\nA (B) C\nEOF\n)"`;
    const r = parse(cmd);
    expect(r.parseErr).toBeUndefined();
    expect(r.segments.length).toBeGreaterThan(0);
  });
});

describe("recoverParse — line-by-line fallback", () => {
  test("multi-line input where one line is unparseable still extracts the others", () => {
    const cmd = `git add -A\n((((unbalanced\nrm -rf /`;
    const primary = BashParserBackend.parse(cmd);
    expect(primary.parseErr).toBeDefined();
    const r = recoverParse(cmd, BashParserBackend, primary);
    const binaries = r.segments.map((s) => s.binary);
    expect(binaries).toContain("git");
    expect(binaries).toContain("rm");
  });

  test("compound command with heredoc + multiple statements is fully recovered", () => {
    const cmd = `git add -A\ngit diff --cached --stat | tail -10\ngit commit -m "$(cat <<'EOF'\nfeat: A (B) C\nEOF\n)"`;
    const r = parse(cmd);
    expect(r.parseErr).toBeUndefined();
    const binaries = r.segments.map((s) => s.binary);
    expect(binaries).toContain("git");
  });
});

describe("recoverParse — gives up gracefully", () => {
  test("completely unparseable input keeps the primary parseErr", () => {
    const cmd = "((((((((((";
    const r = parse(cmd);
    expect(r.parseErr).toBeDefined();
    expect(r.segments).toEqual([]);
  });
});

describe("recoverParse — heredoc tag matching", () => {
  test("heredoc strip respects exact tag match (TAG vs TAG1)", () => {
    const cmd = `cat <<'TAG'\ncontent (with parens)\nTAG1 not closer\nTAG\nls`;
    const r = parse(cmd);
    expect(r.parseErr).toBeUndefined();
    expect(r.segments.some((s) => s.binary === "ls")).toBe(true);
  });

  test("heredoc with leading-tab dash form (<<-'TAG')", () => {
    const cmd = `cat <<-'EOF'\n\tA (B) C\n\tEOF\nls`;
    const r = parse(cmd);
    expect(r.parseErr).toBeUndefined();
  });
});
