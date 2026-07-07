import { db } from "./db";
import { AuthedUser } from "./auth";
import { decryptSecret } from "./crypto";
import { PlanId } from "./plans";
import type { ProviderId } from "./providers";

// The per-request identity bundle: plan tier and (if set) the user's own
// decrypted provider key. One DB read, resolved only on generation paths —
// cache hits never pay for it.

export interface Profile {
  plan: PlanId;
  byok: { provider: ProviderId; apiKey: string } | null;
}

const PROVIDER_IDS = ["gemini", "openai", "anthropic"] as const;

export async function getProfile(user: AuthedUser | null): Promise<Profile> {
  const client = db();
  if (!user || !client) return { plan: user ? "free" : "anon", byok: null };
  const { data } = await client
    .from("users")
    .select("plan, byok_provider, encrypted_api_key")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return { plan: "free", byok: null };

  let byok: Profile["byok"] = null;
  if (data.encrypted_api_key && PROVIDER_IDS.includes(data.byok_provider)) {
    const key = decryptSecret(data.encrypted_api_key);
    if (key) byok = { provider: data.byok_provider as ProviderId, apiKey: key };
  }
  return { plan: byok ? "byok" : data.plan === "plus" ? "plus" : "free", byok };
}
