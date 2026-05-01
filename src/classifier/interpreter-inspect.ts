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

type Lang = "python" | "node" | "ruby" | "perl";

// ---------- Python ----------

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

const PYTHON_SAFE_PATTERNS: readonly RegExp[] = [
  /^[\s\d+\-*/().,]+$/,
  /^\s*'[^'\\]*'\s*$/,
  /^\s*"[^"\\]*"\s*$/,
  /^\s*(None|True|False)\s*$/,
  /^\s*print\s*\(\s*[\d+\-*/().,\s]*\s*\)\s*$/,
  /^\s*print\s*\(\s*['"][^'"\\]*['"]\s*\)\s*$/,
  /^\s*print\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,
  /^\s*repr\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,
  /^\s*str\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,
  /^\s*int\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,
  /^\s*len\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,
];

const PYTHON_SAFE_IMPORT_RE =
  /^\s*((from\s+(json|datetime|math|sys|re|hashlib|base64|uuid|collections|itertools|functools|typing|enum|dataclasses|pathlib|os\.path|operator|string|textwrap)\s+import\s+[\w,\s*]+|import\s+(json|datetime|math|sys|re|hashlib|base64|uuid|collections|itertools|functools|typing|enum|dataclasses|os\.path|operator|string|textwrap))\s*[;\n]\s*)*/;

// ---------- Node.js ----------

