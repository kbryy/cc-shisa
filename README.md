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

v0.2.1. Phases 0–6 of the implementation roadmap are complete:
parser, classifier, policy, hook I/O, shadow mode, `init` /
`modules` / `logs` subcommands, and a cross-platform release
workflow (`.github/workflows/release.yml`). The Homebrew tap
(`kbryy/homebrew-tap`) and first publish are pending.

## Install (planned, once the Homebrew tap is published)

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
cc-shisa test                              # 36 cases.json
cc-shisa test tests/fixtures/redteam.json  # 21 obfuscation cases
```

This runs the bundled fixture data through the same pipeline the hook
uses, useful for verifying an installed binary against a known-good
corpus.

## Modules

cc-shisa ships a mandatory safety baseline (`_core`) plus a handful
of opt-in modules that classify common workflow commands as
read-only. After install, only `_core` is active; pick the optional
modules you actually use:

```bash
cc-shisa modules                         # list everything with status
cc-shisa modules enable coreutils git    # opt in
cc-shisa modules disable gh              # opt out
```

This writes `~/.config/cc-shisa/profile.json`. Restart Claude Code
(or just let the next hook fire) to pick up the change.

Built-in modules:

| Name        | Default | What it does                                  |
|-------------|---------|-----------------------------------------------|
| `_core`     | always  | 15 destructive patterns; **cannot be disabled** |
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

## Configuration

The single profile is `safe`, which maps:

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
