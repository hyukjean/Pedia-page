import fs from "node:fs";
import path from "node:path";

// Prompts are content, not code — they live in /prompts and are read once.
const cache = new Map<string, string>();

export function loadPrompt(name: "root-answer" | "knowledge-card" | "synthesis" | "recommend" | "export"): string {
  let p = cache.get(name);
  if (!p) {
    p = fs.readFileSync(path.join(process.cwd(), "prompts", `${name}.md`), "utf8");
    cache.set(name, p);
  }
  return p;
}
