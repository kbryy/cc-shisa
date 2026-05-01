# cc-shisa

> Static-analysis `PreToolUse` hook for Claude Code — the Okinawan
> guardian that lets safe commands flow and stops the dangerous ones.

🇯🇵 [日本語版 README はこちら](./README.ja.md)

Claude Code's Bash permission story falls apart at scale: hand-curated
allowlists never cover the long tail, denylists have infinite holes,
and compound commands like `pnpm typecheck && pnpm build` defeat both.

cc-shisa watches every Bash command Claude Code is about to run, parses
it into a real AST, classifies each segment by structure, and returns
`allow` / `ask` / `deny` so you stop hand-curating `permissions.allow`.

Named after the Okinawan guardian lion-dogs (シーサー) — pair statues
at gates whose two faces (open mouth = welcome, closed mouth = ward
off) map directly to this tool's job: let safe commands flow, stop
dangerous ones.

## Install

```bash
brew tap kbryy/homebrew-tap
brew install cc-shisa
cc-shisa init      # registers the hook in ~/.claude/settings.json
```

That's it — restart Claude Code (or just let the next Bash call fire)
and cc-shisa starts intercepting commands.

Verify the install with:

```bash
cc-shisa check 'rm -rf /'
# Action:  deny
# Class:   dangerous
# Reason:  rm -rf against filesystem root
```

## What it blocks

The mandatory `_core` baseline blocks ~23 catastrophic and irreversible
patterns out of the box:

- `rm -rf` against `/`, `$HOME`, `~`, `/Users/*`, system paths, or `.git`
- `dd` / shell-redirect to a raw device (`/dev/disk*`, `/dev/sd*`, ...)
- `mkfs*`, `newfs*`, `fdisk` / `gdisk` / `parted`, `diskutil eraseDisk`
- The classic bash fork bomb
- `curl … | sh` / `wget … | bash` (and zsh / fish / dash / ksh variants)
- `kill -9 1` / `killall -9 init`
- Recursive `chown` / `chmod 777` / `a+rwx` on system paths
- `git push --force` / `--delete`, `git reset --hard`
- `shred` / `srm` / `wipe`, `rsync --delete`, `gpg --delete-secret-keys`
- `eval`, `bash -c`, `python -c`, `node -e`, … (with content inspection
  for some interpreters — see "Levels & inspection" below)

`_core` is always loaded and cannot be disabled. Optional modules
(`git`, `gh`, `npm`, `pnpm`, `yarn`, `bun`, `docker`, `kubectl`,
`cargo`, `brew`, `coreutils`) classify hundreds of common workflow
commands as safe so they don't all fall to `ask`.

## Pick your modules

After install, only `_core` is active. Pick the workflow modules you
actually use:

```bash
cc-shisa modules                         # picker (TTY) / list (non-TTY)
cc-shisa modules enable coreutils git    # opt in
cc-shisa modules disable gh              # opt out
```

This writes `~/.config/cc-shisa/profile.json`. The next hook firing
picks up the change.

| Name        | What it covers                                |
|-------------|-----------------------------------------------|
| `_core`     | catastrophic + irreversible (always on)       |
| `coreutils` | `ls`/`cat`/`grep`/`wc`/`pwd`/`mkdir`/`cp`/... |
| `git`       | `git status`/`log`/`diff`/`commit`/`switch`/...|
| `gh`        | `gh pr list`/`view`, `gh issue list`/...      |
| `bun`       | `bun test`/`bun run test/typecheck/lint`/...  |
| `npm`       | `npm test`/`npm run lint`/`npm ls`/...        |
| `pnpm`      | `pnpm test`/`typecheck`/`lint`/...            |
| `yarn`      | `yarn test`/`yarn run lint`/`yarn list`/...   |
| `docker`    | `docker ps`/`logs`/`inspect`/...              |
| `kubectl`   | `kubectl get`/`describe`/`logs`/...           |
| `cargo`     | `cargo check`/`build`/`test`/`fmt`/`clippy`/...|
| `brew`      | `brew list`/`info`/`outdated`/`search`/...    |

## Pick your level

Three security levels ship out of the box:

```bash
cc-shisa level                  # show active level + mapping
cc-shisa level set strict       # write level to ~/.config/cc-shisa/profile.json
```

