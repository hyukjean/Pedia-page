import { NextRequest, after } from "next/server";
import { streamChat } from "@/lib/providers";
import { loadPrompt } from "@/lib/prompts";
import { currentUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";

export const runtime = "nodejs";
export const maxDuration = 60;

// Compile one exploration session into a single narrative (markdown) plus
// a 60-second reel script — one strong-model call, reel frames delivered
// in the same stream via the standard META delimiter. The curiosity *path*
// (card order, drag vs typed question, bedrock) is the narrative input;
// this is exactly the data a transcript of card texts alone wouldn't carry.

interface ExportNode {
  label: string;
  kind: "root" | "drag" | "question";
  depth: number;
  parent: string | null;
  bedrock: boolean;
  content: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  const level = body.level === "easy" ? "easy" : "standard";
  const rawNodes: unknown[] = Array.isArray(body.nodes) ? body.nodes.slice(0, 14) : [];

  const nodes: ExportNode[] = rawNodes
    .map((n) => {
      const o = (n ?? {}) as Record<string, unknown>;
      return {
        label: String(o.label ?? "").slice(0, 300),
        kind: (o.kind === "drag" || o.kind === "question" ? o.kind : "root") as ExportNode["kind"],
        depth: Number(o.depth) || 0,
        parent: typeof o.parent === "string" ? o.parent.slice(0, 300) : null,
        bedrock: o.bedrock === true,
        content: String(o.content ?? "").slice(0, o.kind === "root" ? 6000 : 2000),
      };
    })
    .filter((n) => n.label && n.content);

  if (!question || nodes.length < 2) {
    return Response.json({ error: "question and at least 2 nodes required" }, { status: 400 });
  }

  const user = [
    `Difficulty: ${level === "easy" ? "EASY" : "STANDARD"}`,
    `Original question: ${question}`,
    ``,
    `The exploration, in the exact order the reader's curiosity moved:`,
    ...nodes.map((n, i) =>
      [
        ``,
        `── ${i + 1}. [${n.kind}] ${n.label}`,
        n.parent ? `   (opened from: ${n.parent}, depth ${n.depth})` : `   (the root answer)`,
        n.bedrock ? `   (this one reached bedrock)` : ``,
        n.content,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");

  const userP = currentUser().catch(() => null);
  const { stream, model, mock } = await streamChat("synthesis", loadPrompt("export"), user, 4096);

  if (!mock) {
    after(() =>
      userP
        .then((u) =>
          logEvent({ user: u, sessionId: body.sessionId, rootQuestion: question, type: "export", label: question }),
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
