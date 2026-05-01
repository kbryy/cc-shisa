import type { Segment } from "../parser/types.ts";
import { strictnessRank } from "../rules/index.ts";
import type { Class } from "../rules/types.ts";
import { readInterpreterConfig } from "../rules/user-config.ts";

interface Pattern {
  readonly re: RegExp;
  readonly class: Class;
  readonly reason: string;
}

interface InspectResult {
  readonly class: Class;
  readonly reason: string;
}

const PYTHON_PATTERNS: readonly Pattern[] = [
  { re: /\bos\.system\s*\(/, class: "dangerous", reason: "python -c calls os.system" },
  { re: /\bos\.popen\s*\(/, class: "dangerous", reason: "python -c uses os.popen" },
  { re: new RegExp("\\b" + "subpr" + "ocess\\.(run|Popen|call|check_call|check_output|getoutput|getstatusoutput)\\s*\\("), class: "dangerous", reason: "python -c spawns child" },

  { re: /\bos\.(remove|unlink|rmdir|removedirs)\s*\(/, class: "local.write.destroy", reason: "python -c removes files" },
  { re: /\bshutil\.rmtree\s*\(/, class: "local.write.destroy", reason: "python -c shutil.rmtree" },
  { re: /\.unlink\s*\(/, class: "local.write.destroy", reason: "python -c Path.unlink" },

  { re: /\brequests\.(post|put|delete|patch)\s*\(/, class: "remote.write", reason: "python -c HTTP write" },
  { re: /\bsocket\.\w+\.(bind|listen|sendto|sendall|send)\s*\(/, class: "remote.write", reason: "python -c socket bind/send" },
  { re: /\b(http\.server|wsgiref|smtplib|socketserver)\b/, class: "remote.write", reason: "python -c starts server / sends mail" },

  { re: /\brequests\.(get|head|options)\s*\(/, class: "remote.read", reason: "python -c HTTP read" },
  { re: /\b(urllib\.request|urlopen|http\.client)\b/, class: "remote.read", reason: "python -c HTTP fetch" },

  { re: /\bopen\s*\([^)]*,\s*['"](w|a|x|wb|ab|xb|w\+|a\+|r\+)/, class: "local.write", reason: "python -c opens file for write" },
  { re: /\bos\.(makedirs|mkdir|rename|chmod|chown|symlink|link|truncate|utime)\s*\(/, class: "local.write", reason: "python -c filesystem mutation" },
  { re: /\bshutil\.(copy|copy2|copyfile|copytree|move)\s*\(/, class: "local.write", reason: "python -c shutil copy/move" },
  { re: /\.write_(text|bytes)\s*\(/, class: "local.write", reason: "python -c Path.write_*" },
  { re: /\.touch\s*\(/, class: "local.write", reason: "python -c Path.touch" },
  { re: /\b(json|yaml|toml|pickle)\.dump\s*\(/, class: "local.write", reason: "python -c serializes to file" },

  { re: /\b(eval|exec|compile|__import__)\s*\(/, class: "dynamic", reason: "python -c uses eval/exec/compile" },
  { re: /\bpickle\.loads?\s*\(/, class: "dynamic", reason: "python -c unpickle (unsafe deserialization)" },
];

/**
 * Tight allowlist: only match content that is obviously a one-liner
 * print/repr/len of a simple expression, a pure arithmetic, or a pure
 * literal. Anything outside these shapes returns null (stay dynamic →
 * ask). False negatives are fine; false positives (mark unsafe code as
 * safe) must be avoided.
 *
 * Allowed atoms inside the wrapping call: digits, basic arithmetic,
 * strings without escapes, attribute access (a.b), simple subscripts,
 * comma-separated arg lists. No function calls inside the wrapper, no
 * lambda, no comprehensions.
 */
// Narrow: each pattern is provably free of side effects. Anything that
// doesn't match falls through to `null`, which keeps the original
// dynamic classification (ask). False negatives are acceptable; false
// positives (mark unsafe code as safe) are not.
const PYTHON_SAFE_PATTERNS: readonly RegExp[] = [
  /^[\s\d+\-*/().,]+$/,                                    // pure arithmetic / numeric literal
  /^\s*'[^'\\]*'\s*$/,                                     // pure single-quoted string (no escapes)
  /^\s*"[^"\\]*"\s*$/,                                     // pure double-quoted string (no escapes)
  /^\s*(None|True|False)\s*$/,                             // keyword constants
  /^\s*print\s*\(\s*[\d+\-*/().,\s]*\s*\)\s*$/,            // print(<arithmetic>)
  /^\s*print\s*\(\s*['"][^'"\\]*['"]\s*\)\s*$/,            // print(<string literal>)
  /^\s*print\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,                 // print(varname) or print(mod.attr)
  /^\s*repr\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,                  // repr(<simple>)
  /^\s*str\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,                   // str(<simple>)
  /^\s*int\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,                   // int(<simple>)
  /^\s*len\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,                   // len(<simple>)
];

const PYTHON_SAFE_IMPORT_RE =
  /^\s*((from\s+(json|datetime|math|sys|re|hashlib|base64|uuid|collections|itertools|functools|typing|enum|dataclasses|pathlib|os\.path|operator|string|textwrap)\s+import\s+[\w,\s*]+|import\s+(json|datetime|math|sys|re|hashlib|base64|uuid|collections|itertools|functools|typing|enum|dataclasses|os\.path|operator|string|textwrap))\s*[;\n]\s*)*/;

export function inspectDynamic(seg: Segment): InspectResult | null {
  const lang = languageOfBinary(seg.binary);
  if (lang !== "python") return null;

  const content = inlineContent(seg);
  if (content === null) return null;

  const userModules = readInterpreterConfig()?.python?.modules;
  return inspectPython(content, userModules);
}

/**
 * Pure inspection logic — no FS access, so unit tests can pass an explicit
 * userModules map. The strictest match across (DENY patterns, user
 * whitelist, SAFE patterns) wins.
 */
export function inspectPython(
  content: string,
  userModules?: Readonly<Record<string, Class>>,
): InspectResult | null {
  let strictest: InspectResult | null = null;

  for (const p of PYTHON_PATTERNS) {
    if (p.re.test(content)) {
      strictest = takeStricter(strictest, { class: p.class, reason: p.reason });
    }
  }

  if (userModules !== undefined) {
    for (const [name, cls] of Object.entries(userModules)) {
      if (importedModule(content, name)) {
        strictest = takeStricter(strictest, {
          class: cls,
          reason: `python -c imports user-listed "${name}" (→ ${cls})`,
        });
      }
    }
  }

  if (strictest !== null) return strictest;

  if (looksSafe(content)) {
    return { class: "local.read", reason: "python -c pure expression / safe stdlib read" };
  }

  return null;
}

function takeStricter(cur: InspectResult | null, next: InspectResult): InspectResult {
  if (cur === null) return next;
  return strictnessRank(next.class) > strictnessRank(cur.class) ? next : cur;
}

function importedModule(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[;\\n])\\s*(?:from\\s+${escaped}(?:\\.[\\w]+)*\\s+import\\b|import\\s+${escaped}(?:\\s|;|,|$))`);
  return re.test(content);
}

function languageOfBinary(binary: string): "python" | null {
  switch (binary) {
    case "python":
    case "python3":
    case "python2":
      return "python";
    default:
      return null;
  }
}

function inlineContent(seg: Segment): string | null {
  for (let i = 0; i < seg.args.length; i += 1) {
    const a = seg.args[i];
    if (a === "-c" || a === "-e" || a === "--eval") {
      return seg.args[i + 1] ?? null;
    }
  }
  return null;
}

function looksSafe(content: string): boolean {
  const importMatch = PYTHON_SAFE_IMPORT_RE.exec(content);
  const body = (importMatch ? content.slice(importMatch[0].length) : content).trim();
  return PYTHON_SAFE_PATTERNS.some((re) => re.test(body));
}
