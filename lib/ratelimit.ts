import { NextRequest } from "next/server";
import { db } from "./db";
import { AuthedUser } from "./auth";
import { PLANS } from "./plans";
import { Profile } from "./account";

// Fixed-window limits on generation calls only (cache hits are free and
// unlimited). Counters live in Postgres because serverless instances share
// nothing else. No DB, or a counting error → fail open: availability of
// the product outranks perfection of the meter.

export type LimitClass = "strong" | "cheap";

export interface LimitVerdict {
  ok: boolean;
  message?: string;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

export async function checkRateLimit(
  req: NextRequest,
  cls: LimitClass,
  user: AuthedUser | null,
  profile: Profile,
): Promise<LimitVerdict> {
  const client = db();
  if (!client) return { ok: true };

  const limits = PLANS[profile.plan];
  const limit = cls === "strong" ? limits.strongPerHour : limits.cheapPerHour;
  const identity = user ? `u:${user.id}` : `ip:${clientIp(req)}`;

  const { data, error } = await client.rpc("hit_rate_limit", {
    p_bucket: `${cls}:${identity}`,
    p_limit: limit,
    p_window_seconds: 3600,
  });
  if (error) {
    console.error("[pedia] rate limit check failed (open):", error.message);
    return { ok: true };
  }
  if (data === true) return { ok: true };

  const upsell =
    profile.plan === "anon"
      ? "sign in for higher limits."
      : profile.plan === "free"
        ? "add your own API key in the account panel for much higher limits."
        : "try again in a bit.";
  return {
    ok: false,
    message: `hourly limit reached (${limit}/h on the ${limits.label} tier) — ${upsell}`,
  };
}
