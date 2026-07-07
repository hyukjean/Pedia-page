import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// First principle: auth, like the DB, is an accelerator — never a gate.
// Every caller must tolerate currentUser() === null (no env, no cookie,
// expired token). The anon key only identifies; all data access stays
// behind the service-role key in server code.

export interface AuthedUser {
  id: string;
  email: string | null;
}

export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Resolve the signed-in user from the request cookies. Validates the JWT
 * against Supabase Auth (getUser, not getSession — cookies can be forged).
 * Call this in the request path (cookies() needs request scope), but don't
 * await it before streaming: start it, stream, await inside after().
 */
export async function currentUser(): Promise<AuthedUser | null> {
  if (!authConfigured()) return null;
  try {
    const store = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => store.getAll(),
          setAll: (all) => {
            // Route handlers may refresh the token here; Server Components
            // can't set cookies — swallow, the next handler will refresh.
            try {
              all.forEach(({ name, value, options }) => store.set(name, value, options));
            } catch {}
          },
        },
      },
    );
    const { data } = await supabase.auth.getUser();
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
  } catch {
    return null;
  }
}
