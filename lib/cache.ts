import { db, CardRow } from "./db";
import { embed } from "./embeddings";
import { makeSlug } from "./hash";
import { Usage } from "./providers";

// Semantic cache. Two tiers, cheapest first:
//   1. exact context_hash match — free, works with zero embedding support
//   2. pgvector cosine similarity ≥ threshold — needs an embedding key
// Both tiers cost zero LLM calls on a hit, which is the entire point.

const THRESHOLD = () => Number(process.env.PEDIA_CACHE_THRESHOLD || 0.9);

export interface CacheHit {
  content: string;
  meta: Record<string, unknown>;
  slug: string | null;
  model_used: string | null;
  similarity: number; // 1 for exact hits
}

export async function cacheLookup(
  type: "root" | "card",
  hash: string,
  queryText: string,
): Promise<CacheHit | null> {
  const client = db();
  if (!client) return null;

  // Tier 1: exact hash
  const exact = await client
    .from("cards")
    .select("content, meta, slug, model_used")
    .eq("type", type)
    .eq("context_hash", hash)
    .limit(1)
    .maybeSingle();
  if (exact.data) return { ...(exact.data as Omit<CacheHit, "similarity">), similarity: 1 };

  // Tier 2: semantic similarity
  const vector = await embed(queryText);
  if (!vector) return null;
  const rpc = await client.rpc("match_cards", {
    query_embedding: JSON.stringify(vector),
    match_type: type,
    threshold: THRESHOLD(),
  });
  const row = rpc.data?.[0];
  if (!row) return null;
  return {
    content: row.content,
    meta: row.meta ?? {},
    slug: row.slug,
    model_used: row.model_used,
    similarity: row.similarity,
  };
}

export interface StoreArgs {
  type: "root" | "card";
  hash: string;
  queryText: string;
  content: string;
  meta: Record<string, unknown>;
  model: string;
  usage: Usage;
}

/** Fire-and-forget persistence; never throws into the request path. */
export async function cacheStore(args: StoreArgs): Promise<void> {
  const client = db();
  if (!client) return;
  try {
    const vector = await embed(args.queryText);
    const slug = makeSlug(args.queryText, args.hash);
    await client.from("cards").upsert(
      {
        type: args.type,
        slug,
        query_text: args.queryText,
        context_hash: args.hash,
        content: args.content,
        meta: args.meta,
        embedding: vector ? JSON.stringify(vector) : null,
        model_used: args.model,
        tokens_in: args.usage.tokens_in,
        tokens_out: args.usage.tokens_out,
      },
      { onConflict: "context_hash,type" },
    );
  } catch (e) {
    console.error("[pedia] cacheStore failed:", e);
  }
}

export async function cardBySlug(slug: string): Promise<CardRow | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from("cards").select("*").eq("slug", slug).maybeSingle();
  return (data as CardRow) ?? null;
}
