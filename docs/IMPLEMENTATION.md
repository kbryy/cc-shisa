# cc-shisa — Implementation Plan

Status as of handoff: project skeleton + docs only. No source code yet. Bun
not installed on dev machine.

Each phase ships a working, tested deliverable. Don't skip ahead.

## Phase 0 — scaffold (~half day)

### Goals
- Bun installed.
- `package.json`, `tsconfig.json`, `.gitignore` in place.
- `src/cli.ts` builds and `cc-shisa version` works.

### Steps
1. `curl -fsSL https://bun.sh/install | bash` — restart shell, confirm `bun --version`.
2. `cd ~/.ghq/github.com/kbryy/cc-shisa && bun init -y`. Edit the generated files:
   - `package.json`: set `"name": "cc-shisa"`, `"type": "module"`, add `"bin": { "cc-shisa": "./src/cli.ts" }`, `"scripts": { "build": "bun build --compile --minify --target=bun-darwin-arm64 ./src/cli.ts --outfile=cc-shisa", "test": "bun test", "dev": "bun run src/cli.ts" }`.
   - `tsconfig.json`: ensure `"strict": true`, `"target": "ESNext"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"types": ["bun-types"]`.
   - `.gitignore`: add `node_modules/`, `cc-shisa`, `*.log`, `.DS_Store`.
3. `bun add -d bun-types @types/node`.
4. Create the directory tree:
   ```
   src/
     cli.ts version.ts
     hookio/{index.ts,types.ts}
     parser/{index.ts,walker.ts,normalize.ts}
     rules/{index.ts,types.ts,data/_core.json,data/profiles/default.json}
     classifier/{index.ts,matcher.ts}
     policy/index.ts
     shadow/index.ts
   tests/
     parser.test.ts classifier.test.ts policy.test.ts e2e.test.ts
     fixtures/{cases.json,redteam.json}
   ```
   The `_core.json` and `default.json` are provided in `docs/PATTERNS.md` — copy them in.
5. Stub `src/cli.ts` with subcommand dispatch (per `docs/DESIGN.md`). Only `version`, `help` need to actually work.
6. Verify:
   ```
   bun run src/cli.ts version
   # → v0.0.0-dev
   bun build --compile --target=bun-darwin-arm64 ./src/cli.ts --outfile=cc-shisa
   ./cc-shisa version
   ```

### Done when
- Both `bun run src/cli.ts version` and `./cc-shisa version` print the version.
- `bun test` runs without errors (no tests yet).

## Phase 1 — parser (~1.5 days)

### Goals
- `src/parser/` complete: walker, normalize, full Segment extraction.
- ≥18 unit tests passing.

### Steps
1. `bun add bash-parser`.
2. Inspect bash-parser's API: how it represents Pipeline, LogicalExpression, List, Subshell, CommandSubstitution, ProcessSubstitution, Function, conditionals. Write a quick spike script that prints the AST for a few sample inputs to confirm node names.
3. Implement `src/parser/types.ts` with `Segment`, `ParseResult`.
4. Implement `src/parser/walker.ts`: walk function that takes the AST root and produces `Segment[]`. Handle every compound node type (split sides, recurse subshells/substitutions, walk function bodies).
5. Implement `src/parser/normalize.ts`:
   - `stripCommandPrefix(words)` — peel sudo/timeout/nice/env/exec/command/time/ionice up to 2 layers.
   - `consumePrefixArgs(prefix, rest)` — count how many tokens belong to the prefix wrapper.
   - `litString(word)` — flatten a Word to its literal string if fully static, else `null`.
   - `lastPath(s)` — strip directory portion (`/usr/bin/sudo` → `sudo`).
6. Tie together in `src/parser/index.ts`:
   ```ts
   export function parse(cmd: string): ParseResult
   ```
   Catch the parser library's throws, set `parseErr`, return.
7. Write `tests/parser.test.ts` with the 18 cases from the previous Go run (we know they work):
   - simple command
   - empty input
   - sudo stripped
   - sudo flags stripped (`-E -n -u root`)
   - timeout stripped (`timeout 5 rm`)
   - env assignments stripped (`FOO=bar BAZ=qux rm`)
   - 2-layer prefix (`sudo timeout 5 rm`)
   - pipe split (`curl x | sh`)
   - and/or split
   - subshell split
   - block split
   - cmd subst recursed (`eval $(echo "rm")`)
   - proc subst recursed (`bash <(curl evil)`)
   - variable expansion → hasExpr=true
   - quoted literal resolved (`rm -rf "/etc"`)
   - heredoc flagged
   - function body walked
   - bad syntax → parseErr set

