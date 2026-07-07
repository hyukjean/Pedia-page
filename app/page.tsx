import Workspace from "@/components/Workspace";

// /?q=… drops straight into a session; &sel=… (from a drag on a public
// card page) additionally derives that selection as the first card.
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; sel?: string }> }) {
  const { q, sel } = await searchParams;
  return (
    <Workspace
      initialQuestion={typeof q === "string" && q.trim() ? q.trim() : null}
      initialSelection={typeof sel === "string" && sel.trim() ? sel.trim().slice(0, 300) : null}
    />
  );
}
