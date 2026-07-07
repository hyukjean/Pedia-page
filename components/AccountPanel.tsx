"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

// Your account, on one quiet card: plan and limits, your own API key
// (higher limits, your bill), what we've recorded, and the delete button.
// Seeing and erasing your data is a feature, not a settings afterthought.

interface AccountInfo {
  email: string;
  plan: string;
  limits: { strongPerHour: number; cheapPerHour: number };
  byokProvider: string | null;
  byokAvailable: boolean;
  events: number;
  sessions: number;
}

export default function AccountPanel({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [provider, setProvider] = useState<"gemini" | "openai" | "anthropic">("gemini");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d))
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = useCallback(
    async (fn: () => Promise<Response>, doneNote: string) => {
      setBusy(true);
      setNote(null);
      try {
        const res = await fn();
        const d = await res.json().catch(() => ({}));
        setNote(res.ok ? doneNote : String(d.error ?? "failed"));
        if (res.ok) refresh();
      } catch {
        setNote("network error");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const saveKey = () =>
    act(
      () =>
        fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set_key", provider, key: keyInput }),
        }),
      "key saved — your calls now run on your own account",
    ).then(() => setKeyInput(""));

  const removeKey = () =>
    act(
      () =>
        fetch("/api/account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete_key" }),
        }),
      "key removed",
    );

  const eraseData = () =>
    act(() => fetch("/api/account", { method: "DELETE" }), "your exploration history is erased").then(() =>
      setConfirmErase(false),
    );

  const signOut = () => {
    supabaseBrowser()?.auth.signOut();
    onClose();
  };

  return (
    <div className="pedia-in fixed right-4 top-12 z-40 w-[320px] rounded bg-surface p-5 text-[13px] max-md:inset-x-4 max-md:w-auto">
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="min-w-0 truncate font-semibold">{info?.email ?? "account"}</span>
        <button onClick={onClose} className="text-[15px] leading-none text-sub transition-opacity duration-150 hover:opacity-60">
          ×
        </button>
      </div>

      {!info ? (
        <p className="text-sub">loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          {/* plan */}
          <div>
            <p>
              <span className="font-semibold">{info.plan}</span> plan ·{" "}
              <span className="text-sub">
                {info.limits.strongPerHour} answers · {info.limits.cheapPerHour} cards /h
              </span>
            </p>
            {info.plan === "free" && (
              <p className="mt-1 text-[12px] text-sub">
                plus (higher limits, no key needed) — coming soon. today: add your own key below.
              </p>
            )}
          </div>

          {/* BYOK */}
          <div>
            {info.byokProvider ? (
              <p>
                your {info.byokProvider} key is connected — calls run on your account.
                <button onClick={removeKey} disabled={busy} className="ml-2 text-accent transition-opacity duration-150 hover:opacity-70">
                  remove
                </button>
              </p>
            ) : info.byokAvailable ? (
              <div className="flex flex-col gap-2">
                <p className="text-sub">your own API key — unlocks the highest limits, billed to you, stored encrypted:</p>
                <div className="flex gap-3 text-[12px]">
                  {(["gemini", "openai", "anthropic"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setProvider(p)}
                      className={`transition-opacity duration-150 ${provider === p ? "font-semibold text-accent" : "text-sub hover:opacity-70"}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (keyInput.trim().length >= 8) saveKey();
                  }}
                >
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={`${provider} API key`}
                    className="w-full rounded bg-page px-2.5 py-1.5 text-[16px] outline-none placeholder:text-sub md:text-[12px]"
                  />
                  <button type="submit" disabled={busy || keyInput.trim().length < 8} className="text-accent transition-opacity duration-150 hover:opacity-70 disabled:opacity-30">
                    save
                  </button>
                </form>
              </div>
            ) : (
              <p className="text-[12px] text-sub">bring-your-own-key is not enabled on this deployment.</p>
            )}
          </div>

          {/* data */}
          <div>
            <p className="text-sub">
              recorded: {info.sessions} threads · {info.events} exploration events
            </p>
            {confirmErase ? (
              <p className="mt-1">
                erase everything? this can’t be undone.
                <button onClick={eraseData} disabled={busy} className="ml-2 text-accent transition-opacity duration-150 hover:opacity-70">
                  yes, erase
                </button>
                <button onClick={() => setConfirmErase(false)} className="ml-3 text-sub transition-opacity duration-150 hover:opacity-70">
                  keep
                </button>
              </p>
            ) : (
              <button onClick={() => setConfirmErase(true)} className="mt-1 text-sub underline-offset-2 transition-opacity duration-150 hover:opacity-70">
                erase my exploration history
              </button>
            )}
          </div>

          {note && <p className="text-[12px] text-accent">{note}</p>}

          <button onClick={signOut} className="self-start text-sub transition-opacity duration-150 hover:opacity-70">
            sign out
          </button>
        </div>
      )}
    </div>
  );
}
