/**
 * Quota enforcement — check and track usage by tier.
 *
 * Tiers: anonymous (no account), free, plus, pro
 * All limits are per-calendar-day unless noted.
 */

export type Tier = "anonymous" | "free" | "plus" | "pro";
export type ActionType = "chat_message" | "analysis" | "brief" | "extraction" | "project_create";

interface QuotaResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  upgradeMessage: string;
}

const LIMITS: Record<Tier, Record<ActionType, number>> = {
  anonymous: {
    chat_message: 3,       // 3 messages total before signup prompt
    analysis: 1,           // 1 analysis
    brief: 0,              // No briefs
    extraction: 1,         // 1 basic extraction
    project_create: 1,     // 1 anonymous project
  },
  free: {
    chat_message: 5,       // 5 messages per day
    analysis: 1,           // 1 analysis per day
    brief: 0,              // No briefs
    extraction: 1,         // 1 extraction per day
    project_create: 3,     // 3 total projects
  },
  plus: {
    chat_message: -1,      // Unlimited (-1)
    analysis: 5,           // 5 per day
    brief: 5,              // 5 per day
    extraction: 10,        // 10 per day
    project_create: 50,    // 50 total projects
  },
  pro: {
    chat_message: -1,      // Unlimited
    analysis: -1,          // Unlimited
    brief: -1,             // Unlimited
    extraction: -1,        // Unlimited
    project_create: -1,    // Unlimited
  },
};

const UPGRADE_MESSAGES: Record<ActionType, string> = {
  chat_message: "You've reached your message limit. Sign up for a free account or upgrade for unlimited messages.",
  analysis: "You've used your analysis quota for today. Upgrade to Plus for more analyses.",
  brief: "Decision Briefs require a Plus or Pro subscription.",
  extraction: "You've reached your extraction limit. Upgrade for more document extractions.",
  project_create: "You've reached your project limit. Upgrade for more projects.",
};

/**
 * Check if an action is allowed for the given tier.
 * For daily limits, `usedToday` should be the count of this action type today.
 * For total limits (project_create), `usedToday` should be the total count.
 */
export function checkQuota(
  tier: Tier,
  action: ActionType,
  usedToday: number,
): QuotaResult {
  const limit = LIMITS[tier][action];

  if (limit === -1) {
    return { allowed: true, remaining: -1, limit: -1, upgradeMessage: "" };
  }

  if (limit === 0) {
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      upgradeMessage: UPGRADE_MESSAGES[action],
    };
  }

  const remaining = Math.max(0, limit - usedToday);
  return {
    allowed: remaining > 0,
    remaining,
    limit,
    upgradeMessage: remaining <= 0 ? UPGRADE_MESSAGES[action] : "",
  };
}

/**
 * Get the tier display name.
 */
export function tierDisplayName(tier: Tier): string {
  return { anonymous: "Guest", free: "Free", plus: "Plus", pro: "Pro" }[tier];
}
