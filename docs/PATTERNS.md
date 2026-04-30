# cc-shisa — Rule Catalog

This document is the source of truth for `src/rules/data/_core.json`. Both
that JSON file and this document must be kept in sync. When you add a rule,
update both.

## Class assignment philosophy

| Class | When to use |
|---|---|
| `dangerous` | Catastrophic and irreversible at machine scale. Deny outright. |
| `irreversible` | Destroys work but typically scoped (one repo, one branch). Ask. |
| `arbitrary-code` | Cedes control to a remote/dynamic source. Ask. |
| `write-remote` | Affects shared state visible to others. Ask. (MVP: not yet populated) |
| `write-local` | Mutates local fs but recoverable via git/Time Machine. Allow. |
| `read` | Pure read. Allow. |
| `unknown` | No rule matched. Falls to ask. |

## `_core.json` — 13 critical rules

These are the only rules in v0.1.0. Tool-specific modules (git, gh, pnpm,
etc.) come in v0.2+.

### 1. core.rm.rf.root
- **match**: `ast`
- **binary**: `rm`
- **flags**: `["-r", "-f"]` (after bundle expansion of e.g. `-rf`)
- **path_globs**: `["/"]`
- **class**: `dangerous`
- **reason**: `rm -rf against filesystem root`
- **examples that match**: `rm -rf /`, `rm -fr /`, `rm -r -f /`, `sudo rm -rf /`, `FOO=1 timeout 5 rm -rf /`

### 2. core.rm.rf.home
- **match**: `ast`
- **binary**: `rm`
- **flags**: `["-r", "-f"]`
- **path_globs**: `["$HOME", "~", "~/", "$HOME/", "/Users/*"]`
- **class**: `dangerous`
- **reason**: `rm -rf against home directory`
- **examples that match**: `rm -rf $HOME`, `rm -rf ~`, `rm -rf ~/`, `rm -rf /Users/foo`

### 3. core.rm.rf.system
- **match**: `ast`
- **binary**: `rm`
- **flags**: `["-r", "-f"]`
- **path_globs**: `["/etc/**", "/usr/**", "/bin/**", "/sbin/**", "/var/**", "/boot/**", "/System/**", "/Library/**"]`
- **class**: `dangerous`
- **reason**: `rm -rf against system path`
- **examples that match**: `rm -rf /etc/passwd`, `rm -rf /usr/local`, `rm -rf /System/Library`

### 4. core.rm.rf.dotgit
- **match**: `ast`
- **binary**: `rm`
- **flags**: `["-r", "-f"]`
- **path_globs**: `["**/.git", ".git", "**/.git/"]`
- **class**: `irreversible`
- **reason**: `removing .git directory destroys repository history`
- **examples that match**: `rm -rf .git`, `rm -rf path/to/repo/.git`

### 5. core.dd.disk
- **match**: `ast`
- **binary**: `dd`
- **any_flags**: `["of=/dev/disk*", "of=/dev/sd*", "of=/dev/nvme*", "of=/dev/hd*", "of=/dev/rdisk*"]`
- **class**: `dangerous`
- **reason**: `dd writing to a raw device`
- **examples that match**: `dd if=foo.iso of=/dev/disk2`, `dd of=/dev/sda1 if=/dev/zero`
- **note**: `dd` flags are unusual (`of=path` not `--of=path`); regex match might be cleaner — choose whichever ends up smaller in implementation.

### 6. core.mkfs
- **match**: `ast`
- **binaries**: `["mkfs", "mkfs.ext2", "mkfs.ext3", "mkfs.ext4", "mkfs.xfs", "mkfs.btrfs", "mkfs.fat", "mkfs.vfat", "mkfs.ntfs", "mkfs.exfat", "mkfs.hfsplus", "newfs", "newfs_hfs", "newfs_apfs"]`
- **class**: `dangerous`
- **reason**: `creating a filesystem destroys all data on the target`

### 7. core.fdisk.write
- **match**: `ast`
- **binaries**: `["fdisk", "gdisk", "parted", "diskutil"]`
- **class**: `dangerous`
- **reason**: `partition table tools can destroy disks`
- **note**: This is broad. We could refine by checking for `--script` or destructive verbs, but the conservative call is to ask on any invocation.

