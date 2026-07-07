import { ImageResponse } from "next/og";
import { cardBySlug } from "@/lib/cache";

// Share-card image for public card pages — the same design system:
// white, ink, one accent dot. Generated on demand, no external deps.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let title = "Spatial knowledge exploration";
  try {
    const decoded = (() => {
      try {
        return decodeURIComponent(slug);
      } catch {
        return slug;
      }
    })();
    const card = await cardBySlug(decoded);
    if (card) title = card.query_text;
  } catch {}

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
          padding: 88,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: title.length > 60 ? 48 : 60,
            fontWeight: 600,
            color: "#1A1A1A",
            lineHeight: 1.35,
          }}
        >
          {title.slice(0, 140)}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 34, fontWeight: 600 }}>
          <span style={{ color: "#1A1A1A" }}>pedia</span>
          <span style={{ color: "#2B5CE6" }}>.</span>
          <span style={{ color: "#1A1A1A" }}>page</span>
        </div>
      </div>
    ),
    size,
  );
}
