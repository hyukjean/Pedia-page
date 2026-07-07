import fs from "node:fs";
import path from "node:path";
import { PROMPTS } from "./prompts-data";

// Prompts are content, not code — /prompts/*.md is the source of truth.
// Locally they're read from disk (edit + restart, no rebuild). In a
// serverless bundle the filesystem may not ship, so the build embeds them
// (scripts/embed-prompts.mjs → prompts-data.ts) as the fallback.
const cache = new Map<string, string>();

export function loadPrompt(name: "root-answer" | "knowledge-card" | "synthesis" | "recommend" | "export"): string {
  let p = cache.get(name);
  if (!p) {
    try {
      p = fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
    } catch {
      p = PROMPTS[name];
    }
    if (!p) throw new Error(`prompt not found: ${name}`);
    cache.set(name, p);
  }
  return p;
}
