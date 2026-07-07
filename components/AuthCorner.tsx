"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

// Sign-in as a corner whisper, not a wall. Text only, no borders, no modal.
// If auth isn't configured (no NEXT_PUBLIC_SUPABASE_* env) this renders
// nothing and the product is exactly the anonymous MVP.

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Live auth state; null while signed out or when auth isn't configured. */
export function useUser(): { user: SessionUser | null; ready: boolean } {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) {
      setReady(true);
      return;
    }
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, ready };
}

// The label cycles through languages — the movement is the affordance
// that says "this is a button", and the languages say "any language works".
const SIGN_IN_LABELS = ["sign in", "로그인", "サインイン", "登录", "Anmelden", "se connecter"];

export default function AuthCorner({ user }: { user: SessionUser | null }) {
  const [mode, setMode] = useState<"idle" | "form" | "sent">("idle");
  const [email, setEmail] = useState("");
  const [labelIdx, setLabelIdx] = useState(0);
  const sb = supabaseBrowser();

  useEffect(() => {
    if (!sb || user || mode !== "idle") return;
    const t = setInterval(() => setLabelIdx((i) => (i + 1) % SIGN_IN_LABELS.length), 2600);
    return () => clearInterval(t);
  }, [sb, user, mode]);

  if (!sb) return null;

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr.includes("@")) return;
    await sb.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setMode("sent");
  };

  return (
    <div className="fixed right-6 top-5 z-10 text-[12px] text-sub">
      {user ? (
        <span className="opacity-60">
          {user.email}
          <button
            onClick={() => sb.auth.signOut()}
            className="ml-3 transition-opacity duration-150 hover:opacity-60"
          >
            sign out
          </button>
        </span>
      ) : mode === "idle" ? (
        <button
          onClick={() => setMode("form")}
          className="min-w-[88px] text-right opacity-70 transition-opacity duration-150 hover:opacity-100"
        >
          <span key={labelIdx} className="pedia-in inline-block">
            {SIGN_IN_LABELS[labelIdx]}
          </span>
        </button>
      ) : mode === "form" ? (
        <form onSubmit={sendLink} className="pedia-in flex items-center gap-2">
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email for a sign-in link"
            className="w-[200px] rounded bg-surface px-2.5 py-1.5 text-[16px] outline-none placeholder:text-sub md:text-[12px]"
          />
          <button type="submit" className="text-accent transition-opacity duration-150 hover:opacity-70">
            send
          </button>
        </form>
      ) : (
        <span className="pedia-in opacity-70">link sent — check your email</span>
      )}
    </div>
  );
}
