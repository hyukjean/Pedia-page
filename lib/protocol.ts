// The single-call protocol: the model streams prose, then a delimiter line,
// then one JSON object (chips / bedrock verdict). One call carries both the
// human text and the machine metadata — no second request, ever.

export const META_DELIMITER = "<<<PEDIA_META>>>";

export interface ParsedOutput {
  text: string;
  meta: Record<string, unknown> | null;
}

export function parseModelOutput(full: string): ParsedOutput {
  const idx = full.indexOf(META_DELIMITER);
  if (idx === -1) return { text: full.trim(), meta: null };
  const text = full.slice(0, idx).trim();
  const tail = full.slice(idx + META_DELIMITER.length).trim();
  try {
    const start = tail.indexOf("{");
    const end = tail.lastIndexOf("}");
    if (start === -1 || end === -1) return { text, meta: null };
    return { text, meta: JSON.parse(tail.slice(start, end + 1)) };
  } catch {
    return { text, meta: null };
  }
}
