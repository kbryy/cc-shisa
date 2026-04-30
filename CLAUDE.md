# CLAUDE.md — cc-shisa context for AI agents

This file is the primary handoff document. Read it fully before doing any work.

## What is cc-shisa

A `PreToolUse` hook for Claude Code that statically analyzes Bash commands and
returns `allow` / `ask` / `deny`. Named after the Okinawan guardian lion-dogs
(シーサー) — pair statues at gates whose two faces (open mouth = welcome, closed
mouth = ward off) map directly to the dual function of this tool: **let safe
commands flow automatically, stop dangerous ones**.

The motivating problem: Claude Code's allowlist (`permissions.allow`) is
unmaintainable at scale (every new tool requires manual entry; compound
commands `a && b` defeat patterns) and a manual denylist has infinite holes.
cc-shisa solves this with **AST-driven static analysis** — parse the command,
classify each segment, return a decision per the configured policy.

## Status (as of this handoff)

- ✅ GitHub repo created: `kbryy/cc-shisa` (private, MIT)
- ✅ Naming finalized: **cc-shisa**
- ✅ Tech stack chosen: **TypeScript + Bun + bash-parser + bun test**
- ✅ Architecture and design documented in this file
- ✅ Phase 0 scaffold landed: `package.json` / `tsconfig.json` / `src/cli.ts` (`version`/`help` working) / type stubs under `src/{hookio,parser,policy,rules}/types.ts`
- ✅ `_core.json` rule catalog drafted (15 critical patterns after the fdisk/diskutil split)
- ✅ `bun install && bun run typecheck && bun test` pass on a clean clone
- ✅ Phase 1 parser landed: `src/parser/{walker,normalize,index}.ts` + 18 unit tests
- ✅ Phase 2 rules loader / classifier / policy landed: `src/rules/index.ts`, `src/classifier/{index,matcher}.ts`, `src/policy/index.ts`, ~50 additional tests
- ✅ Phase 3 hookio runtime + CLI dispatch + e2e fixtures landed: `src/hookio/index.ts`, `src/pipeline.ts`, real `runHook`/`runCheck`/`runTest`, `tests/fixtures/{cases,redteam}.json`, `tests/e2e.test.ts` (130 tests pass)
- ✅ Phase 4 shadow mode + init subcommand landed: `src/shadow/index.ts` (CC_SHISA_SHADOW=1 forces allow + JSONL log under `$XDG_STATE_HOME/cc-shisa/decisions.jsonl`), `src/init/index.ts` (idempotent settings.json registration with .bak); 147 tests pass
- ✅ Phase 5 README polish landed: user-facing README rewrite with install / shadow / check / test docs and the safe-profile class table
- ✅ Phase 6 release pipeline workflow committed: `.github/workflows/release.yml` builds 4 cross-platform binaries on tag, publishes a GH Release, and updates the Homebrew Formula
- ⏳ One-time release setup pending: create `kbryy/homebrew-tap` (public), mint fine-grained PAT, set `HOMEBREW_TAP_GITHUB_TOKEN` secret, bump version, push first tag
- ❌ Homebrew tap not created yet (`kbryy/homebrew-tap`)

A previous attempt was made in Go (using `mvdan.cc/sh/v3`); it got through the
parser layer with 18 passing tests before the user pivoted to TypeScript. The
parser logic translates directly — same `Segment` shape, same prefix-stripping
edge cases (notably `timeout` over-eating positionals if not bounded).

## Tech stack (finalized — do not re-litigate)

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Familiar ecosystem, type safety in security-critical code, large contributor pool |
| Runtime | **Bun** | 10–30 ms cold start (Node would be 50–150 ms — too slow per hook call); `bun build --compile` makes single-binary distribution; `bun test` ships built-in |
| Bash parser | `bash-parser` (npm) | Pure JS, established package; tree-sitter-bash via WASM also possible but adds complexity |
| Config format | JSON | stdlib parsing, mirror Claude Code's hook IO format; `reason` field substitutes for comments |
| Bundling | `bun build --compile` | ~50 MB single binary; ships everything including the runtime |
| Distribution | Homebrew tap (`kbryy/homebrew-tap`) | macOS-first user; auto-handles Gatekeeper |
| Test framework | `bun test` | Built into Bun, no extra deps (vitest would add hundreds of transitive packages) |

**Hard rule**: keep the dependency graph as shallow as possible. The whole
point of writing this ourselves is to avoid the npm supply-chain quagmire.
Treat each new `bun add` as a security review.

## Architecture