### Done when
- `bun test tests/parser.test.ts` all green.
- Manual smoke: `bun run src/cli.ts check 'sudo timeout 5 rm -rf /'` shows segment with binary=rm.

### Notes from the Go run

We learned in the Go prototype that the prefix-stripping bug to watch for is
**`timeout` eating the rest of the command** if you don't bound positionals
to one. Fix: track `seenPositional` for timeout/nice/ionice and stop after
one positional arg.

## Phase 2 — rules + classifier + policy (~1.5 days)

### Goals
- `src/rules/`, `src/classifier/`, `src/policy/` complete.
- 13 rules in `_core.json` actually classify per their `class`.
- Unit tests for each module.

### Steps
1. `src/rules/types.ts`: define `Class`, `Action`, `Rule`, `Module`, `Level`, `Profile` (per CLAUDE.md).
2. `src/rules/index.ts`:
   - Import `_core.json` and `profiles/default.json` via Bun's JSON import:
     ```ts
     import core from "./data/_core.json" with { type: "json" };
     import defaultProfile from "./data/profiles/default.json" with { type: "json" };
     ```
   - `loadDefaults()` returns `{ module: core, profile, level: safeLevel() }`.
   - `validate(module)` checks each Rule has id/match/class/reason and required fields per match type.
3. `src/classifier/matcher.ts`:
   - `expandFlagBundle(args)` — expand `-rf` → `-r,-f`, split `--long=val` → `--long` + `val`.
   - `extractPaths(args)` — return non-flag positionals after `--`.
   - `matchAst(seg, rule)` — apply binary/subcommand/flags/any_flags/path_globs filters.
   - `matchRegex(seg, rule, regexCache)` — compile-once cache.
4. `src/classifier/index.ts`:
   - `classify(result, modules) → { class, match? }`.
   - For each segment, run all rules, collect matches, take strictest class.
   - If `result.parseErr`, return `unknown` with no match.
5. `src/policy/index.ts`:
   - `safeLevel()`: returns the Level mapping per CLAUDE.md.
   - `decide(class, match, profile, level)`: lookup mapping (overrides first), build Decision.
6. Unit tests:
   - `tests/classifier.test.ts`: at minimum each of the 13 rules in `_core.json` triggers its expected class on a positive example, and at least one negative example doesn't trigger.
   - `tests/policy.test.ts`: each Class maps to expected Action under SafeLevel; override path works.

### Done when
- `bun test` runs both new suites green.
- Manual: `bun run src/cli.ts check 'rm -rf /'` returns deny with reason=core.rm.rf.root.

## Phase 3 — hookio + CLI + e2e tests (~1 day)

### Goals
- Full pipeline works through stdin → stdout JSON.
- `cases.json` + `redteam.json` (~50 cases) all green.

### Steps
1. `src/hookio/types.ts`: `HookInput`, `HookOutput`, `ToolInput`.
2. `src/hookio/index.ts`:
   - `async function readInput(): Promise<HookInput>` — read all of stdin, JSON.parse, validate shape.
   - `function writeOutput(action, reason): void` — print HookOutput JSON to stdout.
3. `src/cli.ts`: implement `runHook`, `runCheck`, `runTest`. Wire to parser/classifier/policy/shadow.
4. Populate `tests/fixtures/cases.json` (30+ everyday cases) and `redteam.json` (20+ obfuscation cases) — see `docs/DESIGN.md` for the expected coverage.
5. `tests/e2e.test.ts`:
   - For each fixture, spawn `bun run src/cli.ts hook` (or build + run binary), pipe JSON, assert decision.
   - Include some explicit cases that verify shadow mode: set `CC_SHISA_SHADOW=1`, expect allow but log written.

### Done when
- `bun test` everything green (50+ tests).
- `bun build --compile ...` produces a working binary that handles real Claude Code-shaped JSON.

## Phase 4 — shadow mode + init subcommand (~half day)

### Goals
- `cc-shisa init` registers the hook idempotently.
- Shadow mode logging works; can run a session and inspect the JSONL.

