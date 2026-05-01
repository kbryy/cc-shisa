# Contributing to cc-shisa

End-user docs live in [`README.md`](./README.md). This file is for
people who want to understand the internals, build from source, or
send a PR.

🇯🇵 [日本語版はこちら](./CONTRIBUTING.ja.md)

## Build from source

```bash
git clone git@github.com:kbryy/cc-shisa.git && cd cc-shisa
mise install                 # picks the bun version pinned in mise.toml
bun install
bun run typecheck            # tsc --noEmit
bun test                     # 459 tests, ~250ms
bun run build                # ./cc-shisa for darwin-arm64
./cc-shisa init              # registers the hook in ~/.claude/settings.json
```

Cross-platform binaries:

```bash
bun run build:all   # darwin-arm64 + darwin-x64 + linux-arm64 + linux-x64
```

## How cc-shisa decides

```
                 PreToolUse JSON on stdin
                          │
                          ▼
     parse → split compound commands into segments
            (bash-parser default; tree-sitter opt-in)
                          │
                          ▼
     normalize → peel sudo / timeout / env-style prefixes
                          │
                          ▼
     classify → match against rules; pick the strictest class
            (interpreter inspector refines `dynamic` segments)
                          │
                          ▼
     policy → map class to allow / ask / deny per active level
                          │
                          ▼
            HookOutput JSON on stdout (exit 0)
```

**Fail-safe principle**: every layer defaults to `ask` on failure. A
syntax error, an unknown binary, an unresolved variable, an internal
exception — they all collapse to `ask`. The only way to return `allow`
is via an explicit safe match. The only way to return `deny` is via an
explicit dangerous match.

## Class system

| Class                  | Examples                                                                       |
|------------------------|--------------------------------------------------------------------------------|
| `dangerous`            | `rm -rf /`, fork bomb, `dd of=/dev/disk*`, `mkfs`, `chmod -R 777 /`            |
| `dynamic`              | `eval`, `bash -c`, `curl … \| sh`, `node -e`, `python -c` (content opaque)    |
| `unknown`              | Any binary not matched by any rule                                             |
| `local.read`           | `git status`, `ls`, `cat`, `jq`, `pnpm typecheck`                              |
| `local.write`          | `git commit`, `mkdir`, `cp`, `mv`, `git stash`, `git switch`                   |
| `local.write.destroy`  | `git reset --hard`, `rm -rf .git`, `shred`, `rsync --delete`                   |
| `remote.read`          | `gh pr list`, `kubectl get`, `npm view`, `git fetch`, `ping`, `dig`            |
| `remote.write`         | `git push`, `gh pr create`, `npm publish`                                      |
| `remote.write.destroy` | `git push --force`, `git push --delete`                                        |

Hierarchy: locality first (`local.*` / `remote.*`), then operation
(`read` / `write`); `write` has a `destroy` sub-bucket for irreversible
operations.

The full per-level mapping (which class becomes `allow` / `ask` /
`deny`) lives in `src/rules/level.ts`; see also the level table in
the [user README](./README.md#pick-your-level).

## Inspector pattern catalog

The interpreter inspector (`src/classifier/interpreter-inspect.ts`)
refines `dynamic` segments produced by `python` / `python3` /
`python2`, JS+TS runtimes (`node` / `nodejs` / `bun` / `tsx` /
`ts-node` / `deno`), `ruby` / `irb`, and `perl`.

| Behavior on the `-c`/`-e` body                                              | Refined class         |
|-----------------------------------------------------------------------------|-----------------------|
| Shells out / spawns child process                                           | `dangerous`           |
| Removes files (rm / unlink / rmtree / Path.unlink / FileUtils.rm_rf)        | `local.write.destroy` |
| Network mutations (HTTP POST/PUT/DELETE, socket bind/listen, HTTP server)   | `remote.write`        |
| Network reads (HTTP GET, urllib.request, fetch, Net::HTTP.get, LWP)         | `remote.read`         |
| File writes (open w/a, makedirs, writeFile, File.write)                     | `local.write`         |
| Pure literal / arithmetic / `print` / `console.log` / `puts` of a literal   | `local.read`          |
| Dynamic constructs (eval, vm.runIn*, instance_eval, eval-block)             | stays `dynamic` (ask) |
| Anything else                                                               | stays `dynamic` (ask) |

Per-language whitelist file (`~/.config/cc-shisa/interpreter.json`):
the inspector detects `import` (Python), `require` / `from … import`
(Node), `require` (Ruby), or `use` (Perl) and tags the segment with
the user-mapped class. Strictest match (built-in DENY ∪ user list)
wins.

## Parser backends

cc-shisa parses each Bash command into an AST before classifying. Two
backends are bundled, selectable via the `CC_SHISA_PARSER` env var:

| Backend       | Default | Pros                                              | Cons                                                                  |
|---------------|---------|---------------------------------------------------|-----------------------------------------------------------------------|
| `bash-parser` | ✅      | Pure JS, no extra runtime, ~22 ms cold start       | Fails on certain edge cases (e.g. parens inside quoted heredocs)      |
| `tree-sitter` |         | Robust grammar, handles all real-world bash       | +~7 ms cold start, +1.6 MB binary                                      |

If the active backend's parse fails, `src/parser/recovery.ts` falls
back to:

1. Stripping quoted-heredoc bodies and re-parsing.
2. Splitting on newlines and parsing each line independently.
3. Returning `ask` with reason "parser failed".

Recovery handles the common cases by itself, so most users never need
to switch. To opt into tree-sitter:

```bash
export CC_SHISA_PARSER=tree-sitter
```

The grammar WASM is vendored at `src/parser/impl/tree-sitter-bash.wasm`;
the web-tree-sitter runtime WASM is vendored at
`src/parser/impl/web-tree-sitter-runtime.wasm`. To resync after a
`web-tree-sitter` upgrade:

```bash
bun add web-tree-sitter@x.y.z
bun run vendor:wasm   # cp node_modules/web-tree-sitter/web-tree-sitter.wasm src/parser/impl/
git diff              # commit the updated wasm
```

## Testing

```bash
bun test                                # default backend (bash-parser)
CC_SHISA_PARSER=tree-sitter bun test    # tree-sitter backend
```

CI runs both backends on every PR
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

The fixture suite under `tests/fixtures/` exercises cc-shisa
end-to-end:

```bash
cc-shisa test                              # standard cases (~220)
cc-shisa test tests/fixtures/redteam.json  # obfuscation / escape cases
```

The standard suite assumes all built-in modules are enabled; run
`cc-shisa modules pick` first (or use a temp `loose` profile) before
running fixtures locally to avoid `ask`-class fixture mismatches.

## Submitting changes

- Run `bun run typecheck && bun test` before opening a PR
- New rules go in `src/rules/data/<module>.json`. Add a fixture in
  `tests/fixtures/cases.json` and `tests/fixtures/redteam.json` for
  any non-trivial behavior
- Keep the dependency graph small. Each new `bun add` is a security
  review — the whole point of writing this ourselves is to avoid the
  npm supply-chain quagmire
- For deeper context (file layout, hook protocol, decision log) read
  [`CLAUDE.md`](./CLAUDE.md)

## License

MIT — see [`LICENSE`](./LICENSE).
