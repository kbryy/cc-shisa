import type { Classification } from "../classifier/index.ts";
import type { Level, Profile } from "../rules/types.ts";
import type { Decision } from "./types.ts";

/**
 * Convert a Classification into a Decision under the given profile + level.
 * Profile-level overrides take precedence over the level's default mapping.
 */
export function decide(
  classification: Classification,
  profile: Profile,
  level: Level,
): Decision {
  const action =
    profile.overrides?.[classification.class] ?? level.mapping[classification.class];

  return {
    action,
    class: classification.class,
    reason: classification.reason,
    ...(classification.ruleId !== undefined ? { matchedRule: classification.ruleId } : {}),
    ...(classification.matchedSegment !== undefined
      ? { segment: classification.matchedSegment }
      : {}),
  };
}
