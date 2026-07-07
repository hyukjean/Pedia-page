import { NextRequest, after } from "next/server";
import { streamChat } from "@/lib/providers";
import { loadPrompt } from "@/lib/prompts";
import { contextHash, makeSlug } from "@/lib/hash";
import { db } from "@/lib/db";
import { cacheLookup, cacheStore } from "@/lib/cache";
import { parseModelOutput, META_DELIMITER } from "@/lib/protocol";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 60;

const textHeaders = (extra: Record<string, string>) => ({
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
  ...extra,
});

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    // Fail loud, not blank: an escaped exception otherwise becomes an
    // opaque platform 500 with an empty body.
    console.error("[pedia] /api/answer failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "internal error" }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const { question, sessionId } = await req.json().catch(() => ({}));
  if (typeof question !== "string" || !question.trim() || question.length > 500) {
    return Response.json({ error: "question required (≤500 chars)" }, { status: 400 });
  }
  const q = question.trim();
  const hash = contextHash("root", q);

  // Resolve the signed-in user in parallel — never awaited on the stream path.
  const userP = currentUser().catch(() => null);
  const attribute = () =>
    userP.then((user) =>
      logEvent({ user, sessionId, rootQuestion: q, type: "ask", label: q, cardHash: hash }),
    );

  // Cache first — a hit costs zero LLM calls (but is still trajectory data).
  const hit = await cacheLookup("root", hash, q);
  if (hit) {
    after(() => attribute().catch(() => {}));
    const body = `${hit.content}\n${META_DELIMITER}\n${JSON.stringify(hit.meta ?? {})}`;
    return new Response(body, {
      headers: textHeaders({
        "x-pedia-cache": hit.similarity === 1 ? "exact" : "semantic",
        "x-pedia-model": hit.model_used ?? "unknown",
        // Headers are ByteString (Latin-1); Korean slugs must be pct-encoded.
        "x-pedia-slug": encodeURIComponent(hit.slug ?? ""),
      }),
    });
  }

  // 4096, not ~1024: reasoning models spend most of the budget on hidden
  // thinking tokens before the visible answer; a tight cap truncates output
  // mid-sentence (finish_reason: length). The cap costs nothing unless used.
  const { stream, done, model, mock } = await streamChat("root", loadPrompt("root-answer"), q, 4096);

  // Persist after the stream completes — off the response path. after()
  // keeps the serverless instance alive; the race bounds a client abort.
  const store = done.then(({ fullText, usage }) => {
    if (mock) return;
    const { text, meta } = parseModelOutput(fullText);
    if (text)
      return cacheStore({ type: "root", hash, queryText: q, content: text, meta: meta ?? {}, model, usage });
  });
  const persist = mock ? store : Promise.allSettled([store, attribute()]);
  after(() => Promise.race([persist, new Promise((r) => setTimeout(r, 20000))]).catch(() => {}));

  return new Response(stream, {
    headers: textHeaders({
      "x-pedia-cache": "miss",
      "x-pedia-model": model,
      "x-pedia-mock": mock ? "1" : "0",
      // The slug is deterministic from the question, so the share link can
      // be offered immediately — the public page exists once persistence
      // completes. Only meaningful when a DB will actually store the card.
      "x-pedia-slug": db() && !mock ? encodeURIComponent(makeSlug(q, hash)) : "",
    }),
  });
}
