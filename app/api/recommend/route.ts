import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/account";
import { streamChat } from "@/lib/providers";
import { loadPrompt } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 30;

// Personalized landing suggestions, computed from the user's trajectory
// (events table), not from what they said they wanted. Results are cached
// on the profile row and only regenerated after new activity, so an idle
// user's landing visit costs zero LLM calls.

export async function GET() {
  const [user, client] = [await currentUser(), db()];
  if (!user || !client) return Response.json({ suggestions: null });

  const { count } = await client
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (!count) return Response.json({ suggestions: null });

  const { data: profile } = await client
    .from("users")
    .select("recs, recs_event_count")
    .eq("id", user.id)
    .maybeSingle();
  if (Array.isArray(profile?.recs) && profile.recs.length && profile.recs_event_count === count) {
    return Response.json({ suggestions: profile.recs, cached: true });
  }

  const { data: events } = await client
    .from("events")
    .select("type, label, depth, bedrock")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (!events?.length) return Response.json({ suggestions: null });

  // Oldest → newest so "recent" reads naturally for the model.
  const trajectory = events
    .reverse()
    .map((e) => `${e.type}${e.depth ? ` (depth ${e.depth})` : ""}${e.bedrock ? " [reached bedrock]" : ""}: ${e.label}`)
    .join("\n");

  // Cheap model — this is a background nicety, never worth root-model cost.
  const acct = await getProfile(user);
  const { stream, mock } = await streamChat(
    "card",
    loadPrompt("recommend"),
    trajectory,
    2048,
    acct.byok ?? undefined,
  );
  if (mock) return Response.json({ suggestions: null });

  const full = await new Response(stream).text();
  let suggestions: string[] = [];
  try {
    const parsed = JSON.parse(full.slice(full.indexOf("{"), full.lastIndexOf("}") + 1));
    if (Array.isArray(parsed.suggestions)) {
      suggestions = parsed.suggestions.map(String).filter(Boolean).slice(0, 4);
    }
  } catch {
    /* malformed model output → fall through to null */
  }
  if (!suggestions.length) return Response.json({ suggestions: null });

  await client
    .from("users")
    .upsert(
      { id: user.id, email: user.email, recs: suggestions, recs_event_count: count },
      { onConflict: "id" },
    );
  return Response.json({ suggestions });
}
