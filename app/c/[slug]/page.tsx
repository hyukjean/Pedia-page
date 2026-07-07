import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cardBySlug } from "@/lib/cache";
import PublicCardDemo from "@/components/PublicCardDemo";

// Cached cards double as SEO surface: every explored concept becomes a
// public, statically-rendered page that funnels back into the runtime.
export const revalidate = 3600;

type Params = { params: Promise<{ slug: string }> };

// Korean slugs arrive percent-encoded in the URL segment.
function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const card = await cardBySlug(decodeSlug(slug));
  if (!card) return { title: "Pedia" };
  const description = card.content.slice(0, 160).replace(/\s+/g, " ");
  return {
    title: `${card.query_text} — Pedia`,
    description,
    openGraph: {
      title: card.query_text,
      description,
      type: "article",
      siteName: "pedia.page",
    },
    twitter: {
      card: "summary_large_image",
      title: card.query_text,
      description,
    },
  };
}

export default async function CardPage({ params }: Params) {
  const { slug } = await params;
  const card = await cardBySlug(decodeSlug(slug));
  if (!card) notFound();

  const paragraphs = card.content.split(/\n\n+/).filter(Boolean);
  const chips = Array.isArray((card.meta as { chips?: string[] })?.chips)
    ? ((card.meta as { chips: string[] }).chips ?? []).slice(0, 4)
    : [];

  return (
    <div className="mx-auto max-w-[640px] px-6 py-16">
      <a href="/" className="mb-10 block text-[14px] font-semibold tracking-tight">
        pedia<span className="text-accent">.</span>page
      </a>
      <h1 className="text-[21px] font-semibold leading-snug">{card.query_text}</h1>
      <article id="public-card" className="mt-6 cursor-text">
        {paragraphs.map((p, i) => (
          <p key={i} className="mb-4 text-[16px] leading-[1.75]">
            {p}
          </p>
        ))}
      </article>
      {/* the shared page teaches the gesture — drag drops you into the runtime */}
      <PublicCardDemo question={card.query_text} />
      {chips.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {chips.map((c) => (
            <a
              key={c}
              href={`/?q=${encodeURIComponent(c)}`}
              className="rounded bg-surface px-2.5 py-1 text-[13px] text-sub transition-opacity duration-150 hover:opacity-70"
            >
              {c}
            </a>
          ))}
        </div>
      )}
      <a
        href={`/?q=${encodeURIComponent(card.query_text)}`}
        className="mt-12 block text-[13px] text-accent opacity-80 transition-opacity duration-150 hover:opacity-100"
      >
        explore this live on pedia.page →
      </a>
    </div>
  );
}
