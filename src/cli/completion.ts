type Shell = "bash" | "zsh" | "fish";

const SHELLS: ReadonlySet<Shell> = new Set(["bash", "zsh", "fish"]);

export function runCompletion(args: readonly string[]): number {
  const shell = args[0];
  if (shell === undefined) {
    process.stderr.write("usage: cc-shisa completion <bash|zsh|fish>\n");
    return 2;
  }
  if (!SHELLS.has(shell as Shell)) {
    process.stderr.write(`cc-shisa completion: unsupported shell "${shell}". Choose one of: bash, zsh, fish\n`);
    return 2;
  }
  switch (shell as Shell) {
    case "bash":
      process.stdout.write(BASH_SCRIPT);
      return 0;
    case "zsh":
      process.stdout.write(ZSH_SCRIPT);
      return 0;
    case "fish":
      process.stdout.write(FISH_SCRIPT);
      return 0;
  }
}

const TOP_COMMANDS = "hook check test init modules level here locations logs completion version help";
const MODULES_SUB = "list enable disable pick";
const LEVEL_SUB = "get set list";
const HERE_SUB = "set-level set-override clear-override unset";
const LOCATIONS_SUB = "list unset";
const LOGS_SUB = "summary tail path";
const COMPLETION_SUB = "bash zsh fish";
const LEVEL_NAMES = "strict safe loose";
const ACTIONS = "allow ask deny";
const CLASSES =
  "dangerous dynamic unknown local.read local.write local.write.destroy remote.read remote.write remote.write.destroy";

const BASH_SCRIPT = `# cc-shisa bash completion
# Source the output of \`cc-shisa completion bash\` from your shell rc, e.g.:
#   eval "$(cc-shisa completion bash)"

_cc_shisa() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"

  case \${COMP_CWORD} in
    1)
      COMPREPLY=( $(compgen -W "${TOP_COMMANDS}" -- "$cur") )
      return
      ;;
    2)
      case \${COMP_WORDS[1]} in
        modules)    COMPREPLY=( $(compgen -W "${MODULES_SUB}" -- "$cur") ) ;;
        level)      COMPREPLY=( $(compgen -W "${LEVEL_SUB}" -- "$cur") ) ;;
        here)       COMPREPLY=( $(compgen -W "${HERE_SUB}" -- "$cur") ) ;;
        locations)  COMPREPLY=( $(compgen -W "${LOCATIONS_SUB}" -- "$cur") ) ;;
        logs)       COMPREPLY=( $(compgen -W "${LOGS_SUB}" -- "$cur") ) ;;
        completion) COMPREPLY=( $(compgen -W "${COMPLETION_SUB}" -- "$cur") ) ;;
      esac
      return
      ;;
    3)
      local pair="\${COMP_WORDS[1]} \${COMP_WORDS[2]}"
      case "$pair" in
        "modules enable"|"modules disable")
          local mods
          mods=$(cc-shisa modules list 2>/dev/null | awk 'NR>1 {print $1}')
          COMPREPLY=( $(compgen -W "$mods" -- "$cur") )
          ;;
        "level set"|"here set-level")
          COMPREPLY=( $(compgen -W "${LEVEL_NAMES}" -- "$cur") )
          ;;
        "here set-override"|"here clear-override")
          COMPREPLY=( $(compgen -W "${CLASSES}" -- "$cur") )
          ;;
        "locations unset")
          COMPREPLY=( $(compgen -d -- "$cur") )
          ;;
        "logs tail")
          COMPREPLY=( $(compgen -W "-n" -- "$cur") )
          ;;
      esac
      return
      ;;
    4)
      local pair="\${COMP_WORDS[1]} \${COMP_WORDS[2]}"
      case "$pair" in
        "here set-override")
          COMPREPLY=( $(compgen -W "${ACTIONS}" -- "$cur") )
          ;;
      esac
      return
      ;;
  esac
}
complete -F _cc_shisa cc-shisa
`;

