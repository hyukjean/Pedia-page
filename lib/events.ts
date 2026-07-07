import { db } from "./db";
import { AuthedUser } from "./auth";

// Trajectory logging. The unit of personal knowledge is not the card
// (cards are communal cache) but the *event*: what was asked, what was
// dragged, how deep, where it hit bedrock. Recommendations read this.
// No user or no DB → silent no-op; logging never touches the stream.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventArgs {
  user: AuthedUser | null;
  sessionId?: unknown; // client-generated; validated here
  rootQuestion?: string;
  type: "ask" | "derive" | "synthesis" | "export";
  label: string;
  depth?: number;
  cardHash?: string;
  bedrock?: boolean;
}

export async function logEvent(args: EventArgs): Promise<void> {
  const client = db();
  if (!client || !args.user) return;
  try {
    const sessionId =
      typeof args.sessionId === "string" && UUID_RE.test(args.sessionId) ? args.sessionId : null;

    // Lazy profile row — first attributed event creates it.
    await client
      .from("users")
      .upsert({ id: args.user.id, email: args.user.email }, { onConflict: "id" });

    if (sessionId && args.rootQuestion) {
      await client.from("sessions").upsert(
        { id: sessionId, user_id: args.user.id, root_question: args.rootQuestion.slice(0, 500) },
        { onConflict: "id", ignoreDuplicates: true },
      );
    }

    await client.from("events").insert({
      session_id: sessionId,
      user_id: args.user.id,
      type: args.type,
      label: args.label.slice(0, 300),
      depth: args.depth ?? 0,
      card_hash: args.cardHash ?? null,
      bedrock: args.bedrock ?? false,
    });
  } catch (e) {
    console.error("[pedia] logEvent failed:", e);
  }
}