```
                        stdin (PreToolUse JSON)
                                 │
                                 ▼
                     ┌─────────────────────┐
                     │  src/hookio         │  parse HookInput
                     └─────────┬───────────┘
                               ▼
                     ┌─────────────────────┐
                     │  src/parser         │  bash-parser AST →
                     │   walker.ts         │   normalized Segments
                     │   normalize.ts      │   (peel sudo/timeout/env,
                     └─────────┬───────────┘    split pipes/&&/;,
                               ▼                 recurse $()/<())
                     ┌─────────────────────┐
                     │  src/classifier     │  Segment + Rules →
                     │   matcher.ts        │   Class (most-strict wins)
                     └─────────┬───────────┘
                               ▼
                     ┌─────────────────────┐
                     │  src/policy         │  Class + Profile + Level →
                     │                     │   Action (allow/ask/deny)
                     └─────────┬───────────┘
                               ▼
                     ┌─────────────────────┐
                     │  src/shadow         │  if CC_SHISA_SHADOW=1:
                     │                     │   force allow + log JSONL
                     └─────────┬───────────┘
                               ▼
                          stdout (HookOutput JSON)
```

**Fail-safe principle**: every layer must default to `ask` on failure. Parse
error → ask. Unknown binary → ask. Caught exception → ask. The only way to
return `allow` is via an explicit safe match. The only way to return `deny` is
via an explicit dangerous match.

## Class system

Severity ordering (most strict → least):

| Class | Action (safe level) | Examples |
|---|---|---|
| `dangerous` | **deny** | `rm -rf /`, fork bomb, `dd of=/dev/disk*`, `mkfs`, `chmod -R 777 /` |
| `irreversible` | ask | `git push --force`, `git reset --hard`, `rm -rf .git` |
| `arbitrary-code` | ask | `eval`, `bash -c`, `curl ... \| sh` |
| `write-remote` | ask | (Phase 2+) `git push`, `gh pr create`, `npm publish` |
| `write-local` | allow | (Phase 2+) `git commit`, `mkdir`, `cp` |
| `unknown` | ask | Any binary not matched by any rule |
| `read` | allow | (Phase 2+) `git status`, `ls`, `cat`, `pnpm typecheck` |

**Most-strict wins**: when multiple segments or multiple rules match, the
strictest classification is the final one.

## File layout (target)

```
cc-shisa/
├── CLAUDE.md                            ← THIS FILE
├── README.md                            ← public-facing summary (stub for now)
├── LICENSE                              ← MIT (already present)
├── package.json                         ← bun install entry
├── bun.lock                             ← committed lockfile (Bun 1.3+ text format)
├── mise.toml                            ← pins bun version for reproducible builds
├── tsconfig.json
├── .gitignore
├── src/
│   ├── cli.ts                           ← entry point (subcommand dispatch)
│   ├── version.ts
│   ├── hookio/
│   │   ├── types.ts                     ← HookInput, HookOutput, ToolInput
│   │   └── index.ts                     ← read/write helpers
│   ├── parser/
│   │   ├── index.ts                     ← Parse() export
│   │   ├── walker.ts                    ← AST walker, segment collection
│   │   └── normalize.ts                 ← prefix stripping, literal extraction
│   ├── rules/
│   │   ├── types.ts                     ← Class, Action, Rule, Module, Profile, Level
│   │   ├── index.ts                     ← loader (Bun's import attribute or fs)
│   │   └── data/
│   │       ├── _core.json               ← 15 critical patterns (provided)
│   │       └── profiles/
│   │           └── default.json         ← level=safe profile (provided)
│   ├── classifier/
│   │   ├── index.ts                     ← Classify(segments, modules) → Class + Match
│   │   └── matcher.ts                   ← matchAst, matchRegex, flag bundle expansion
│   ├── policy/
│   │   └── index.ts                     ← SafeLevel(), Decide(class, profile, level)
│   └── shadow/
│       └── index.ts                     ← env check + JSONL logger
├── tests/
│   ├── parser.test.ts
│   ├── classifier.test.ts
│   ├── policy.test.ts
│   ├── e2e.test.ts                      ← end-to-end via stdin/stdout pipe
│   └── fixtures/
│       ├── cases.json                   ← 30+ standard cases
│       └── redteam.json                 ← 20+ obfuscation/escape cases
└── .github/
    └── workflows/
        └── release.yml                  ← Phase 6: bun build + GH Releases + tap update
```

## Key types (TypeScript)

