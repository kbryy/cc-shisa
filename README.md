# cc-shisa

> Static-analysis `PreToolUse` hook for Claude Code — the Okinawan
> guardian that lets safe commands flow and stops the dangerous ones.

🇯🇵 [日本語版 README はこちら](./README.ja.md)

Claude Code's Bash permission story falls apart at scale: hand-curated
allowlists never cover the long tail, denylists have infinite holes, and
compound commands like `pnpm typecheck && pnpm build` defeat both.

cc-shisa watches every Bash command Claude Code is about to run, parses
it into a real AST, classifies each segment by structure, and returns
`allow` / `ask` / `deny` so you stop hand-curating `permissions.allow`.

Named after the Okinawan guardian lion-dogs (シーサー). Pair statues at
gates whose two faces — open mouth welcomes, closed mouth wards off —
map directly to this tool: let safe commands flow automatically, stop
dangerous ones.

## Status

v0.2.3 published. The Homebrew tap (`kbryy/homebrew-tap`) is live and
the release workflow auto-publishes binaries + Formula on every tag.
Core feature set covered: parser, classifier with content inspection
(`python -c` introspection), 9-class policy with `strict` / `safe` /
`loose` levels, hook I/O, shadow mode, and `init` / `modules` / `level`
/ `logs` subcommands.

## Install

```bash
brew tap kbryy/homebrew-tap
brew install cc-shisa
cc-shisa init      # registers the hook in ~/.claude/settings.json
```

Or build from source:

```bash
git clone git@github.com:kbryy/cc-shisa.git && cd cc-shisa
mise install                 # picks bun version from mise.toml
bun install
bun run build                # produces ./cc-shisa for darwin-arm64
./cc-shisa init              # writes a hook entry into ~/.claude/settings.json
```

## What it blocks

The bundled `_core.json` covers ~23 critical patterns. Highlights:

