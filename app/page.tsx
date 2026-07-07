import Workspace from "@/components/Workspace";

// /?q=… lets public card pages (and shared links) drop straight into a session.
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <Workspace initialQuestion={typeof q === "string" && q.trim() ? q.trim() : null} />;
}
