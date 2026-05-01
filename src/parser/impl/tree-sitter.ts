import { Parser, Language, type Node as SyntaxNode } from "web-tree-sitter";

import { peelPrefixes, type ResolvedToken } from "../normalize.ts";
import type { ParseResult, Segment, ShellParser } from "../types.ts";

import bashWasmPath from "./tree-sitter-bash.wasm" with { type: "file" };
import runtimeWasmPath from "./web-tree-sitter-runtime.wasm" with { type: "file" };

let initialized: { parser: Parser } | null = null;

async function init(): Promise<{ parser: Parser }> {
  if (initialized !== null) return initialized;
  // web-tree-sitter loads its own runtime WASM via locateFile(); under
  // `bun build --compile` the wasm has to be made available at the embedded
  // file path, which we get from the `with { type: "file" }` import above.
  await Parser.init({
    locateFile: (name: string) => {
      if (name === "web-tree-sitter.wasm" || name === "tree-sitter.wasm") {
        return runtimeWasmPath;
      }
      return name;
    },
  });
  const lang = await Language.load(bashWasmPath);
  const p = new Parser();
  p.setLanguage(lang);
  initialized = { parser: p };
  return initialized;
}

/**
 * Construct the tree-sitter backend. Async because grammar WASM must be
 * loaded once before any parse. Subsequent calls are sync.
 */
export async function createTreeSitterBackend(): Promise<ShellParser> {
  const { parser } = await init();
  return {
    name: "tree-sitter",
    parse(command: string): ParseResult {
      if (command.trim() === "") return { original: command, segments: [] };

      let tree;
      try {
        tree = parser.parse(command);
      } catch (err) {
        return {
          original: command,
          segments: [],
          parseErr: err instanceof Error ? err : new Error(String(err)),
        };
      }
      if (!tree) {
        return {
          original: command,
          segments: [],
          parseErr: new Error("tree-sitter returned null tree"),
        };
      }
      // tree-sitter does graceful error recovery (ERROR nodes inline) rather
      // than throwing. For parity with bash-parser, surface that as parseErr
      // so the recovery layer / fail-safe ask still triggers.
      if (tree.rootNode.hasError) {
        return {
          original: command,
          segments: [],
          parseErr: new Error("tree-sitter parse contained ERROR nodes"),
        };
      }
      const segments = walkRoot(tree.rootNode);
      return { original: command, segments };
    },
  };
}

interface WalkContext {
  fromSubsh: boolean;
}

function walkRoot(root: SyntaxNode): Segment[] {
  return walkNode(root, { fromSubsh: false });
}

const RECURSIVE_TYPES = new Set([
  "program",
  "list",
  "pipeline",
  "compound_statement",
  "redirected_statement",
  "subshell",
  "if_statement",
  "while_statement",
  "until_statement",
  "for_statement",
  "case_statement",
  "function_definition",
  "negated_command",
  "elif_clause",
  "else_clause",
  "do_group",
  "case_item",
]);

function walkNode(node: SyntaxNode, ctx: WalkContext): Segment[] {
  if (node.type === "command") {
    return extractCommand(node, ctx, false);
  }
  // tree-sitter wraps a command in `redirected_statement` whenever a redirect
  // (file or heredoc) is present; the command and the heredoc_redirect are
  // siblings, so we have to detect heredoc here and forward it to the command.
  if (node.type === "redirected_statement") {
    const hasHeredoc = namedChildren(node).some((c) => c.type === "heredoc_redirect");
    const out: Segment[] = [];
    for (const child of namedChildren(node)) {
      if (child.type === "command") {
        out.push(...extractCommand(child, ctx, hasHeredoc));
      } else {
        out.push(...walkNode(child, ctx));
      }
    }
    return out;
  }
  if (node.type === "command_substitution" || node.type === "process_substitution") {
    const out: Segment[] = [];
    for (const child of namedChildren(node)) {
      out.push(...walkNode(child, { fromSubsh: true }));
    }
    return out;
  }
  if (RECURSIVE_TYPES.has(node.type)) {
    const out: Segment[] = [];
    for (const child of namedChildren(node)) {
      out.push(...walkNode(child, ctx));
    }
    return out;
  }
  return [];
}

function extractCommand(node: SyntaxNode, ctx: WalkContext, hasHeredoc: boolean): Segment[] {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return [];

  const innerSegments: Segment[] = [];

  const tokens: ResolvedToken[] = [resolveCommandName(nameNode, innerSegments)];

  for (const child of namedChildren(node)) {
    if (child.id === nameNode.id) continue;
    if (child.type === "variable_assignment") continue;
    if (child.type === "heredoc_redirect") continue;
    if (child.type === "file_redirect") continue;
    tokens.push(resolveNode(child, innerSegments));
  }

  const peeled = peelPrefixes(tokens);
  if (peeled.binary === "") return innerSegments;

  const segment: Segment = {
    binary: peeled.binary,
    args: peeled.args,
    raw: [peeled.binary, ...peeled.args].join(" "),
    hasExpr: peeled.hasExpr,
    fromSubsh: ctx.fromSubsh,
    hasHeredoc,
  };
  return [segment, ...innerSegments];
}

/**
 * `command_name` wraps the actual binary node (word / string / raw_string).
 * Descend into it so quoted forms like `'rm'` or `"rm"` resolve to `rm`.
 */
function resolveCommandName(commandName: SyntaxNode, innerOut: Segment[]): ResolvedToken {
  const inner = commandName.namedChildCount > 0 ? commandName.namedChild(0) : null;
  return resolveNode(inner ?? commandName, innerOut);
}

function resolveNode(node: SyntaxNode, innerOut: Segment[]): ResolvedToken {
  const subs = collectSubstitutions(node);
  for (const s of subs) {
    innerOut.push(...walkNode(s, { fromSubsh: true }));
  }
  const isLiteral = subs.length === 0 && !hasExpansion(node);
  return { text: stripQuotes(node), isLiteral };
}

function collectSubstitutions(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  if (node.type === "command_substitution" || node.type === "process_substitution") {
    out.push(node);
    return out;
  }
  walkDescendants(node, (n) => {
    if (n.type === "command_substitution" || n.type === "process_substitution") {
      out.push(n);
      return false;
    }
    return true;
  });
  return out;
}

function hasExpansion(node: SyntaxNode): boolean {
  if (isExpansionNode(node)) return true;
  let found = false;
  walkDescendants(node, (n) => {
    if (isExpansionNode(n)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

function isExpansionNode(node: SyntaxNode): boolean {
  return (
    node.type === "expansion" ||
    node.type === "simple_expansion" ||
    node.type === "arithmetic_expansion"
  );
}

function walkDescendants(node: SyntaxNode, visit: (n: SyntaxNode) => boolean): void {
  for (const child of namedChildren(node)) {
    const recurse = visit(child);
    if (recurse) walkDescendants(child, visit);
  }
}

function stripQuotes(node: SyntaxNode): string {
  const text = node.text;
  if ((node.type === "string" || node.type === "raw_string") && text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const c = node.namedChild(i);
    if (c) out.push(c);
  }
  return out;
}