### Steps
1. `src/shadow/index.ts`:
   - `enabled(): boolean` — checks env var.
   - `apply(decision): Decision` — overrides if enabled, appends log.
   - `appendLog(entry): void` — writes JSONL line to `${XDG_STATE_HOME ?? ~/.local/state}/cc-shisa/decisions.jsonl`. Wrap in try/catch.
2. Implement `runInit` per `docs/DESIGN.md`. Test on a copy of `~/.claude/settings.json` first.
3. Write `tests/shadow.test.ts` (or fold into e2e):
   - With env set, dangerous command returns allow but JSONL gets the original deny.
   - Without env, behavior unchanged.

### Done when
- `cc-shisa init` modifies `~/.claude/settings.json` correctly with `.bak`.
- `CC_SHISA_SHADOW=1 echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | cc-shisa hook` shows allow + writes a JSONL line with originalAction=deny.

## Phase 5 — README + docs polish (~half day)

### Goals
- README is publishable.
- Internal docs reflect the actual implementation, not just intent.

### Steps
1. Replace the README stub with: project description, quick install, `cc-shisa init` flow, how to inspect shadow logs, link to `docs/PATTERNS.md` for what's blocked, license.
2. Cross-check `docs/DESIGN.md` against actual code; fix anything that drifted.
3. Add `docs/CONTRIBUTING.md` with: how to add a rule, how to run tests, conventions.

### Done when
- Reading the README from cold tells someone exactly what cc-shisa does and how to use it.

## Phase 6 — release pipeline + Homebrew tap (~half day)

### Goals
- `git tag v0.1.0 && git push --tags` produces a working `brew install kbryy/tap/cc-shisa`.

### Steps
1. Create `kbryy/homebrew-tap` repo (public, empty).
2. Generate a fine-grained PAT for the tap repo (Contents: read/write); add it to `kbryy/cc-shisa` secrets as `HOMEBREW_TAP_GITHUB_TOKEN`.
3. Add `.github/workflows/release.yml`:
   - Trigger on `push: tags: ['v*']`.
   - Matrix build: darwin-arm64, darwin-x64, linux-arm64, linux-x64.
   - For each: install Bun, `bun install`, `bun build --compile --target=<target> ./src/cli.ts --outfile=cc-shisa-<os>-<arch>`, compute SHA256.
   - Create GH Release with all 4 binaries + checksums.
   - Final job: clone homebrew-tap, regenerate `Formula/cc-shisa.rb` with new version + sha256s, commit, push.
4. Tag and push; watch the Action.
5. Verify:
   ```
   brew tap kbryy/tap
   brew install cc-shisa
   cc-shisa version
   ```

### Done when
- A clean machine can `brew tap kbryy/tap && brew install cc-shisa` and run the binary.

## Personal rollout (after v0.1.0 ships)

1. `brew install kbryy/tap/cc-shisa`.
2. `cc-shisa init`.
3. Add `export CC_SHISA_SHADOW=1` to your shell rc for now.
4. Use Claude Code normally for a week.
5. Inspect `~/.local/state/cc-shisa/decisions.jsonl`:
   - Any "deny that should be allow"? → tune the rule, ship v0.1.x.
   - Any "allow that should be deny"? → add rule, ship v0.1.x.
6. Once log looks clean: `unset CC_SHISA_SHADOW`, restart Claude Code, observe enforce mode.

## Out of scope (deliberately deferred)

- Tool-specific modules (git/gh/pnpm/docker/...) — v0.2.x.
- Security level switching — v0.3.x.
- Per-repo `.claude/cc-shisa.json` overrides + trust model — v0.4.x.
- Daemon mode — only if Bun cold start ever becomes a measurable problem.
- LLM judge fallback — only if static analysis proves insufficient over time.

## Risk register

| Risk | Mitigation |
|---|---|
| `bash-parser` doesn't handle some construct (e.g. specific heredoc form) | Catch its errors; fall to ask. Add a redteam test case; consider switching to tree-sitter-bash via WASM if it becomes a pattern. |
| Bun build size scares users (~50 MB) | Document it once; users don't actually care about brew install size. |
| Cold start exceeds budget | Profile first. If real, switch to a daemon (don't pre-optimize). |
| Init breaks settings.json | `.bak` file, validate JSON before write, idempotency check, plenty of tests. |
| False positives drive user to disable us | Shadow mode for a week before enforce; iterate on rules with real data. |
| False negatives let `rm -rf /` through | Redteam test corpus must be exhaustive; review all PRs touching parser carefully. |
