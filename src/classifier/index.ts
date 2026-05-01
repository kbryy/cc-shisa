import type { ParseResult, Segment } from "../parser/types.ts";
import { strictnessRank } from "../rules/index.ts";
import type { Class, Module, Rule } from "../rules/types.ts";
import { inspectDynamic } from "./interpreter-inspect.ts";
import { matchAst, matchRegex } from "./matcher.ts";

export interface Classification {
  class: Class;
  reason: string;
  ruleId?: string;
  matchedSegment?: string;
}

/**
 * Walk every rule in every module against a parse result and pick the
 * strictest class that matches. Falls back to `unknown` when nothing
 * matches, when the parser failed, or when the only matches involved
 * a segment whose contents could not be statically resolved.
 */
export function classify(
  result: ParseResult,
  modules: readonly Module[],
): Classification {
  if (result.parseErr) {
    return { class: "unknown", reason: "parser failed; falling back to ask" };
  }

  let best: { rule: Rule; seg?: Segment } | null = null;

  for (const module of modules) {
    for (const rule of module.rules) {
      if (rule.match === "regex") {
        if (matchRegex(result.original, rule)) {
          best = pickStricter(best, { rule });
        }
        continue;
      }

      for (const seg of result.segments) {
        if (matchAst(seg, rule)) {
          best = pickStricter(best, { rule, seg });
        }
      }
    }
  }

  if (best) {
    if (best.rule.class === "dynamic" && best.seg) {
      const refined = inspectDynamic(best.seg);
      if (refined !== null) {
        return {
          class: refined.class,
          reason: refined.reason,
          ruleId: "interpreter-inspect",
          matchedSegment: best.seg.raw,
        };
      }
    }
    return {
      class: best.rule.class,
      reason: best.rule.reason,
      ruleId: best.rule.id,
      ...(best.seg ? { matchedSegment: best.seg.raw } : {}),
    };
  }

  if (result.segments.length === 0) {
    return { class: "unknown", reason: "no segments parsed" };
  }

  if (result.segments.some((s) => s.hasExpr)) {
    return {
      class: "unknown",
      reason: "command contains unresolved expansion",
    };
  }

  return { class: "unknown", reason: "no rule matched" };
}

function pickStricter(
  current: { rule: Rule; seg?: Segment } | null,
  next: { rule: Rule; seg?: Segment },
): { rule: Rule; seg?: Segment } {
  if (!current) return next;
  return strictnessRank(next.rule.class) > strictnessRank(current.rule.class)
    ? next
    : current;
}