| Level    | Best for                                | Behavior |
|----------|-----------------------------------------|----------|
| `strict` | Shared resources (work / corp)          | Denies any remote write (push, publish, gh pr create) |
| `safe`   | Default — everyday personal use         | Asks on destroy / dynamic content / unknown binaries; routine reads + writes flow |
| `loose`  | Sandbox / CI / trusted laptop           | Blocks only the `dangerous` baseline; everything else flows |

Custom per-class overrides live in `~/.config/cc-shisa/profile.json`,
e.g. `"overrides": { "remote.write": "ask" }`.

## Recommended rollout

cc-shisa supports a **shadow mode** that forces every decision to
`allow` while still recording what would have happened, so you can
observe before enforcing:

```bash
# Week 1: shadow — every decision is forced to allow + logged
export CC_SHISA_SHADOW=1
```

Inspect the log at
`${XDG_STATE_HOME:-~/.local/state}/cc-shisa/decisions.jsonl` (or via
`cc-shisa logs summary` / `cc-shisa logs tail`):

- `originalAction:"deny"` lines — would-have-blocked. Were they
  genuinely dangerous?
- `originalAction:"ask"` lines — would-have-prompted. Is the volume
  bearable?

When you trust the rules:

```bash
unset CC_SHISA_SHADOW
export CC_SHISA_LOG=1   # optional: keep an audit trail in enforce mode
```

## Custom modules

For team / project-specific rules, drop a JSON file under
`~/.config/cc-shisa/modules/`:

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

User modules are auto-loaded and can never weaken `_core`
(strictest-class wins), so they are safe to add.

## Inspecting interpreter `-c` / `-e`

`python -c "..."` / `node -e "..."` / `ruby -e "..."` / `perl -e "..."`
content is normally `dynamic` (cc-shisa cannot see inside the
constructed string). For these binaries cc-shisa runs a per-language
inspector that refines the class — `os.system` becomes `dangerous`,
`fs.writeFileSync` becomes `local.write`, `console.log("hi")` becomes
`local.read`, and so on.

Whitelist project-specific libraries at
`~/.config/cc-shisa/interpreter.json`:

```jsonc
{
  "python": { "modules": { "pandas": "local.read", "boto3": "remote.write" } },
  "node":   { "modules": { "axios": "remote.read", "esbuild": "local.write" } },
  "ruby":   { "modules": { "faraday": "remote.read" } }
}
```

The strictest match wins — a script that imports `pandas` AND shells
out is still `dangerous`.

## Troubleshooting

> "Why was this command asked / blocked?"

```bash
cc-shisa check 'gh pr create --title foo'
# → Action / Class / Reason / Rule / Segment
```

> "Which commands have been asked the most this week?"

```bash
export CC_SHISA_LOG=1            # enable audit logging if not on
# … later:
cc-shisa logs summary            # aggregated by class, rule, top reasons
cc-shisa logs tail -n 50         # last 50 decisions
cc-shisa logs path               # JSONL file location
```

> "Is the module I expect actually enabled?"

```bash
cc-shisa modules list
# Newly added modules require `cc-shisa modules enable <name>`.
```

> "I want a less restrictive level for now"

```bash
cc-shisa level                   # show the active level + mapping
cc-shisa level set loose         # only block catastrophic patterns
cc-shisa level set safe          # back to default
```

> "A specific class asks too often / too rarely for me"

Drop a per-class override into `~/.config/cc-shisa/profile.json`:

```jsonc
{
  "level": "safe",
  "modules": ["coreutils", "git", "gh"],
  "overrides": {
    "remote.write": "ask",          // ask before any remote write
    "local.write.destroy": "deny"   // never let me destroy locally
  }
}
```

> "I want to try the alternative parser without reinstalling"

```bash
CC_SHISA_PARSER=tree-sitter cc-shisa check '<the command>'
```

If cc-shisa gets a classification wrong (too strict / too loose), please
open an issue with the output of `cc-shisa check '<cmd>'`.

## Learn more

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how cc-shisa works
  internally, build from source, parser backends, the inspector
  pattern catalog, running tests
- [`CLAUDE.md`](./CLAUDE.md) — agent-facing context: full file layout,
  hook protocol, decision log

## License

MIT — see [`LICENSE`](./LICENSE).
