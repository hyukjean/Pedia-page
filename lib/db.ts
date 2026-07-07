import { createClient, SupabaseClient } from "@supabase/supabase-js";

// First principle: the DB is an accelerator (cache + persistence), never a
// dependency. Every caller must tolerate db() === null.
let client: SupabaseClient | null | undefined;

export function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

export interface CardRow {
  id: string;
  type: "root" | "card";
  slug: string | null;
  query_text: string;
  context_hash: string;
  content: string;
  meta: Record<string, unknown>;
  model_used: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
  upvotes: number;
  downvotes: number;
}
