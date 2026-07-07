import { ImageResponse } from "next/og";
import { cardBySlug } from "@/lib/cache";

// Share-card image built to hook, not to repeat. The link widget below
// the image already shows the question as its title — so the image leads
// with the *answer's first sentence* (the densest line we have) as a
// teaser, plus the concept chips as a "there's more inside" signal.
// Headline font: Black Han Sans (the Korean thumbnail impact gothic),
// fetched as a per-image glyph subset so it stays tiny and fast.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Google Fonts glyph-subset trick: an old UA gets TTF (satori can't read woff2). */
async function loadFont(family: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; rv:20.0) Gecko/20100101 Firefox/20.0" },
      })
    ).text();
    // The old UA gets woff/ttf (never woff2, which satori can't parse).
    const url = css.match(/src: url\((.+?)\) format\('(?:truetype|opentype|woff)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** The answer's first sentence, tidied and clamped — the tease. */
function hookFrom(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  const m = t.match(/^.{20,}?[.!?。？！]/);
  const sent = (m ? m[0] : t).trim();
  return sent.length > 104 ? `${sent.slice(0, 102)}…` : sent;
}

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let question = "pedia.page";
  let hook = "Spatial knowledge exploration — one page, every derived understanding inside it.";
  let chips: string[] = [];
  try {
    const decoded = (() => {
      try {
        return decodeURIComponent(slug);
      } catch {
        return slug;
      }
    })();
    const card = await cardBySlug(decoded);
    if (card) {
      question = card.query_text;
      hook = hookFrom(card.content);
      const metaChips = (card.meta as { chips?: unknown })?.chips;
      if (Array.isArray(metaChips)) chips = metaChips.map(String).slice(0, 3);
    }
  } catch {}

  const allText = `${question}${hook}${chips.join("")}pedia.page …·`;
  // Noto Sans KR 800 for the hook (unambiguously bold, renders everywhere),
  // 500 for the supporting text — a notch above regular for aesthetics.
  const [hookFont, bodyFont] = await Promise.all([
    loadFont("Noto+Sans+KR:wght@800", allText),
    loadFont("Noto+Sans+KR:wght@500", allText),
  ]);

  const fonts = [
    ...(hookFont ? [{ name: "hook", data: hookFont, weight: 800 as const }] : []),
    ...(bodyFont ? [{ name: "body", data: bodyFont, weight: 500 as const }] : []),
  ];
  const hookSize = hook.length < 42 ? 68 : hook.length < 72 ? 58 : 48;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#FFFFFF",
          padding: "64px 72px",
          fontFamily: "body, sans-serif",
        }}
      >
        {/* the question, quiet — the widget title repeats it anyway */}
        <div style={{ display: "flex", fontSize: 28, color: "#8A8A8A" }}>
          {question.length > 60 ? `${question.slice(0, 58)}…` : question}
        </div>

        {/* the hook: first sentence of the answer, impact gothic */}
        <div
          style={{
            display: "flex",
            fontFamily: "hook, body, sans-serif",
            fontWeight: 800,
            fontSize: hookSize,
            color: "#1A1A1A",
            lineHeight: 1.32,
            letterSpacing: -0.5,
          }}
        >
          {hook}
        </div>

        {/* chips = "there's more inside" · wordmark */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            {chips.map((c) => (
              <div
                key={c}
                style={{
                  display: "flex",
                  background: "#FAFAFA",
                  color: "#8A8A8A",
                  fontSize: 24,
                  padding: "10px 22px",
                  borderRadius: 999,
                }}
              >
                {c.length > 16 ? `${c.slice(0, 15)}…` : c}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", fontSize: 32, fontFamily: "hook, body, sans-serif" }}>
            <span style={{ color: "#1A1A1A" }}>pedia</span>
            <span style={{ color: "#2B5CE6" }}>.</span>
            <span style={{ color: "#1A1A1A" }}>page</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
