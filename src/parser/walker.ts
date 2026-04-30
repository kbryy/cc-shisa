import type { Segment } from "./types.ts";
import { peelPrefixes, resolveWord, type ResolvedToken } from "./normalize.ts";

/**
 * Loose AST node typing. bash-parser ships no .d.ts, so we describe just the
 * shape we read. Extra properties are tolerated.
 */
export interface Word {
  type: "Word" | "Name" | "AssignmentWord" | string;
  text: string;
  expansion?: readonly Expansion[];
}

interface Expansion {
  type: "ParameterExpansion" | "CommandExpansion" | "ArithmeticExpansion" | string;
  commandAST?: AstNode;
}

interface RedirSuffix {
  type: string;
  text?: string;
}

interface CommandNode {
  type: "Command";
  name?: Word;
  prefix?: readonly Word[];
  suffix?: readonly (Word | RedirSuffix)[];
}

interface ListNode {
  type: "Script" | "CompoundList" | "Pipeline";
  commands: readonly AstNode[];
}

interface LogicalNode {
  type: "LogicalExpression";
  op: string;
  left: AstNode;
  right: AstNode;
}

interface SubshellNode {
  type: "Subshell";
  list: AstNode;
}

interface IfNode {
  type: "If";
  clause: AstNode;
  then: AstNode;
  else?: AstNode;
}

interface LoopNode {
  type: "While" | "Until";
  clause: AstNode;
  do: AstNode;
}

interface ForNode {
  type: "For";
  do: AstNode;
}

interface CaseNode {
  type: "Case";
  cases: readonly { body: AstNode }[];
}

interface FunctionNode {
  type: "Function";
  body: AstNode;
}

export type AstNode =
  | CommandNode
  | ListNode
  | LogicalNode
  | SubshellNode
  | IfNode
  | LoopNode
  | ForNode
  | CaseNode
  | FunctionNode
  | { type: string };

interface WalkContext {
  fromSubsh: boolean;
}

export function walk(node: AstNode, ctx: WalkContext = { fromSubsh: false }): Segment[] {
  switch (node.type) {
    case "Script":
    case "CompoundList":
    case "Pipeline":
      return (node as ListNode).commands.flatMap((c) => walk(c, ctx));

    case "LogicalExpression": {
      const n = node as LogicalNode;
      return [...walk(n.left, ctx), ...walk(n.right, ctx)];
    }

    case "Subshell":
      return walk((node as SubshellNode).list, ctx);

    case "If": {
      const n = node as IfNode;
      const out = [...walk(n.clause, ctx), ...walk(n.then, ctx)];
      if (n.else) out.push(...walk(n.else, ctx));
      return out;
    }

    case "While":
    case "Until": {
      const n = node as LoopNode;
      return [...walk(n.clause, ctx), ...walk(n.do, ctx)];
    }

    case "For":
      return walk((node as ForNode).do, ctx);

    case "Case":
      return (node as CaseNode).cases.flatMap((c) => walk(c.body, ctx));

    case "Function":
      return walk((node as FunctionNode).body, ctx);

    case "Command":
      return collectCommand(node as CommandNode, ctx);

    default:
      return [];
  }
}

function collectCommand(cmd: CommandNode, ctx: WalkContext): Segment[] {
  if (!cmd.name) return [];

  const nameTok: ResolvedToken = resolveWord(cmd.name);

  const suffixWords: Word[] = [];
  let hasHeredoc = false;
  for (const item of cmd.suffix ?? []) {
    if (isWord(item)) {
      suffixWords.push(item);
    } else if (item.type === "dless" || item.type === "dlessdash") {
      hasHeredoc = true;
    }
  }

  const tokens: ResolvedToken[] = [nameTok, ...suffixWords.map(resolveWord)];
  const peeled = peelPrefixes(tokens);

  if (peeled.binary === "") return [];

  const raw = renderRaw(peeled.binary, peeled.args);

  const segment: Segment = {
    binary: peeled.binary,
    args: peeled.args,
    raw,
    hasExpr: peeled.hasExpr,
    fromSubsh: ctx.fromSubsh,
    hasHeredoc,
  };

  const inner = collectInnerExpansions(cmd);
  return [segment, ...inner];
}

function isWord(item: Word | RedirSuffix): item is Word {
  return (item as Word).text !== undefined && (item as Word).type === "Word";
}

function collectInnerExpansions(cmd: CommandNode): Segment[] {
  const out: Segment[] = [];
  const visit = (w: Word | undefined) => {
    if (!w) return;
    for (const ex of w.expansion ?? []) {
      if (ex.type === "CommandExpansion" && ex.commandAST) {
        out.push(...walk(ex.commandAST, { fromSubsh: true }));
      }
    }
  };
  visit(cmd.name);
  for (const item of cmd.suffix ?? []) {
    if (isWord(item)) visit(item);
  }
  return out;
}

function renderRaw(binary: string, args: readonly string[]): string {
  return [binary, ...args].join(" ");
}
