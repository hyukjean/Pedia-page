import { PROVIDERS, ProviderConfig, ProviderId, apiKeyFor, activeProvider } from "./providers";

export const EMBED_DIM = 1536;

/** Provider used for embeddings: the active one if it supports them, else any configured one that does. */
function embedProvider(): ProviderConfig | null {
  const main = activeProvider();
  if (main?.embedModel) return main;
  for (const id of ["openai", "gemini"] as ProviderId[]) {
    const p = PROVIDERS[id];
    if (p.embedModel && apiKeyFor(p)) return p;
  }
  return null;
}

/**
 * Embed text to a 1536-dim unit vector, or null when no embedding-capable
 * key is configured (the cache then degrades to exact-hash matching).
 * 1536 is the one dimension both OpenAI (text-embedding-3-small, native)
 * and Gemini (gemini-embedding-001, Matryoshka truncation) can emit.
 */
export async function embed(text: string): Promise<number[] | null> {
  const p = embedProvider();
  if (!p) return null;
  try {
    const res = await fetch(`${p.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKeyFor(p)}`,
      },
      body: JSON.stringify({
        model: process.env.PEDIA_EMBED_MODEL || p.embedModel,
        input: text.slice(0, 8000),
        dimensions: EMBED_DIM,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    let v: number[] = json.data?.[0]?.embedding ?? [];
    if (v.length < EMBED_DIM) return null;
    if (v.length > EMBED_DIM) v = v.slice(0, EMBED_DIM);
    // L2-normalize: Gemini truncated vectors are not normalized; unit vectors
    // make cosine similarity numerically consistent across providers.
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  } catch {
    return null;
  }
}
