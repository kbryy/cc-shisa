# cc-shisa

> Static-analysis `PreToolUse` hook for Claude Code — the Okinawan
> guardian that lets safe commands flow and stops the dangerous ones.

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

Pre-release. Phase 0–4 of the implementation roadmap are complete:
parser, classifier, policy, hook I/O, shadow mode, and `init`
subcommand. v0.1.0 ships once Homebrew tap distribution is wired up.

## Install (planned, once v0.1.0 ships)

```bash
brew tap kbryy/tap
brew install cc-shisa
cc-shisa init      # registers the hook in ~/.claude/settings.json
```

Until then, build from source:

```bash
git clone git@github.com:kbryy/cc-shisa.git && cd cc-shisa
mise install                 # picks bun version from mise.toml
bun install
bun run build                # produces ./cc-shisa for darwin-arm64
./cc-shisa init              # writes a hook entry into ~/.claude/settings.json
```

## What it blocks

The bundled `_core.json` covers 15 destructive patterns:

- `rm -rf /`, `$HOME`, `~`, `/Users/*`, `/etc`, `/usr`, `/var`, ... (system paths)
- `rm -rf .git` (repo destruction)
- `dd of=/dev/{disk,sd,nvme,hd,rdisk}*` (raw-device writes)
- `mkfs*`, `newfs*` (filesystem creation)
- `fdisk` / `gdisk` / `parted` (partition tools)
- `diskutil eraseDisk` / `partitionDisk` / `secureErase` / ...
- The classic bash fork bomb
- `curl … | sh` and `wget … | bash` (and zsh / fish / dash / ksh variants)
- `git push --force` / `-f` / `--force-with-lease`
- `git reset --hard`
- `chmod -R 777` / `a+rwx`
- `eval`
- `bash -c` / `sh -c` / `zsh -c` / ...

Tool-specific modules (git read commands, gh, pnpm, docker, …) come in
v0.2+ so common workflows stop falling to `ask`.

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

## Shadow mode

For a careful rollout, run in shadow mode so cc-shisa decides on every
Bash command but always answers `allow`, while logging what it would
have done:

```bash
export CC_SHISA_SHADOW=1
# Hook runs normally but every decision is forced to "allow".
# JSONL log: ${XDG_STATE_HOME:-~/.local/state}/cc-shisa/decisions.jsonl
```

Run a normal Claude Code session for a week, then inspect the log:

- Lines with `originalAction:"deny"` are commands cc-shisa would have
  blocked. Verify they were genuinely dangerous.
- Lines with `originalAction:"ask"` are commands it would have asked
  about. Verify the prompts are bearable in volume.
- `unset CC_SHISA_SHADOW` and restart Claude Code to enter enforce mode.

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
cc-shisa test                              # 36 cases.json
cc-shisa test tests/fixtures/redteam.json  # 21 obfuscation cases
```

This runs the bundled fixture data through the same pipeline the hook
uses, useful for verifying an installed binary against a known-good
corpus.

## Configuration

cc-shisa is intentionally configuration-light at v0.1. The single
profile is `safe`, which maps:

| Class            | Action |
|------------------|--------|
| `dangerous`      | `deny` |
| `irreversible`   | `ask`  |
| `arbitrary-code` | `ask`  |
| `write-remote`   | `ask`  |
| `write-local`    | `allow`|
| `unknown`        | `ask`  |
| `read`           | `allow`|

Per-class overrides and per-repo `.claude/cc-shisa.json` are deferred
to v0.4.

## Documents

- [`CLAUDE.md`](./CLAUDE.md) — agent-facing context: architecture,
  class system, hook protocol, decision log. Read this first if you're
  an AI assistant or contributing.

## License

MIT — see [`LICENSE`](./LICENSE).
