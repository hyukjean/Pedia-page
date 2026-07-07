import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";

// Magic-link landing point. Supabase redirects here with either a PKCE
// ?code= (browser-initiated flow) or a ?token_hash=&type= (email template
// direct verify). Both end the same way: session cookies set, back to /.

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.redirect(origin);

  const store = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => all.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (code) {
    await supabase.auth.exchangeCodeForSession(code).catch(() => {});
  } else if (tokenHash && type === "magiclink") {
    await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash }).catch(() => {});
  } else if (tokenHash && type === "email") {
    await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash }).catch(() => {});
  }

  return NextResponse.redirect(origin);
}