### 8. core.fork.bomb
- **match**: `regex`
- **pattern**: `:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`
- **class**: `dangerous`
- **reason**: `classic bash fork bomb pattern`

### 9. core.curl.pipe.sh
- **match**: `regex`
- **pattern**: `(curl|wget)\s+[^|]*\|\s*(sh|bash|zsh|fish|dash|ksh)\b`
- **class**: `arbitrary-code`
- **reason**: `piping remote content directly into a shell`

### 10. core.git.push.force
- **match**: `ast`
- **binary**: `git`
- **subcommand**: `push`
- **any_flags**: `["--force", "-f", "--force-with-lease"]`
- **class**: `irreversible`
- **reason**: `force push rewrites remote history`
- **note**: `--force-with-lease` is safer than `--force` but still destructive in collaborative settings.

### 11. core.git.reset.hard
- **match**: `ast`
- **binary**: `git`
- **subcommand**: `reset`
- **flags**: `["--hard"]`
- **class**: `irreversible`
- **reason**: `git reset --hard discards uncommitted changes`

### 12. core.chmod.777.recursive
- **match**: `ast`
- **binary**: `chmod`
- **flags**: `["-R"]`
- **any_flags**: `["777", "a+rwx", "a=rwx"]`
- **class**: `dangerous`
- **reason**: `recursive world-writable permission change`
- **note**: `chmod` mode arguments aren't really "flags", but they appear in the args array as positional tokens. Implementation should treat the mode token as either a flag for any_flags matching OR the path matcher needs to know which positional is the mode vs the path. Easiest: treat the mode literal as if it were in the flag set for matching purposes; the matcher inspects all args.

### 13. core.eval.bash-c
- **match**: `ast`
- Sub-rule a: `binary: "eval"`
- Sub-rule b: `binaries: ["bash", "sh", "zsh", "ksh", "dash"]`, `any_flags: ["-c"]`
- **class**: `arbitrary-code`
- **reason**: `eval / shell -c executes constructed strings`
- **implementation**: split into two rules in the JSON if cleaner. The `eval` form is unconditional; the `bash -c` form requires `-c`.

## `profiles/default.json`

```json
{
  "level": "safe",
  "modules": ["_core"]
}
```