```ts
// src/rules/types.ts
export type Class =
  | "dangerous" | "irreversible" | "arbitrary-code"
  | "write-remote" | "write-local" | "read" | "unknown";

export type Action = "allow" | "ask" | "deny";

export interface Rule {
  id: string;
  match: "ast" | "regex";
  pattern?: string;          // regex
  binary?: string;           // ast
  binaries?: string[];       // ast (alternative to binary, OR)
  subcommand?: string;       // ast
  flags?: string[];          // ast — AND
  any_flags?: string[];      // ast — OR
  path_globs?: string[];     // ast — match any of these against arg paths
  class: Class;
  reason: string;            // required, shown to user when ask/deny
}

export interface Module {
  name: string;
  description?: string;
  rules: Rule[];
}

export interface Level {
  name: string;
  mapping: Record<Class, Action>;
}

export interface Profile {
  level: string;
  modules: string[];
  overrides?: Partial<Record<Class, Action>>;
}

// src/parser/index.ts
export interface Segment {
  binary: string;        // resolved command name
  args: string[];        // literal where possible, "<expr>" otherwise
  raw: string;           // re-rendered for regex matching
  hasExpr: boolean;      // any unresolvable expansion present
  fromSubsh: boolean;    // came from $()/<()/>()
  hasHeredoc: boolean;
}

export interface ParseResult {
  original: string;
  segments: Segment[];
  parseErr?: Error;
}

// src/hookio/types.ts
export interface HookInput {
  tool_name: string;
  tool_input: { command: string };
  cwd?: string;
  hook_event_name?: string;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: Action;
    permissionDecisionReason?: string;
  };
}

// src/policy/index.ts
export interface Decision {
  action: Action;
  class: Class;
  reason: string;
  matchedRule?: string;   // rule.id
  segment?: string;       // raw text that matched
}
```

## CLI subcommands

| Command | Behavior |
|---|---|
| `cc-shisa hook` (and `cc-shisa` with no args) | Read HookInput JSON from stdin, write HookOutput JSON to stdout. The default. |
| `cc-shisa check '<cmd>'` | Run a single command through the pipeline and pretty-print decision; `--json` for machine output. |
| `cc-shisa test [path]` | Load `tests/fixtures/cases.json` (or path), assert each case's expected decision matches actual. |
| `cc-shisa init` | Idempotently inject the hook into `~/.claude/settings.json` (with `.bak`). |
| `cc-shisa version` | Print version. |
| `cc-shisa help` | Print usage. |

The hook subcommand must always exit 0 — decisions are conveyed via stdout
JSON, not exit codes (per Claude Code hook contract). The only exception is
truly catastrophic failure where stdout JSON can't be produced; even there,
prefer printing a fail-safe `ask` payload over crashing.

## PreToolUse hook protocol

**Stdin** (one JSON object):
```json
{
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf /tmp/foo" },
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse"
}
```

**Stdout** (one JSON object):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "rm -rf on critical path"
  }
}
```

The `init` subcommand registers the hook by writing this to
`~/.claude/settings.json`:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "cc-shisa hook", "timeout": 10 }
        ]
      }
    ]
  }
}
```

Init must:
1. Read existing settings.json (may not exist).
2. Validate it's parseable JSON; bail with a clear error if not.
3. Make a `.bak` copy.
4. Find or create the `Bash` matcher entry under `hooks.PreToolUse`.
5. Skip (idempotent) if a hook command containing `cc-shisa` already exists.
6. Otherwise append our hook spec.
7. Write back with stable formatting (2-space indent).

## Logging and shadow mode

Two env vars compose enforcement and audit behaviour:

- `CC_SHISA_SHADOW=1` — force `Decision.action` to `allow` for every
  command, append the original (pre-override) decision to JSONL, and
  tag the reason with `(shadow: would have been <orig>)`. Use during
  initial rollout when you do not yet trust the rules to block real
  commands.
- `CC_SHISA_LOG=1` — leave enforcement intact and just append the
  decision to JSONL. Use as an ongoing audit trail in enforce mode.
- Both set — shadow wins; one log line per decision, action forced
  to allow.
- Neither set — pass-through, no log.