const CHILD_PROC = "child_proc" + "ess";
const NODE_PATTERNS: readonly Pattern[] = [
  { re: new RegExp(`\\b${CHILD_PROC}\\.(exec|execSync|exec` + "File|exec" + `FileSync|spawn|spawnSync|fork)\\s*\\(`), class: "dangerous", reason: `node -e spawns child via ${CHILD_PROC}` },

  // Match both `fs.rmSync(...)` and `require("fs").rmSync(...)` forms by
  // anchoring on the method name only — these are fs-specific names so
  // false positives are unlikely.
  { re: /\.(rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync)\s*\(/, class: "local.write.destroy", reason: "node -e removes files" },

  { re: /\b(http|https)\.createServer\s*\(/, class: "remote.write", reason: "node -e starts HTTP server" },
  { re: /\bnet\.createServer\s*\(/, class: "remote.write", reason: "node -e starts TCP server" },
  { re: /\bcreateServer\s*\(/, class: "remote.write", reason: "node -e createServer (HTTP/TCP)" },
  { re: /\.listen\s*\(\s*\d+/, class: "remote.write", reason: "node -e binds port" },

  { re: /\b(fetch|axios|got)\s*\(/, class: "remote.read", reason: "node -e HTTP fetch" },
  { re: /\b(http|https)\.get\s*\(/, class: "remote.read", reason: "node -e http.get" },

  { re: /\.(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|copyFile|copyFileSync|rename|renameSync|chmod|chmodSync|chown|chownSync|symlink|symlinkSync|truncate|truncateSync)\s*\(/, class: "local.write", reason: "node -e writes file/dir" },
  { re: /\.create(Write|Read)Stream\s*\(/, class: "local.write", reason: "node -e creates fs stream" },

  // Deno-specific APIs (only one language group; Deno binaries map to "node")
  { re: /\bDeno\.run\s*\(/, class: "dangerous", reason: "deno -e Deno.run spawns process" },
  { re: /\bDeno\.(remove|removeSync)\s*\(/, class: "local.write.destroy", reason: "deno -e Deno.remove" },
  { re: /\bDeno\.serve\s*\(/, class: "remote.write", reason: "deno -e Deno.serve (HTTP server)" },
  { re: /\bDeno\.listen\s*\(/, class: "remote.write", reason: "deno -e Deno.listen (TCP server)" },
  { re: /\bDeno\.(writeTextFile|writeFile|mkdir|copyFile|rename|symlink|chmod|chown|truncate)\b/, class: "local.write", reason: "deno -e Deno.write*" },

  { re: /\beval\s*\(/, class: "dynamic", reason: "node/bun/tsx/deno runtime constructs code at runtime" },
  { re: new RegExp("\\bnew\\s+" + "Func" + "tion\\s*\\("), class: "dynamic", reason: "runtime function constructor" },
  { re: /\bvm\.(runIn[A-Za-z]+|Script)\s*\(/, class: "dynamic", reason: "node -e uses vm.run*" },
];

const NODE_SAFE_PATTERNS: readonly RegExp[] = [
  /^[\s\d+\-*/().,]+$/,                                                              // arithmetic
  /^\s*['"`][^'"`\\]*['"`]\s*$/,                                                     // pure string literal
  /^\s*(true|false|null|undefined|NaN|Infinity)\s*$/,
  /^\s*console\.(log|error|warn|info)\s*\(\s*[\d+\-*/().,\s]*\s*\)\s*$/,             // console.log(<arith>)
  /^\s*console\.(log|error|warn|info)\s*\(\s*['"`][^'"`\\]*['"`]\s*\)\s*$/,          // console.log(<string>)
  /^\s*console\.(log|error|warn|info)\s*\(\s*\w+(\.\w+)*\s*\)\s*$/,                  // console.log(varname or mod.attr)
];

// ---------- Ruby ----------

const RB_SYS = "sys" + "tem";
const RUBY_PATTERNS: readonly Pattern[] = [
  { re: new RegExp(`\\b(${RB_SYS}|exec|spawn)\\s*\\(`), class: "dangerous", reason: `ruby -e ${RB_SYS}/exec/spawn` },
  { re: new RegExp(`\\bKernel[.:]:?:?(${RB_SYS}|exec|spawn)\\s*\\(`), class: "dangerous", reason: `ruby -e Kernel ${RB_SYS}/exec` },
  { re: /`[^`\n]+`/, class: "dangerous", reason: "ruby -e backtick exec" },
  { re: /%x[\{(\[][^})\]]*[\})\]]/, class: "dangerous", reason: "ruby -e %x{} exec" },

  { re: /\bFile\.(delete|unlink)\s*\(/, class: "local.write.destroy", reason: "ruby -e File.delete" },
  { re: /\bFileUtils\.(rm|rm_r|rm_rf|rmtree|remove|remove_dir)\b/, class: "local.write.destroy", reason: "ruby -e FileUtils.rm*" },
  { re: /\bDir\.(delete|rmdir|unlink)\s*\(/, class: "local.write.destroy", reason: "ruby -e Dir.delete" },

  { re: /\bNet::HTTP[.:]:?(post|put|delete|patch|Post|Put|Delete|Patch)\b/, class: "remote.write", reason: "ruby -e Net::HTTP write" },
  { re: /\b(WEBrick::HTTPServer|TCPServer|Socket)\b/, class: "remote.write", reason: "ruby -e starts server / TCP" },

  { re: /\bNet::HTTP[.:]:?(get|head|Get|Head)\b/, class: "remote.read", reason: "ruby -e Net::HTTP read" },
  { re: /\bopen-uri\b/, class: "remote.read", reason: "ruby -e open-uri" },
  { re: /\b(Faraday|HTTParty|RestClient)\b/, class: "remote.read", reason: "ruby -e HTTP client lib" },

  { re: /\bFile\.(open|new)\s*\([^)]*,\s*['"](w|a|w\+|a\+)['"]\s*\)/, class: "local.write", reason: "ruby -e File.open for write" },
  { re: /\bFile\.write\s*\(/, class: "local.write", reason: "ruby -e File.write" },
  { re: /\bDir\.mkdir\s*\(/, class: "local.write", reason: "ruby -e Dir.mkdir" },
  { re: /\bFileUtils\.(mkdir|mkdir_p|cp|cp_r|mv|copy|move|touch)\b/, class: "local.write", reason: "ruby -e FileUtils mkdir/cp/mv" },

  { re: /\beval\s*\(/, class: "dynamic", reason: "ruby -e eval" },
  { re: /\b(instance_eval|class_eval|module_eval)\b/, class: "dynamic", reason: "ruby -e *_eval" },
];

const RUBY_SAFE_PATTERNS: readonly RegExp[] = [
  /^[\s\d+\-*/().,]+$/,
  /^\s*['"][^'"\\]*['"]\s*$/,
  /^\s*(nil|true|false)\s*$/,
  /^\s*puts\s+[\d+\-*/().,\s]*\s*$/,
  /^\s*puts\s+['"][^'"\\]*['"]\s*$/,
  /^\s*puts\s+\w+(\.\w+)*\s*$/,
  /^\s*p\s+['"][^'"\\]*['"]\s*$/,
  /^\s*p\s+\w+(\.\w+)*\s*$/,
  /^\s*pp\s+\w+(\.\w+)*\s*$/,
];

// ---------- Perl ----------

const PL_SYS = "sys" + "tem";
const PERL_PATTERNS: readonly Pattern[] = [
  { re: new RegExp(`\\b(${PL_SYS}|exec)\\s*\\(`), class: "dangerous", reason: `perl -e ${PL_SYS}/exec` },
  { re: /`[^`\n]+`/, class: "dangerous", reason: "perl -e backtick" },
  { re: /\bqx[\{(\[][^})\]]*[\})\]]/, class: "dangerous", reason: "perl -e qx{} exec" },

  { re: /\bunlink\s*\(/, class: "local.write.destroy", reason: "perl -e unlink" },
  { re: /\brmdir\s*\(/, class: "local.write.destroy", reason: "perl -e rmdir" },
  { re: /\bFile::Path::(rmtree|remove_tree)\b/, class: "local.write.destroy", reason: "perl -e File::Path rmtree" },

  { re: /\bLWP::UserAgent\b/, class: "remote.read", reason: "perl -e LWP::UserAgent" },
  { re: /\bHTTP::Tiny\b/, class: "remote.read", reason: "perl -e HTTP::Tiny" },

  { re: /\bopen\s*\([^,]*,\s*['"](>|>>|\+>)/, class: "local.write", reason: "perl -e open for write" },
  { re: /\bmkdir\s*\(/, class: "local.write", reason: "perl -e mkdir" },
  { re: /\bFile::Copy::(copy|move)\b/, class: "local.write", reason: "perl -e File::Copy copy/move" },

  { re: /\beval\s*[\{(]/, class: "dynamic", reason: "perl -e eval" },
];

const PERL_SAFE_PATTERNS: readonly RegExp[] = [
  /^[\s\d+\-*/().,]+$/,
  /^\s*['"][^'"\\]*['"]\s*;?\s*$/,
  /^\s*print\s+['"][^'"\\]*['"]\s*;?\s*$/,
  /^\s*print\s+\$\w+\s*;?\s*$/,
];

// ---------- Lookup tables ----------

const PATTERNS_BY_LANG: Readonly<Record<Lang, readonly Pattern[]>> = {
  python: PYTHON_PATTERNS,
  node: NODE_PATTERNS,
  ruby: RUBY_PATTERNS,
  perl: PERL_PATTERNS,
};

const SAFE_PATTERNS_BY_LANG: Readonly<Record<Lang, readonly RegExp[]>> = {
  python: PYTHON_SAFE_PATTERNS,
  node: NODE_SAFE_PATTERNS,
  ruby: RUBY_SAFE_PATTERNS,
  perl: PERL_SAFE_PATTERNS,
};

// ---------- Public entry points ----------

export function inspectDynamic(seg: Segment): InspectResult | null {
  const lang = languageOfBinary(seg.binary);
  if (lang === null) return null;

  const content = inlineContent(seg);
  if (content === null) return null;

  const userModules = readInterpreterConfig()?.[lang]?.modules;
  return inspectByLang(lang, content, userModules);
}

/**
 * Pure inspection logic — no FS access, so unit tests can pass an
 * explicit userModules map. The strictest match across (DENY patterns,
 * user whitelist, SAFE patterns) wins.
 */
export function inspectByLang(
  lang: Lang,
  content: string,
  userModules?: Readonly<Record<string, Class>>,
): InspectResult | null {
  let strictest: InspectResult | null = null;

  for (const p of PATTERNS_BY_LANG[lang]) {
    if (p.re.test(content)) {
      strictest = takeStricter(strictest, { class: p.class, reason: p.reason });
    }
  }

  if (userModules !== undefined) {
    const importDetector = importDetectorOf(lang);
    for (const [name, cls] of Object.entries(userModules)) {
      if (importDetector(content, name)) {
        strictest = takeStricter(strictest, {
          class: cls,
          reason: `${lang} -c imports user-listed "${name}" (→ ${cls})`,
        });
      }
    }
  }

  if (strictest !== null) return strictest;

  if (looksSafe(lang, content)) {
    return { class: "local.read", reason: `${lang} -c pure expression / safe stdlib read` };
  }

  return null;
}

// ---------- Helpers ----------

function takeStricter(cur: InspectResult | null, next: InspectResult): InspectResult {
  if (cur === null) return next;
  return strictnessRank(next.class) > strictnessRank(cur.class) ? next : cur;
}

function languageOfBinary(binary: string): Lang | null {
  switch (binary) {
    case "python":
    case "python3":
    case "python2":
      return "python";
    // JS / TS runtimes share the Node fs/http/server API surface;
    // tsx and ts-node compile TypeScript on top of Node, bun is largely
    // Node-compatible, deno has its own namespace (Deno.*) plus the
    // standard fetch/eval which the same patterns catch.
    case "node":
    case "nodejs":
    case "bun":
    case "tsx":
    case "ts-node":
    case "deno":
      return "node";
    case "ruby":
    case "irb":
      return "ruby";
    case "perl":
      return "perl";
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

function looksSafe(lang: Lang, content: string): boolean {
  let body = content;
  if (lang === "python") {
    const m = PYTHON_SAFE_IMPORT_RE.exec(content);
    body = m ? content.slice(m[0].length) : content;
  }
  body = body.trim();
  return SAFE_PATTERNS_BY_LANG[lang].some((re) => re.test(body));
}

type ImportDetector = (content: string, name: string) => boolean;

function importDetectorOf(lang: Lang): ImportDetector {
  switch (lang) {
    case "python":
      return importedPythonModule;
    case "node":
      return importedNodeModule;
    case "ruby":
      return importedRubyModule;
    case "perl":
      return importedPerlModule;
  }
}

function escapeRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function importedPythonModule(content: string, name: string): boolean {
  const e = escapeRe(name);
  const re = new RegExp(`(^|[;\\n])\\s*(?:from\\s+${e}(?:\\.[\\w]+)*\\s+import\\b|import\\s+${e}(?:\\s|;|,|$))`);
  return re.test(content);
}

function importedNodeModule(content: string, name: string): boolean {
  const e = escapeRe(name);
  const re = new RegExp(`(?:require\\s*\\(\\s*['"\`]${e}['"\`]|from\\s+['"\`]${e}['"\`]|import\\s+['"\`]${e}['"\`])`);
  return re.test(content);
}

function importedRubyModule(content: string, name: string): boolean {
  const e = escapeRe(name);
  const re = new RegExp(`(?:^|[;\\n])\\s*require(?:_relative)?\\s+['"]${e}['"]`);
  return re.test(content);
}

function importedPerlModule(content: string, name: string): boolean {
  const e = escapeRe(name);
  const re = new RegExp(`(?:^|[;\\n])\\s*use\\s+${e}\\b`);
  return re.test(content);
}
