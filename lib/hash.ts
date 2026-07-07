import { createHash } from "node:crypto";

/** Normalize so trivially-different phrasings hash identically. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[?!.。？！\s]+$/g, "").trim();
}

export function contextHash(...parts: string[]): string {
  return createHash("sha256").update(parts.map(normalize).join("␟")).digest("hex");
}

/** URL slug: unicode letters/numbers kept (NFKC — keeps Hangul composed); short hash for uniqueness. */
export function makeSlug(text: string, hash: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${base || "card"}-${hash.slice(0, 8)}`;
}
