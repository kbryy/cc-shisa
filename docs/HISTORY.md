# cc-shisa — Decision History

The story of how cc-shisa got to its current shape. Read this once and you
won't have to re-debate decisions that are already settled.

## Why cc-shisa exists

The user runs Claude Code regularly and the bash permission prompt situation
became untenable. Two failed approaches:

1. **Hand-curating `permissions.allow`**: 7 patterns added (mostly MCP tools,
   pnpm typecheck/lint, screenshot tools). Doesn't scale: every new tool
   needs a manual addition; compound commands like
   `pnpm typecheck && pnpm build` defeat patterns; the list grows endlessly.

2. **Denylist approach**: enumerate dangerous patterns (`rm -rf /`, force
   push, etc.). This has infinite holes — any new CLI tool, any obfuscation
   technique, any indirection through `eval`/`bash -c`/variable expansion
   breaks the protection.

The conclusion: **denylist patterns are fundamentally insufficient. The only
serious answer is static analysis of the actual command structure**.

## Why static analysis specifically

We considered:

- **LLM judge** (similar to Claude Code's Auto Mode): adds latency, cost,
  non-determinism, and is vulnerable to prompt injection through command
  comments. Black-box decisions are hard to debug.

- **OS sandboxing** (sandbox-exec, devcontainer): structural protection but
  high friction; doesn't address "let safe commands flow without prompts".

- **Static AST analysis** (this approach): deterministic, fast, auditable,
  not fooled by command-text injection, decisions are explainable. Limits:
  can't analyze runtime values (variable expansions) — but those default to
  `ask` (fail-safe).

Static analysis won. The classifier produces structural facts (binary, args,
flags, paths); rules consume those facts to produce a Class; policy maps
Class to Action. Every step is pure and inspectable.

## Why we considered then rejected existing OSS

We looked at:

| Project | Stars | Verdict |
|---|---|---|
| `microsoft/agent-governance-toolkit` | 1334 | Heavyweight, OPA/Rego/Cedar, not Claude Code-specific. Right tool for enterprise. Wrong tool for personal hook. |
| `banyudu/claude-warden` | 23 | TypeScript, single dev, AST-based — closest match. Considered forking. User chose to build from scratch for full ownership. |
| `oryband/claude-code-auto-approve` | 15 | Shell + shfmt + jq, 23 KB, stale since March. Smallest comparison. |
| `RoaringFerrum/claude-code-bash-guardian` | 6 | Python, single dev, abandoned-ish. |
| `AbdelrahmanHafez/claude-code-plus` | 22 | Shell, 850+ pre-set permissions. Stale. |

Trust assessment: **all are single-developer projects with low adoption**.
For a security tool that decides whether `rm -rf` runs, single-developer
trust is uncomfortable. The user chose to build from scratch with these
priorities:

- **No npm sub-deep deps**: keep the supply chain shallow.
- **All code in one head**: small enough to audit personally.
- **Pin everything**: no auto-updates from upstream.
- **Use battle-tested components for the parts that need it** (the bash
  parser is the only "borrowed" piece).

This balance — borrow the AST parser, write everything else — is the
guiding principle.

## Why TypeScript (and the false start in Go)

Initial decision: **Go** with `mvdan.cc/sh/v3/syntax`. Rationale at the time:
- Fastest cold start (<10 ms).
- Single binary trivially via `go build`.
- shfmt-grade parser as a Go library, no subprocess.
- `goreleaser` for distribution.

Phase 0 + Phase 1 actually happened in Go: parser layer was implemented with
18 passing tests. Then the user pivoted to TypeScript because:
- Faster development for the user (their primary language).
- Easier contribution if it goes public.
- Bun's `--compile` covers the single-binary requirement.
- `bash-parser` (npm) is good enough for MVP.

Cost of the pivot: throw away ~600 lines of working Go. The parser
architecture and prefix-stripping logic translate directly, so the loss is
mostly mechanical retyping. The lessons learned (e.g. timeout's positional
arg consumption being a footgun) are documented in `docs/IMPLEMENTATION.md`.

The Go decision is **not** to be revisited. We've committed to TypeScript.

## Why Bun (and not Node)

Bun startup is 10–30 ms. Node startup is 50–150 ms. The hook fires on every
Bash command Claude Code runs — for an active session that's hundreds of
invocations. Going from 30 ms to 100 ms per call is the difference between
"invisible" and "annoying".

Plus `bun build --compile` produces a self-contained binary, removing the
"users need to `npm install -g`" friction. Node's `pkg` is similar but
Bun's is more mature for this use case in 2026.

Deno was considered (similar to Bun). Bun won on raw startup speed and
ecosystem (Bun.spawn, built-in test runner) being slightly more useful here.

## Why JSON (and not TOML/YAML)

Settled at `JSON`. Reasons:
- Standard library JSON in every language, zero deps.
- Mirrors Claude Code's hook IO format — same lexicon throughout.
- `jq` works for inspection.
- The "no comments" downside is offset by **mandating a `reason` field on
  every Rule**: it serves as both human documentation and end-user
  explanation when the hook denies/asks.

TOML was the runner-up (better human ergonomics) but adds a parser dep.
YAML was rejected (parser deps, gotchas like the Norway problem).

## Naming saga

The user went through a bunch of candidates:

- **claude-warden**: existing project, can't reuse name.
- **bash-guard**: too generic, conflicts with `RoaringFerrum/claude-code-bash-guardian`.
- **komainu (狛犬)**: cute, guardian-dog vibe. Initial pick. Later rejected:
  emphasizes "guard" but cc-shisa's main value is _allow safe commands
  automatically_, not _guard_. The "passive guard" connotation undersold the
  feature.
- **banken (番犬)**: literally "watchdog". Same issue as komainu plus a
  collision with `kyuden/banken` — a Ruby authorization library (269 stars).
  Adjacent in concept space (auth), would create confusion.
- **karakuri (からくり)**: clever Japanese automaton. Captured "smart
  automatic" but stretched the metaphor.
- **mimamori (見守り)**: Japanese concept of "watchful caring". Excellent
  semantic fit but obscure to non-Japanese audiences.
- **hachi / akita (柴/秋田)**: loyal Japanese dogs. Good vibe, less
  conceptually tight.
- **sekisho (関所)**: Edo-period checkpoint. Best functional fit (literal
  inspection of travelers/commands). Less iconic shape for branding.

**Settled: shisa (シーサー)** — Okinawan guardian lion-dogs, placed in
**pairs** at gates with one mouth open (welcoming good fortune in) and one
closed (warding off evil). The dual aspect maps perfectly:

- 阿 (open mouth) = `allow` (safe commands flow in)
- 吽 (closed mouth) = `deny` / `ask` (dangerous commands stopped)

It's the only Japanese guardian symbol whose iconography directly encodes
the dual-action behavior we wanted. There is also a coincidentally-relevant
`shisa-ai/shisad` project ("Security-first AI agent daemon — the model
proposes actions, the runtime decides what execute") at 19 stars; we use
`cc-shisa` to namespace clearly under Claude Code.

## Project naming pattern: `cc-`

Surveyed the Claude Code OSS ecosystem; saw:

- `claude-code-*`: most canonical, longest.
- `claude-*`: medium length, sometimes ambiguous with `claude.ai`.
- `cc-*`: gaining traction, especially after `cc-switch` (55K stars).
- `cchooks` (no dash): the de-facto Python SDK uses this.
- No prefix: requires SEO via description.

Settled: `cc-` prefix for Claude-Code-specific tools. Project name
`cc-shisa`. If we ever do other Claude Code tools, `cc-` + thematic name is
the convention.

## Repo: private for now

Created as private. Will go public when v0.1.0 ships and the user has used
shadow mode for a week.

License: MIT. Standard, no surprises.

## Why this repo, not a subdirectory of `kbryy/claude-config`

Briefly considered putting cc-shisa inside the user's `claude-config` repo.
Rejected because:
- cc-shisa might go public; `claude-config` is personal.
- Independent versioning matters (cc-shisa releases vs. config tweaks).
- Homebrew tap distribution wants a clean repo with releases.

`claude-config` may eventually depend on (or document) cc-shisa, but they
stay separate.

## Decisions that are NOT yet made

These remain open for the implementing agent / user:

- **Shadow mode default on first install?** Probably yes (safer rollout) but
  we haven't committed. Init might prompt the user, or just print a
  recommendation to set `CC_SHISA_SHADOW=1` for the first week.
- **Public release timing**. v0.1.0 might stay private until the user has
  used it personally for a couple weeks.
- **Whether to invest in tree-sitter-bash via WASM later**, if `bash-parser`
  proves inaccurate. Don't preempt this — measure with redteam tests first.

## What was rejected and shouldn't come back

- ❌ Per-command exact allowlists (`Bash(pnpm typecheck *)`) as the primary
  mechanism. We tried it; it doesn't scale. cc-shisa replaces this.
- ❌ Manual denylist as the only protection.
- ❌ Native dependencies (anything requiring CGo / node-gyp / similar).
- ❌ Subprocess-spawning to call shfmt/tree-sitter/etc. — runtime overhead
  per-hook is unacceptable.
- ❌ A daemon mode in MVP. Maybe later if profiling demands it.
- ❌ LLM judge calls in MVP. Maybe later as a fallback for `unknown`.

## TL;DR for the next agent

cc-shisa is a TypeScript+Bun static-analysis hook for Claude Code's Bash
tool. It parses commands with `bash-parser`, classifies segments via JSON
rules into severity classes, maps classes to allow/ask/deny actions, and
returns a decision. It runs as a `PreToolUse` hook, distributes via
Homebrew, and rolls out via a shadow mode that observes for a week before
enforcing. Read `CLAUDE.md` and `docs/DESIGN.md` for the actual mechanics.