`safe` level mapping (defined in code, not JSON, since it's the canonical
mapping users shouldn't override casually):

```
dangerous       → deny
irreversible    → ask
arbitrary-code  → ask
write-remote    → ask
write-local     → allow
read            → allow
unknown         → ask
```

## Suggested test fixtures (per rule)

For each rule, add at minimum:
- One **positive** case: triggers the rule, returns the expected action.
- One **negative** case: looks similar but should NOT trigger (e.g. `rm tmp.txt` shouldn't match `rm -rf /`).
- One **obfuscated** case: tests the rule survives basic evasion (`sudo rm -rf /`, `FOO=1 rm -rf /`, etc.).

The `redteam.json` fixture (Phase 3) should systematically cover obfuscation:
prefix wrappers, flag-bundle variations, quoting, compound commands,
substitutions. See `docs/DESIGN.md` for the full coverage list.

## Adding a new rule

1. Decide which existing module to add to (or create a new module file under `src/rules/data/modules/`; not yet active in MVP).
2. Add the rule object to the JSON file. Required fields: `id`, `match`, `class`, `reason`. `match`-specific fields per the matcher.
3. Add at least 2 fixture cases (one positive, one negative) to `tests/fixtures/cases.json`.
4. Run `bun test`. Fix until green.
5. Update this document with the new rule's row.
6. Open a PR / commit. PR body should list the new rule(s) and link to the originating issue or incident.

## When NOT to add a rule

- The classification is "weird" — no clear class. Better to leave as unknown→ask.
- The rule depends on runtime state we can't statically determine (variable values, file contents). Add it as `arbitrary-code` if the indirection is via shell (`eval`, `bash -c`); otherwise leave alone.
- The rule only matters in a specific repo. That's `.claude/cc-shisa.json` territory — coming in v0.4.x.

## JSON structure (draft for `_core.json`)

```json
{
  "name": "_core",
  "description": "Critical patterns shipped with cc-shisa.",
  "rules": [
    {
      "id": "core.rm.rf.root",
      "match": "ast",
      "binary": "rm",
      "flags": ["-r", "-f"],
      "path_globs": ["/"],
      "class": "dangerous",
      "reason": "rm -rf against filesystem root"
    },
    {
      "id": "core.rm.rf.home",
      "match": "ast",
      "binary": "rm",
      "flags": ["-r", "-f"],
      "path_globs": ["$HOME", "~", "~/", "$HOME/", "/Users/*"],
      "class": "dangerous",
      "reason": "rm -rf against home directory"
    },
    {
      "id": "core.rm.rf.system",
      "match": "ast",
      "binary": "rm",
      "flags": ["-r", "-f"],
      "path_globs": ["/etc/**", "/usr/**", "/bin/**", "/sbin/**", "/var/**", "/boot/**", "/System/**", "/Library/**"],
      "class": "dangerous",
      "reason": "rm -rf against system path"
    },
    {
      "id": "core.rm.rf.dotgit",
      "match": "ast",
      "binary": "rm",
      "flags": ["-r", "-f"],
      "path_globs": ["**/.git", ".git", "**/.git/"],
      "class": "irreversible",
      "reason": "removing .git directory destroys repository history"
    },
    {
      "id": "core.dd.disk",
      "match": "ast",
      "binary": "dd",
      "any_flags": ["of=/dev/disk*", "of=/dev/sd*", "of=/dev/nvme*", "of=/dev/hd*", "of=/dev/rdisk*"],
      "class": "dangerous",
      "reason": "dd writing to a raw device"
    },
    {
      "id": "core.mkfs",
      "match": "ast",
      "binaries": ["mkfs", "mkfs.ext2", "mkfs.ext3", "mkfs.ext4", "mkfs.xfs", "mkfs.btrfs", "mkfs.fat", "mkfs.vfat", "mkfs.ntfs", "mkfs.exfat", "mkfs.hfsplus", "newfs", "newfs_hfs", "newfs_apfs"],
      "class": "dangerous",
      "reason": "creating a filesystem destroys all data on the target"
    },
    {
      "id": "core.fdisk.write",
      "match": "ast",
      "binaries": ["fdisk", "gdisk", "parted", "diskutil"],
      "class": "dangerous",
      "reason": "partition table tools can destroy disks"
    },
    {
      "id": "core.fork.bomb",
      "match": "regex",
      "pattern": ":\\(\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:",
      "class": "dangerous",
      "reason": "classic bash fork bomb pattern"
    },
    {
      "id": "core.curl.pipe.sh",
      "match": "regex",
      "pattern": "(curl|wget)\\s+[^|]*\\|\\s*(sh|bash|zsh|fish|dash|ksh)\\b",
      "class": "arbitrary-code",
      "reason": "piping remote content directly into a shell"
    },
    {
      "id": "core.git.push.force",
      "match": "ast",
      "binary": "git",
      "subcommand": "push",
      "any_flags": ["--force", "-f", "--force-with-lease"],
      "class": "irreversible",
      "reason": "force push rewrites remote history"
    },
    {
      "id": "core.git.reset.hard",
      "match": "ast",
      "binary": "git",
      "subcommand": "reset",
      "flags": ["--hard"],
      "class": "irreversible",
      "reason": "git reset --hard discards uncommitted changes"
    },
    {
      "id": "core.chmod.777.recursive",
      "match": "ast",
      "binary": "chmod",
      "flags": ["-R"],
      "any_flags": ["777", "a+rwx", "a=rwx"],
      "class": "dangerous",
      "reason": "recursive world-writable permission change"
    },
    {
      "id": "core.eval",
      "match": "ast",
      "binary": "eval",
      "class": "arbitrary-code",
      "reason": "eval executes a constructed string"
    },
    {
      "id": "core.shell.dash-c",
      "match": "ast",
      "binaries": ["bash", "sh", "zsh", "ksh", "dash"],
      "any_flags": ["-c"],
      "class": "arbitrary-code",
      "reason": "shell -c executes a constructed string"
    }
  ]
}
```

(Note: I split rule 13 into two separate rules — `core.eval` and
`core.shell.dash-c` — because the matcher's binary field doesn't compose well
with two different binary sets in one rule. Result: 14 rules total in JSON,
even though there are 13 logical concerns.)