Log path: `${XDG_STATE_HOME:-$HOME/.local/state}/cc-shisa/decisions.jsonl`.
Create parents as needed. Failures to write the log must be swallowed silently
(better to allow the command than to break the user's session over a log).

## Distribution: Homebrew tap

Driven by `.github/workflows/release.yml`. Two trigger paths:

- **Manual (default)** — Actions tab → Release → "Run workflow" →
  pick `patch` / `minor` / `major`. The workflow bumps `package.json`
  + `src/version.ts`, commits as `github-actions[bot]`, tags
  `vX.Y.Z`, pushes commit and tag to main, and continues into the
  build / release / tap-update jobs.
- **Tag push** — `git tag -a vX.Y.Z … && git push --follow-tags`.
  The prepare job notices the tag is already in place and skips
  the bump step. Useful for hotfixes done at the CLI.

Four sequential jobs:

1. **prepare** — on `workflow_dispatch`, computes the next version
   from the bump input, writes it into both files, commits, tags,
   and pushes. On `push.tags`, just resolves the tag name. Either
   way, exposes `tag` and `version` as job outputs.
2. **build** — matrix over four Bun targets (darwin-arm64,
   darwin-x64, linux-arm64, linux-x64). Each runner checks out the
   prepared tag, runs `bun install --frozen-lockfile`, then
   `bun build --compile --minify --target=...`. The arm64-Mac and
   linux-x64 variants smoke-test the produced binary (`version` +
   hook fail-safe ask). Each job uploads `<asset>` + `<asset>.sha256`.
3. **release** — downloads the four binary artifacts and uses
   `softprops/action-gh-release@v2` to publish a Release at the
   prepared tag with auto-generated notes and `fail_on_unmatched_files`.
4. **update-tap** — checks out `kbryy/homebrew-tap` using the
   `HOMEBREW_TAP_GITHUB_TOKEN` secret, renders `Formula/cc-shisa.rb`
   from the four sha256 outputs and the resolved version, commits as
   `github-actions[bot]`, and pushes.

### One-time setup (must be done before the first tag push)

These are repo-owner actions GitHub Actions cannot perform itself:

1. **Create the tap repo**: `gh repo create kbryy/homebrew-tap --public
   --description "Homebrew tap"`. The repo is a generic tap that can
   host any number of Formulae (`Formula/*.rb`) — cc-shisa is just its
   first resident. Initialize with an empty README; the `update-tap`
   job creates `Formula/cc-shisa.rb` on first release and leaves any
   sibling Formulae untouched.
2. **Mint a fine-grained PAT** at https://github.com/settings/tokens?type=beta:
   - Repository access: **only `kbryy/homebrew-tap`**.
   - Permissions: **Contents: Read and write** (and nothing else).
   - Expiration: a few months out, then renew.
3. **Add the secret** to `kbryy/cc-shisa`:
   `gh secret set HOMEBREW_TAP_GITHUB_TOKEN`.

### Cutting a release

Default flow (no CLI work, no manual tag):

1. Open Actions → Release → "Run workflow".
2. Pick `patch`, `minor`, or `major`.
3. The workflow bumps version files, commits, tags, builds, publishes
   the GH Release, and updates the tap. ~5 minutes end-to-end.
4. Verify: `brew update && brew upgrade cc-shisa && cc-shisa version`.

CLI fallback (hotfix, or manual tag for any reason):

```
# bump version files yourself, commit, then:
git tag -a v0.1.2 -m "release v0.1.2" && git push --follow-tags
```

The same workflow runs on the tag push, just skipping the bump step.

The rendered Formula uses `on_macos`/`on_linux` blocks so a single file
covers all four arches:

```ruby
class CcShisa < Formula
  desc "Static-analysis PreToolUse hook for Claude Code's Bash tool"
  homepage "https://github.com/kbryy/cc-shisa"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/kbryy/cc-shisa/releases/download/v0.1.0/cc-shisa-darwin-arm64"
      sha256 "..."
    else
      url ".../cc-shisa-darwin-x64"
      sha256 "..."
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url ".../cc-shisa-linux-arm64"
      sha256 "..."
    else
      url ".../cc-shisa-linux-x64"
      sha256 "..."
    end
  end

  def install
    bin.install Dir["cc-shisa-*"].first => "cc-shisa"
  end

  test do
    assert_match(/^\d+\.\d+\.\d+/, shell_output("#{bin}/cc-shisa version"))
  end
end
```

(macOS Gatekeeper isn't an issue under brew because brew installs are
trusted by default.)

## Implementation phases (target)

| Phase | Deliverable |
|---|---|
| 0 | Bun project init, package.json, tsconfig, .gitignore, version subcommand works |
| 1 | Parser + normalize, 18+ unit tests |
| 2 | Rules loader, classifier, policy, SafeLevel, _core.json (15 rules) |
| 3 | hookio, CLI dispatch, e2e tests with cases.json + redteam.json |
| 4 | Shadow mode, init subcommand |
| 5 | README polish |
| 6 | GH Action release workflow + Homebrew tap |

Do **not** skip phases. Each must produce passing tests before moving on.

## Coding conventions

- **TypeScript strict mode**. No `any`. No `// @ts-ignore` without a comment explaining why.
- **No external deps beyond `bash-parser` and `@types/*`** unless explicitly approved. Each dep is a supply-chain risk.
- **No comments unless the WHY is non-obvious.** Don't restate what the code does.
- **No premature abstraction.** Three similar lines beats a wrong abstraction.
- **Fail-safe everywhere.** Every catch block, every undefined check, every parse error path must default to `ask`.
- **No global state.** Pass things through arguments. Loaders return data; they don't mutate singletons.
- **Tests are tabular.** `for (const tc of cases)` style, not bespoke per-test setup.
- **No `console.log` in production paths.** Only stderr, only when `CC_SHISA_DEBUG=1`.

## Decision log (don't re-debate these)

These are settled. If you think one's wrong, raise it as an explicit question
to the user — don't silently change direction.

1. **Language: TypeScript** (not Go, not Python). User pivoted from Go after parser was written. Reason: faster development for the user, larger contributor pool. The cost is npm supply-chain risk, mitigated by minimal deps.

2. **Runtime: Bun** (not Node, not Deno). Cold start matters because hook fires per command. Bun's `--compile` also gives single-binary distribution.

3. **Bash parser: bash-parser npm pkg** (not tree-sitter, not own implementation). Pure JS, established. If accuracy issues arise, can swap to tree-sitter-bash via WASM later.

4. **Config: JSON** (not TOML, not YAML). Mirrors Claude Code's IO. `reason` field handles "why" since JSON has no comments.

5. **Single bundled binary via `bun build --compile`** (not `npm install -g`). Users shouldn't need a Node/Bun runtime.

6. **Distribution: Homebrew tap** (not just GH Releases curl-pipe). Solves Gatekeeper for macOS users.

7. **Shadow mode is the rollout strategy** — first ship in shadow, observe a week, then enable enforce.

8. **Most-strict-wins** for combining classifications across segments and rules.

9. **Naming: cc-shisa** (Okinawan guardian; ペア統像で阿吽=allow/deny duality maps perfectly). Considered: komainu (rejected: passive guard only), banken (rejected: collides with Ruby auth lib), karakuri, hachi, akita, sekisho.

10. **Repo is private** for now. Will go public when v0.1.0 ships and feels stable.

## Pitfalls / gotchas

- **bash-parser semantics**. Verify how it represents heredocs, `$()`, `<()`, `[[ ]]`, arithmetic `((...))`. Tests for these explicitly.
- **Quoting/escape edge cases**. `\rm`, `r''m`, `'r''m'` all parse to the same `rm` in shell. The parser may or may not normalize these. Test and document.
- **Path matching**. We compare paths literally — `$HOME` vs `~` vs `/Users/foo` are all distinct strings to us. Either expand at parse time (risky — the value of `$HOME` at hook time may not match user intent) or include all common spellings in `path_globs`. The latter is what `_core.json` does.
- **Subcommand position**. For `git push origin main --force`, the subcommand `push` is the first positional arg, but force is the 4th. Matcher must scan all args (after flag bundle expansion) for any_flags hits, not just the first.
- **Compound parsing scope**. We split on `&&`, `||`, `;`, `|`. We do NOT statically evaluate variable assignments mid-line (e.g. `X=foo; rm -rf $X`) — those mark `hasExpr=true` and fall to ask.
- **Bun stdin is async**. Reading stdin in Bun: `await Bun.stdin.text()` or stream. Don't hang waiting for stdin if running `cc-shisa version`.
- **Init is destructive-ish**. `~/.claude/settings.json` modification needs the `.bak` and an idempotency check. Test it on a copy first.
- **Bun `--compile` size**. ~50 MB binary. That's normal. Don't try to slim it with weird tricks.
- **CGO/native deps**. Most npm packages with native bindings will not compile through `bun --compile`. Stay pure JS.

## Where to start (next agent)

If you're picking this up cold:

1. **Install Bun** if missing: `brew install oven-sh/bun/bun` (or `curl -fsSL https://bun.sh/install | bash`).
2. **Read this file fully.** Architecture, class system, file layout, hook protocol, decision log, and pitfalls all live here. There is no separate `docs/` tree.
3. Run `bun install && bun run typecheck && bun test` to confirm Phase 0 still passes on your machine.
4. Pick up at **Phase 1** (parser): `bun add bash-parser`, then implement `src/parser/{walker.ts,normalize.ts,index.ts}` per the architecture diagram. Aim for 18+ unit tests covering compound splits, prefix peeling, expansion flags, and parse errors.
5. Move through Phase 2 → 6 in order. Don't skip ahead — each phase has a "Done when" gate (typecheck + tests green) implied.

When in doubt, ask the user. Do not silently re-interpret design decisions in the "Decision log" section.
