# cc-shisa

> 🦁 Static-analysis `PreToolUse` hook for Claude Code — the Okinawan guardian
> that lets safe commands flow and stops the dangerous ones.

cc-shisa watches every Bash command Claude Code is about to run, parses it,
classifies it by structure (not text patterns), and returns
`allow` / `ask` / `deny` so you can stop hand-curating `permissions.allow`.

**Status: pre-implementation.** This README is a placeholder. See
[`CLAUDE.md`](./CLAUDE.md) and [`docs/`](./docs) for the design and
implementation plan.

## Why

The bash permission story in Claude Code falls apart at scale: hand-built
allowlists never cover the long tail, denylists have infinite holes, and
compound commands (`a && b`) defeat both. cc-shisa solves it with structural
analysis — parse the AST, look at the actual binary and arguments after
peeling wrappers like `sudo`/`timeout`/`env`, classify each segment, return
the strictest-class decision.

## Planned install

```bash
# Once v0.1.0 ships:
brew tap kbryy/tap
brew install cc-shisa
cc-shisa init      # registers the hook in ~/.claude/settings.json
```

## Planned usage

Once installed, Claude Code calls cc-shisa on every Bash command. By default
it allows safe commands silently and asks/denies dangerous ones with a
human-readable reason.

For a careful rollout, run in shadow mode for a week:

```bash
export CC_SHISA_SHADOW=1
# every decision is forced to "allow" but logged to
# ~/.local/state/cc-shisa/decisions.jsonl
```

Inspect the log, tune rules, then `unset CC_SHISA_SHADOW` for enforce mode.

## What it blocks (planned `_core.json`)

`rm -rf /` and friends, `dd` to raw disks, `mkfs`, fork bombs, `curl|sh`,
`git push --force`, `git reset --hard`, `chmod -R 777`, `eval`, `bash -c`.
Full list in [`docs/PATTERNS.md`](./docs/PATTERNS.md).

Tool-specific modules (git, gh, pnpm, etc.) come in v0.2+.

## Documents

- [`CLAUDE.md`](./CLAUDE.md) — agent-facing context (read this first if you're an AI assistant)
- [`docs/DESIGN.md`](./docs/DESIGN.md) — architecture and algorithms
- [`docs/IMPLEMENTATION.md`](./docs/IMPLEMENTATION.md) — phase-by-phase build plan
- [`docs/PATTERNS.md`](./docs/PATTERNS.md) — rule catalog (source of truth)
- [`docs/HISTORY.md`](./docs/HISTORY.md) — design decision history

## License

MIT — see [`LICENSE`](./LICENSE).
