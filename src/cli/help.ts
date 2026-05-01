export function printHelp(): void {
  console.log(`cc-shisa — static analysis hook for Claude Code Bash tool

Usage:
  cc-shisa hook                       Read PreToolUse JSON from stdin, write decision to stdout
  cc-shisa check '<command>'          Evaluate a command and print the decision
  cc-shisa test [path]                Run testdata cases end-to-end
  cc-shisa init                       Register hook in ~/.claude/settings.json
  cc-shisa modules                    Interactive picker (TTY) / falls back to list (non-TTY)
  cc-shisa modules list               List built-in and user modules with on/off status
  cc-shisa modules enable <name>...   Add modules to ~/.config/cc-shisa/profile.json
  cc-shisa modules disable <name>...  Remove modules from ~/.config/cc-shisa/profile.json
  cc-shisa modules pick               Interactive multi-select (same as bare 'modules' on TTY)
  cc-shisa level [get]                Show the active security level and its class→action mapping
  cc-shisa level list                 Show all built-in levels (strict / safe / loose)
  cc-shisa level set <strict|safe|loose>  Switch the active level in ~/.config/cc-shisa/profile.json
  cc-shisa here                       Show the effective profile for the current directory
  cc-shisa here set-level <name>      Register the current directory with a per-location level
  cc-shisa here set-override <class> <action>   Per-location class override
  cc-shisa here clear-override <class>          Clear a per-location class override
  cc-shisa here unset                 Remove the current directory's location entry
  cc-shisa locations list             List all per-location entries
  cc-shisa locations unset <path>     Remove a specific location entry
  cc-shisa logs [summary]             Aggregate the JSONL decision log
  cc-shisa logs tail [-n N]           Show the last N entries (default 20)
  cc-shisa logs path                  Print the log file path
  cc-shisa completion <bash|zsh|fish> Print a shell completion script (eval to enable tab completion)
  cc-shisa version                    Print version

Environment:
  CC_SHISA_SHADOW=1                   Force allow on every decision and log to ~/.local/state/cc-shisa/decisions.jsonl
  CC_SHISA_LOG=1                      Keep enforcement intact and log every decision (audit trail)
  CC_SHISA_DEBUG=1                    Print debug info to stderr
  CC_SHISA_PARSER=bash-parser|tree-sitter   Select parser backend (default: bash-parser)
  XDG_CONFIG_HOME=<path>              Override the user config root (default: ~/.config)`);
}
