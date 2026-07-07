import { NextRequest, after } from "next/server";
import { streamChat } from "@/lib/providers";
import { loadPrompt } from "@/lib/prompts";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[pedia] /api/synthesis failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "internal error" }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.slice(0, 500) : "";
  const answer = typeof body.answer === "string" ? body.answer.slice(0, 6000) : "";
  const concepts: { term: string; gist: string }[] = Array.isArray(body.concepts)
    ? body.concepts.slice(0, 12).map((c: { term?: string; gist?: string }) => ({
        term: String(c.term ?? "").slice(0, 120),
        gist: String(c.gist ?? "").slice(0, 300),
      }))
    : [];

  if (!question || !answer || concepts.length < 1) {
    return Response.json({ error: "question, answer, concepts required" }, { status: 400 });
  }

  const user = [
    `Original question:`,
    question,
    ``,
    `Original answer:`,
    answer,
    ``,
    `Concepts the reader has now explored:`,
    ...concepts.map((c) => `- ${c.term}: ${c.gist}`),
  ].join("\n");

  // Synthesis reuses the strong model; it is rare (≥3 cards) and high-value.
  const userP = currentUser().catch(() => null);
  const { stream, model, mock } = await streamChat("synthesis", loadPrompt("synthesis"), user, 4096);

  if (!mock) {
    after(() =>
      userP
        .then((u) =>
          logEvent({ user: u, sessionId: body.sessionId, rootQuestion: question, type: "synthesis", label: question }),
        )
        .catch(() => {}),
    );
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "x-pedia-model": model,
      "x-pedia-mock": mock ? "1" : "0",
    },
  });
}
