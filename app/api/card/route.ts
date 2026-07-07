import { NextRequest, after } from "next/server";
import { streamChat } from "@/lib/providers";
import { loadPrompt } from "@/lib/prompts";
import { contextHash } from "@/lib/hash";
import { cacheLookup, cacheStore } from "@/lib/cache";
import { parseModelOutput, META_DELIMITER } from "@/lib/protocol";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Hard safety net beneath the AI's own bedrock detection. */
const MAX_DEPTH = 6;

const textHeaders = (extra: Record<string, string>) => ({
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
  ...extra,
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const selection = typeof body.selection === "string" ? body.selection.trim().slice(0, 300) : "";
  const context = typeof body.context === "string" ? body.context.trim().slice(0, 2000) : "";
  const rootQuestion = typeof body.rootQuestion === "string" ? body.rootQuestion.slice(0, 500) : "";
  const path: string[] = Array.isArray(body.path) ? body.path.slice(0, MAX_DEPTH).map(String) : [];
  const depth = Number(body.depth ?? path.length);
  // "drag": a fragment selected inside a node. "question": typed into the
  // follow-up input — same tree, same model, differently framed prompt.
  const kind = body.kind === "question" ? "question" : "drag";

  if (!selection || !context) {
    return Response.json({ error: "selection and context required" }, { status: 400 });
  }
  if (depth > MAX_DEPTH) {
    return Response.json({ error: "depth limit", maxDepth: MAX_DEPTH }, { status: 422 });
  }

  // Cache key = the fragment *in its context* — same words in a different
  // paragraph legitimately produce a different card. Typed questions get
  // their own key space ("q:") so they never collide with dragged text.
  const hash = contextHash("card", kind === "question" ? `q:${selection}` : selection, context);

  // Resolve the signed-in user in parallel — never awaited on the stream path.
  const userP = currentUser().catch(() => null);
  const attribute = (bedrock: boolean) =>
    userP.then((user) =>
      logEvent({
        user,
        sessionId: body.sessionId,
        rootQuestion,
        type: "derive",
        label: selection,
        depth,
        cardHash: hash,
        bedrock,
      }),
    );

  const hit = await cacheLookup("card", hash, `${selection} — ${context.slice(0, 300)}`);
  if (hit) {
    after(() => attribute(hit.meta?.bedrock === true).catch(() => {}));
    const responseBody = `${hit.content}\n${META_DELIMITER}\n${JSON.stringify(hit.meta ?? {})}`;
    return new Response(responseBody, {
      headers: textHeaders({
        "x-pedia-cache": hit.similarity === 1 ? "exact" : "semantic",
        "x-pedia-model": hit.model_used ?? "unknown",
        // Headers are ByteString (Latin-1); Korean slugs must be pct-encoded.
        "x-pedia-slug": encodeURIComponent(hit.slug ?? ""),
      }),
    });
  }

  const user = [
    `Root question of this session: ${rootQuestion || "(none)"}`,
    `Path of expanded concepts so far (root → here): ${path.length ? path.join(" → ") : "(directly from the root answer)"}`,
    `Current depth: ${depth} of ${MAX_DEPTH}`,
    ``,
    kind === "question" ? `Passage the reader was viewing (context):` : `Original paragraph (context):`,
    context,
    ``,
    kind === "question"
      ? `While reading it, the reader typed this follow-up question. Answer it inside this context, in the same card format:`
      : `Selected fragment to explain in this context:`,
    selection,
  ].join("\n");

  // Generous cap: thinking-capable card models spend budget on hidden
  // reasoning tokens first; unused cap costs nothing.
  const { stream, done, model, mock } = await streamChat("card", loadPrompt("knowledge-card"), user, 2048);

  const store = done.then(({ fullText, usage }) => {
    if (mock) return;
    const { text, meta } = parseModelOutput(fullText);
    const persist = text
      ? cacheStore({
          type: "card",
          hash,
          queryText: selection,
          content: text,
          meta: meta ?? {},
          model,
          usage,
        })
      : Promise.resolve();
    return Promise.allSettled([persist, attribute(meta?.bedrock === true)]);
  });
  after(() => Promise.race([store, new Promise((r) => setTimeout(r, 20000))]).catch(() => {}));

  return new Response(stream, {
    headers: textHeaders({
      "x-pedia-cache": "miss",
      "x-pedia-model": model,
      "x-pedia-mock": mock ? "1" : "0",
    }),
  });
}