const ZSH_SCRIPT = `#compdef cc-shisa
# cc-shisa zsh completion
# Source via:  eval "$(cc-shisa completion zsh)"
# or save to a directory in $fpath as _cc-shisa.

_cc_shisa() {
  local -a top_commands modules_sub level_sub here_sub locations_sub logs_sub completion_sub
  local -a level_names actions classes

  top_commands=(${TOP_COMMANDS
    .split(" ")
    .map((w) => `"${w}"`)
    .join(" ")})
  modules_sub=(${MODULES_SUB.split(" ").map((w) => `"${w}"`).join(" ")})
  level_sub=(${LEVEL_SUB.split(" ").map((w) => `"${w}"`).join(" ")})
  here_sub=(${HERE_SUB.split(" ").map((w) => `"${w}"`).join(" ")})
  locations_sub=(${LOCATIONS_SUB.split(" ").map((w) => `"${w}"`).join(" ")})
  logs_sub=(${LOGS_SUB.split(" ").map((w) => `"${w}"`).join(" ")})
  completion_sub=(${COMPLETION_SUB.split(" ").map((w) => `"${w}"`).join(" ")})
  level_names=(${LEVEL_NAMES.split(" ").map((w) => `"${w}"`).join(" ")})
  actions=(${ACTIONS.split(" ").map((w) => `"${w}"`).join(" ")})
  classes=(${CLASSES.split(" ").map((w) => `"${w}"`).join(" ")})

  if (( CURRENT == 2 )); then
    _describe 'cc-shisa command' top_commands
    return
  fi

  case "$words[2]" in
    modules)
      if (( CURRENT == 3 )); then
        _describe 'modules subcommand' modules_sub
      elif (( CURRENT >= 4 )) && [[ "$words[3]" == (enable|disable) ]]; then
        local -a mods
        mods=(\${(f)"$(cc-shisa modules list 2>/dev/null | awk 'NR>1 {print $1}')"})
        _describe 'module' mods
      fi
      ;;
    level)
      if (( CURRENT == 3 )); then
        _describe 'level subcommand' level_sub
      elif (( CURRENT == 4 )) && [[ "$words[3]" == set ]]; then
        _describe 'level' level_names
      fi
      ;;
    here)
      if (( CURRENT == 3 )); then
        _describe 'here subcommand' here_sub
      elif (( CURRENT == 4 )); then
        case "$words[3]" in
          set-level)                 _describe 'level' level_names ;;
          set-override|clear-override) _describe 'class' classes ;;
        esac
      elif (( CURRENT == 5 )) && [[ "$words[3]" == set-override ]]; then
        _describe 'action' actions
      fi
      ;;
    locations)
      if (( CURRENT == 3 )); then
        _describe 'locations subcommand' locations_sub
      elif (( CURRENT == 4 )) && [[ "$words[3]" == unset ]]; then
        _path_files -/
      fi
      ;;
    logs)
      if (( CURRENT == 3 )); then
        _describe 'logs subcommand' logs_sub
      fi
      ;;
    completion)
      if (( CURRENT == 3 )); then
        _describe 'shell' completion_sub
      fi
      ;;
  esac
}

compdef _cc_shisa cc-shisa
`;

const FISH_SCRIPT = `# cc-shisa fish completion
# Source via:  cc-shisa completion fish | source
# or save to ~/.config/fish/completions/cc-shisa.fish

function __cc_shisa_n
    set -l cmd (commandline -opc)
    test (count $cmd) -eq $argv[1]
end

function __cc_shisa_word_at
    set -l cmd (commandline -opc)
    if test (count $cmd) -ge $argv[1]
        echo $cmd[$argv[1]]
    end
end

# Top-level subcommands
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'hook'        -d 'Run as PreToolUse hook'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'check'       -d 'Evaluate a command and print the decision'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'test'        -d 'Run testdata cases end-to-end'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'init'        -d 'Register hook in ~/.claude/settings.json'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'modules'     -d 'Manage modules'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'level'       -d 'Manage security level'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'here'        -d 'Per-directory profile for cwd'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'locations'   -d 'Manage location entries'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'logs'        -d 'Inspect the JSONL decision log'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'completion'  -d 'Print shell completion script'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'version'     -d 'Print version'
complete -c cc-shisa -n '__cc_shisa_n 1' -a 'help'        -d 'Print help'

# Second-level subcommands
complete -c cc-shisa -n '__cc_shisa_n 2; and test (__cc_shisa_word_at 2) = modules'    -a 'list enable disable pick'
complete -c cc-shisa -n '__cc_shisa_n 2; and test (__cc_shisa_word_at 2) = level'      -a 'get set list'
complete -c cc-shisa -n '__cc_shisa_n 2; and test (__cc_shisa_word_at 2) = here'       -a 'set-level set-override clear-override unset'
complete -c cc-shisa -n '__cc_shisa_n 2; and test (__cc_shisa_word_at 2) = locations'  -a 'list unset'
complete -c cc-shisa -n '__cc_shisa_n 2; and test (__cc_shisa_word_at 2) = logs'       -a 'summary tail path'
complete -c cc-shisa -n '__cc_shisa_n 2; and test (__cc_shisa_word_at 2) = completion' -a 'bash zsh fish'

# Third-level — module names
complete -c cc-shisa \\
  -n '__cc_shisa_n 3; and test (__cc_shisa_word_at 2) = modules; and contains (__cc_shisa_word_at 3) enable disable' \\
  -a '(cc-shisa modules list 2>/dev/null | awk "NR>1 {print \\\$1}")'

# Third-level — level names
complete -c cc-shisa -n '__cc_shisa_n 3; and test (__cc_shisa_word_at 2) = level; and test (__cc_shisa_word_at 3) = set' -a 'strict safe loose'
complete -c cc-shisa -n '__cc_shisa_n 3; and test (__cc_shisa_word_at 2) = here;  and test (__cc_shisa_word_at 3) = set-level' -a 'strict safe loose'

# Third-level — class names
complete -c cc-shisa \\
  -n '__cc_shisa_n 3; and test (__cc_shisa_word_at 2) = here; and contains (__cc_shisa_word_at 3) set-override clear-override' \\
  -a 'dangerous dynamic unknown local.read local.write local.write.destroy remote.read remote.write remote.write.destroy'

# Fourth-level — actions for here set-override
complete -c cc-shisa \\
  -n '__cc_shisa_n 4; and test (__cc_shisa_word_at 2) = here; and test (__cc_shisa_word_at 3) = set-override' \\
  -a 'allow ask deny'
`;
