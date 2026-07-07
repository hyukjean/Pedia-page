// Plan tiers and their hourly generation budgets. Cache hits are never
// limited (they cost nothing — limiting them would only hurt users).
// "strong" = root answers, synthesis, exports. "cheap" = cards, recommend.
// BYOK runs on the user's own key, so their budget is nearly unbounded.

export type PlanId = "anon" | "free" | "plus" | "byok";

interface PlanLimits {
  strongPerHour: number;
  cheapPerHour: number;
  label: string;
}

const env = (name: string, fallback: number) => Number(process.env[name]) || fallback;

export const PLANS: Record<PlanId, PlanLimits> = {
  anon: {
    label: "anonymous",
    strongPerHour: env("PEDIA_LIMIT_ANON_STRONG", 8),
    cheapPerHour: env("PEDIA_LIMIT_ANON_CHEAP", 40),
  },
  free: {
    label: "free",
    strongPerHour: env("PEDIA_LIMIT_FREE_STRONG", 20),
    cheapPerHour: env("PEDIA_LIMIT_FREE_CHEAP", 120),
  },
  plus: {
    label: "plus",
    strongPerHour: env("PEDIA_LIMIT_PLUS_STRONG", 200),
    cheapPerHour: env("PEDIA_LIMIT_PLUS_CHEAP", 1000),
  },
  byok: {
    label: "your own key",
    strongPerHour: env("PEDIA_LIMIT_BYOK_STRONG", 500),
    cheapPerHour: env("PEDIA_LIMIT_BYOK_CHEAP", 2000),
  },
};
