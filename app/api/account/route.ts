import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptSecret, byokConfigured } from "@/lib/crypto";
import { getProfile } from "@/lib/account";
import { PLANS } from "@/lib/plans";

export const runtime = "nodejs";

// The account surface: what we know about you, your plan and limits,
// your own API key (encrypted at rest), and the delete button. Seeing
// and erasing your data is a feature, not a settings afterthought.

export async function GET() {
  const user = await currentUser();
  const client = db();
  if (!user || !client) return Response.json({ error: "sign in required" }, { status: 401 });

  const [profile, events, sessions] = await Promise.all([
    getProfile(user),
    client.from("events").select("*", { count: "exact", head: true }).eq("user_id", user.id),
    client.from("sessions").select("*", { count: "exact", head: true }).eq("user_id", user.id),
  ]);
  const limits = PLANS[profile.plan];
  return Response.json({
    email: user.email,
    plan: profile.plan,
    limits: { strongPerHour: limits.strongPerHour, cheapPerHour: limits.cheapPerHour },
    byokProvider: profile.byok?.provider ?? null,
    byokAvailable: byokConfigured(),
    events: events.count ?? 0,
    sessions: sessions.count ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  const client = db();
  if (!user || !client) return Response.json({ error: "sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "set_key") {
    if (!byokConfigured()) {
      return Response.json({ error: "BYOK is not enabled on this deployment (PEDIA_KEY_SECRET missing)" }, { status: 400 });
    }
    const provider = body.provider;
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!["gemini", "openai", "anthropic"].includes(provider) || key.length < 8 || key.length > 300) {
      return Response.json({ error: "valid provider and key required" }, { status: 400 });
    }
    const encrypted = encryptSecret(key);
    await client
      .from("users")
      .upsert({ id: user.id, email: user.email, encrypted_api_key: encrypted, byok_provider: provider }, { onConflict: "id" });
    return Response.json({ ok: true });
  }

  if (body.action === "delete_key") {
    await client.from("users").update({ encrypted_api_key: null, byok_provider: null }).eq("id", user.id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
}

/** Erase the exploration trajectory — events, sessions, cached suggestions. */
export async function DELETE() {
  const user = await currentUser();
  const client = db();
  if (!user || !client) return Response.json({ error: "sign in required" }, { status: 401 });

  await client.from("events").delete().eq("user_id", user.id);
  await client.from("sessions").delete().eq("user_id", user.id);
  await client.from("users").update({ recs: null, recs_event_count: -1 }).eq("id", user.id);
  return Response.json({ ok: true });
}
