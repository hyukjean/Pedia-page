import Workspace from "@/components/Workspace";

// /?q=… drops straight into a session; &sel=… (a drag on a public card
// page) derives that selection as the first card; &ask=… (a question
// typed there) arrives as the first question card.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sel?: string; ask?: string }>;
}) {
  const { q, sel, ask } = await searchParams;
  return (
    <Workspace
      initialQuestion={typeof q === "string" && q.trim() ? q.trim() : null}
      initialSelection={typeof sel === "string" && sel.trim() ? sel.trim().slice(0, 300) : null}
      initialAsk={typeof ask === "string" && ask.trim() ? ask.trim().slice(0, 300) : null}
    />
  );
}