- `rm -rf /`, `$HOME`, `~`, `/Users/*`, `/etc`, `/usr`, `/var`, ... (system paths)
- `rm -rf .git` (repo destruction)
- `dd of=/dev/{disk,sd,nvme,hd,rdisk}*` (raw-device writes)
- Shell redirection to a raw device (`> /dev/sda`, `>> /dev/disk0`)
- `mkfs*`, `newfs*` (filesystem creation)
- `fdisk` / `gdisk` / `parted` (partition tools)
- `diskutil eraseDisk` / `partitionDisk` / `secureErase` / ...
- The classic bash fork bomb
- `curl … | sh` and `wget … | bash` (and zsh / fish / dash / ksh variants)
- `kill -9 1` / `killall -9 init` (SIGKILL to PID 1)
- Recursive `chown` on system paths
- `chmod -R 777` / `a+rwx`
- `git push --force` / `-f` / `--force-with-lease` / `--delete`
- `git reset --hard`
- `shred` / `srm` / `wipe`
- `rsync --delete`
- `gpg --delete-secret-keys`
- `eval` / `bash -c` / `sh -c` / `zsh -c`
- Language runtime inline `-e` / `--eval` / `-c` (`node -e`, `python -c`,
  `perl -e`, `ruby -e`, ... — see the [`python -c` inspector](#inspecting-python--c-) below)

Tool-specific modules (git, gh, npm, pnpm, yarn, bun, docker, kubectl,
cargo, brew, coreutils) ship enabled-on-demand via `cc-shisa modules`
and classify hundreds of common workflow commands as `local.read` /
`local.write` / `remote.read` so they stop falling to `ask`.

## How it decides

```
                 PreToolUse JSON on stdin
                          │
                          ▼
     parse → split compound commands into segments
                          │
                          ▼
     normalize → peel sudo / timeout / env-style prefixes
                          │
                          ▼
     classify → match against rules; pick the strictest class
                          │
                          ▼
     policy → map class to allow / ask / deny
                          │
                          ▼
            HookOutput JSON on stdout (exit 0)
```

Failure paths all default to `ask` so the parser, classifier, or hook
plumbing breaking never lets a dangerous command through unprompted.
A syntax error, an unknown binary, an unresolved variable, an internal
exception — all collapse to `ask`.

## Logging

cc-shisa supports two non-default modes that both write JSONL to
`${XDG_STATE_HOME:-~/.local/state}/cc-shisa/decisions.jsonl`:

```bash
# Audit-only: enforcement stays on, every decision is also logged.
export CC_SHISA_LOG=1

# Shadow: every decision is forced to "allow" and logged. The hook is
# essentially a passive observer — useful for the first week to make
# sure rules behave the way you expect before you trust them to block
# real commands.
export CC_SHISA_SHADOW=1
```

When both are set, `CC_SHISA_SHADOW` wins (one log entry per decision,
action forced to allow).

Suggested rollout:

1. Run with `CC_SHISA_SHADOW=1` for ~1 week.
2. Inspect the log:
   - `originalAction:"deny"` lines — would-have-blocked. Were they
     genuinely dangerous?
   - `originalAction:"ask"` lines — would-have-prompted. Is the
     volume bearable?
3. Tune `_core.json` if needed.
4. `unset CC_SHISA_SHADOW` and restart Claude Code to enter enforce
   mode. Optionally keep `CC_SHISA_LOG=1` set so you still capture an
   audit trail.

## Try a single command

```bash
cc-shisa check 'rm -rf /'
# Action:  deny
# Class:   dangerous
# Reason:  rm -rf against filesystem root
# Rule:    core.rm.rf.root
# Segment: rm -rf /
```

## Run the rule fixtures

```bash
cc-shisa test                              # standard cases (~220)
cc-shisa test tests/fixtures/redteam.json  # obfuscation / escape cases
```

This runs the bundled fixture data through the same pipeline the hook
uses, useful for verifying an installed binary against a known-good
corpus. Note: the standard suite assumes all built-in modules are
enabled; run `cc-shisa modules pick` first (or use the `loose` level
in a temp profile) to avoid `ask`-class fixture mismatches.

## Modules

cc-shisa ships a mandatory safety baseline (`_core`) plus a handful
of opt-in modules that classify common workflow commands as
read-only. After install, only `_core` is active; pick the optional
modules you actually use:

```bash
cc-shisa modules                         # interactive picker (TTY) / list (non-TTY)
cc-shisa modules list                    # list everything with status
cc-shisa modules enable coreutils git    # opt in
cc-shisa modules disable gh              # opt out
cc-shisa modules pick                    # explicit picker
```

This writes `~/.config/cc-shisa/profile.json`. Restart Claude Code
(or just let the next hook fire) to pick up the change.

Built-in modules:

| Name        | Default | What it does                                  |
|-------------|---------|-----------------------------------------------|
| `_core`     | always  | ~23 catastrophic + irreversible patterns; **cannot be disabled** |
| `coreutils` | off     | `ls`/`cat`/`grep`/`wc`/`pwd`/...              |
| `git`       | off     | `git status`/`log`/`diff`/`show`/...          |
| `gh`        | off     | `gh pr list`/`view`, `gh issue list`/...      |
| `bun`       | off     | `bun test`/`bun run test/typecheck/lint`/...  |
| `npm`       | off     | `npm test`/`npm run lint`/`npm ls`/...        |
| `pnpm`      | off     | `pnpm test`/`typecheck`/`lint`/...            |
| `yarn`      | off     | `yarn test`/`yarn run lint`/`yarn list`/...   |
| `docker`    | off     | `docker ps`/`logs`/`inspect`/...              |
| `kubectl`   | off     | `kubectl get`/`describe`/`logs`/...           |
| `cargo`     | off     | `cargo check`/`build`/`test`/`fmt`/`clippy`/...|
| `brew`      | off     | `brew list`/`info`/`outdated`/`search`/...    |

Custom modules live at `~/.config/cc-shisa/modules/*.json`. Drop a
file like:

```json
{
  "name": "our-team",
  "rules": [
    {
      "id": "team.no-prod",
      "match": "regex",
      "pattern": "kubectl.*--context=prod",
      "class": "dangerous",
      "reason": "Touching prod cluster requires the on-call hat"
    }
  ]
}
```

User modules are auto-loaded — no `enable` step needed. They cannot
loosen `_core` (strictest-class wins), so they are safe to drop in.

## Security levels

cc-shisa ships three levels — `strict` / `safe` (default) / `loose`. Switch
between them depending on how cautious you want to be:

```bash
cc-shisa level                  # show active level + mapping
cc-shisa level list             # show all built-in levels
cc-shisa level set strict       # write level to ~/.config/cc-shisa/profile.json
```

Mapping per class:

| Class                   | `strict` | `safe` (default) | `loose` |
|-------------------------|----------|------------------|---------|
| `dangerous`             | deny     | deny             | deny    |
| `dynamic`               | ask      | ask              | allow   |
| `unknown`               | ask      | ask              | allow   |
| `local.read`            | allow    | allow            | allow   |
| `local.write`           | allow    | allow            | allow   |
| `local.write.destroy`   | ask      | ask              | allow   |
| `remote.read`           | allow    | allow            | allow   |
| `remote.write`          | **deny** | allow            | allow   |
| `remote.write.destroy`  | **deny** | ask              | allow   |

Hierarchy: locality first (`local.*` / `remote.*`), then operation
(`read` / `write`); `write` has a `destroy` sub-bucket for
irreversible operations (`git reset --hard`, `git push --force`,
`shred`, `rsync --delete`). Three flat specials sit outside:
`dangerous` (visible catastrophic patterns), `dynamic` (content
cc-shisa cannot inspect — eval, bash -c, curl|sh, node -e),
`unknown` (no rule matched).

- `strict` is for shared-resource environments (work / corp). Block
  any remote write outright so the agent cannot silently mutate
  something other people see.
- `safe` is the everyday default — ask on risky stuff, let routine
  flow.
- `loose` blocks only `dangerous`. Use on trusted laptops, sandboxes,
  or CI agents.

`safe` is the right default for everyday use. Switch to `strict` if you want
`git push --force` / `eval` / `npm publish` to outright deny instead of ask;
switch to `loose` on trusted machines where cc-shisa should only block the
truly dangerous patterns.

Per-class overrides via `~/.config/cc-shisa/profile.json` (e.g.
`"overrides": { "eval": "deny" }`) and per-repo `.claude/cc-shisa.json` are
deferred to v0.4.

## Inspecting interpreter `-c` / `-e` content

`bash -c` / `python -c` / `node -e` style commands are normally classified
as `dynamic` (cc-shisa cannot see inside the constructed string). For
language interpreter inline forms, cc-shisa runs a per-language regex
inspector against the content and refines the class. Supported binaries:
- Python: `python` / `python3` / `python2`
- JavaScript / TypeScript runtimes: `node` / `nodejs` / `bun` / `tsx` / `ts-node` / `deno` (Deno uses the same patterns plus its `Deno.*` namespace — `Deno.run`, `Deno.writeTextFile`, `Deno.serve`, etc.)
- Ruby: `ruby` / `irb`
- Perl: `perl`

The inspector follows the same shape across languages — pick the
strictest match between built-in DENY patterns and the user whitelist:

| Behavior on the `-c`/`-e` body | Refined class |
|--------------------------------|--------------|
| Shells out / spawns child process | `dangerous` |
| Removes files (rm / unlink / rmtree / Path.unlink / FileUtils.rm_rf) | `local.write.destroy` |
| Network mutations (HTTP POST/PUT/DELETE, socket bind/listen, HTTP server) | `remote.write` |
| Network reads (HTTP GET, urllib.request, fetch, Net::HTTP.get, LWP) | `remote.read` |
| File writes (open w/a, makedirs, writeFile, File.write) | `local.write` |
| Pure literal / arithmetic / `print` / `console.log` / `puts` of a literal | `local.read` |
| Dynamic constructs (eval, vm.runIn*, instance_eval, eval-block) | stays `dynamic` (ask) |
| Anything else | stays `dynamic` (ask) |

For project-specific libraries, drop a per-language whitelist at
`~/.config/cc-shisa/interpreter.json`:

```jsonc
{
  "python": {
    "modules": {
      "pandas":   "local.read",
      "numpy":    "local.read",
      "polars":   "local.read",
      "httpx":    "remote.read",
      "boto3":    "remote.write"
    }
  },
  "node": {
    "modules": {
      "axios":    "remote.read",
      "esbuild":  "local.write",
      "prettier": "local.write"
    }
  },
  "ruby": {
    "modules": {
      "faraday":  "remote.read",
      "oj":       "local.read"
    }
  }
}
```

When the inspector detects an `import` (Python), `require` / `from … import`
(Node), `require` (Ruby), or `use` (Perl) of a whitelisted module, it
tags the segment with the user-mapped class. The strictest match across
built-in DENY patterns + the user whitelist wins, so a script that
imports `pandas` AND shells out still classifies as `dangerous`.

## Documents

- [`CLAUDE.md`](./CLAUDE.md) — agent-facing context: architecture,
  class system, hook protocol, decision log. Read this first if you're
  an AI assistant or contributing.

## License

MIT — see [`LICENSE`](./LICENSE).
