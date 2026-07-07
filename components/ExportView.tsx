"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The compiled story: one overlay, organically connected — the essay above,
// and (when playing) a lyrics-style reel in the bottom of the same view.
// No separate tab, no full-screen takeover: Spotify-lyrics mechanics —
// current line bold, neighbors faded and small, scrollable, tap to seek.

export interface ReelFrame {
  text: string;
  sec: number;
}

// ── Minimal markdown (headings, lists, bold) — enough for the essay ──
function inline(s: string): React.ReactNode[] {
  return s.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : part));
}

function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  const blocks = text.split(/\n\n+/).filter((b) => b.trim());
  return (
    <>
      {blocks.map((b, i) => {
        const caret = streaming && i === blocks.length - 1 ? " pedia-caret" : "";
        const t = b.trim();
        if (t.startsWith("### ")) return <h3 key={i} className={`mb-2 mt-7 text-[16px] font-semibold${caret}`}>{inline(t.slice(4))}</h3>;
        if (t.startsWith("## ")) return <h2 key={i} className={`mb-3 mt-9 text-[18px] font-semibold${caret}`}>{inline(t.slice(3))}</h2>;
        if (t.startsWith("# ")) return <h1 key={i} className={`mb-6 text-[24px] font-semibold leading-snug${caret}`}>{inline(t.slice(2))}</h1>;
        if (/^[-*] /.test(t)) {
          const items = t.split("\n").filter((l) => /^[-*] /.test(l.trim()));
          return (
            <ul key={i} className={`mb-4 flex list-disc flex-col gap-1 pl-5 text-[16px] leading-[1.75]${caret}`}>
              {items.map((l, j) => <li key={j}>{inline(l.trim().slice(2))}</li>)}
            </ul>
          );
        }
        return <p key={i} className={`mb-4 text-[16px] leading-[1.8]${caret}`}>{inline(t)}</p>;
      })}
    </>
  );
}

// ── Lyrics-style reel: bottom of the same view ───────────────
function LyricsReel({ frames, onClose }: { frames: ReelFrame[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [tts, setTts] = useState(false);
  const ttsAvailable = typeof window !== "undefined" && "speechSynthesis" in window;
  const listRef = useRef<HTMLDivElement>(null);
  const lastManualScroll = useRef(0);
  const programmatic = useRef(false);

  const total = useMemo(() => frames.reduce((s, f) => s + f.sec, 0), [frames]);

  const advance = useCallback(() => {
    setIdx((i) => {
      if (i >= frames.length - 1) {
        setPlaying(false);
        setEnded(true);
        return i;
      }
      return i + 1;
    });
  }, [frames.length]);

  // Playback clock: timer normally; when voice is on, the utterance IS the
  // clock — the line advances when the browser finishes speaking it.
  useEffect(() => {
    if (!playing) {
      if (ttsAvailable) window.speechSynthesis.cancel();
      return;
    }
    if (tts && ttsAvailable) {
      const u = new SpeechSynthesisUtterance(frames[idx].text);
      u.lang = /[가-힯]/.test(frames[idx].text) ? "ko-KR" : "en-US";
      u.rate = 1.05;
      u.onend = advance;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      return () => window.speechSynthesis.cancel();
    }
    const t = setTimeout(advance, Math.min(Math.max(frames[idx].sec, 2), 8) * 1000);
    return () => clearTimeout(t);
  }, [idx, playing, tts, ttsAvailable, frames, advance]);

  // Keep the current line vertically centered — unless the user just
  // scrolled by hand (Spotify behavior: snap back after a beat of idle).
  useEffect(() => {
    const c = listRef.current;
    const el = document.getElementById(`lyric-${idx}`);
    if (!c || !el) return;
    if (Date.now() - lastManualScroll.current < 2500) return;
    programmatic.current = true;
    c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
    const t = setTimeout(() => (programmatic.current = false), 700);
    return () => clearTimeout(t);
  }, [idx]);

  const seek = useCallback((i: number) => {
    lastManualScroll.current = 0; // seeking recenters immediately
    setEnded(false);
    setIdx(i);
    setPlaying(true);
  }, []);

  // Desktop transport: ← → seek, space toggles play.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(Math.min(idx + 1, frames.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(idx - 1, 0));
      } else if (e.key === " ") {
        e.preventDefault();
        if (ended) seek(0);
        else setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, ended, frames.length, seek]);

  return (
    <div className="pedia-in fixed inset-x-0 bottom-0 z-50 h-[38vh] rounded-t bg-surface">
      <div className="mx-auto flex h-full max-w-[640px] flex-col px-6">
        <div className="flex items-center justify-between py-3 text-[12px] text-sub">
          <div className="flex items-center gap-4">
            {ended ? (
              <button onClick={() => seek(0)} className="text-accent transition-opacity duration-150 hover:opacity-70">
                ↺ replay
              </button>
            ) : (
              <button
                onClick={() => setPlaying((p) => !p)}
                className="text-accent transition-opacity duration-150 hover:opacity-70"
              >
                {playing ? "⏸ pause" : "▶ play"}
              </button>
            )}
            {ttsAvailable && (
              <button
                onClick={() => setTts((v) => !v)}
                className={`transition-opacity duration-150 hover:opacity-70 ${tts ? "text-accent" : "text-sub opacity-70"}`}
              >
                voice {tts ? "on" : "off"}
              </button>
            )}
          </div>
          <span className="opacity-70">
            {idx + 1} / {frames.length} · {total}s
          </span>
          <button onClick={onClose} className="text-[15px] leading-none transition-opacity duration-150 hover:opacity-60">
            ×
          </button>
        </div>

        <div
          ref={listRef}
          onScroll={() => {
            if (!programmatic.current) lastManualScroll.current = Date.now();
          }}
          className="flex-1 overflow-y-auto"
        >
          <div className="flex flex-col gap-3.5 py-[16vh]">
            {frames.map((f, i) => (
              <button
                key={i}
                id={`lyric-${i}`}
                onClick={() => seek(i)}
                className={`text-left leading-snug ${
                  i === idx
                    ? "text-[19px] font-semibold text-ink"
                    : "pedia-invite text-[14px] text-sub opacity-45 hover:opacity-90"
                }`}
              >
                {f.text}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The overlay ──────────────────────────────────────────────
export default function ExportView({
  md,
  streaming,
  reel,
  question,
  level,
  onRetell,
  onClose,
}: {
  md: string;
  streaming: boolean;
  reel: ReelFrame[] | null;
  question: string;
  level: "standard" | "easy";
  onRetell: (level: "standard" | "easy") => void;
  onClose: () => void;
}) {
  const [showReel, setShowReel] = useState(false);

  // Escape peels layers off: reel first, then the overlay itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setShowReel((open) => {
        if (!open) onClose();
        return false;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = useCallback(() => {
    const title = md.match(/^# (.+)$/m)?.[1] ?? question;
    const name = title
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name || "pedia-thread"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [md, question]);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-white">
      <div className={`mx-auto max-w-[640px] px-6 py-14 ${showReel ? "pb-[42vh]" : ""}`}>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-[13px]">
          <button onClick={onClose} className="text-sub transition-opacity duration-150 hover:opacity-60">
            ← back to the thread
          </button>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {!streaming && md && (
              <button
                onClick={() => onRetell(level === "easy" ? "standard" : "easy")}
                className="text-sub transition-opacity duration-150 hover:opacity-60"
              >
                retell in {level === "easy" ? "standard" : "easy"} →
              </button>
            )}
            {reel && reel.length > 1 && !streaming && !showReel && (
              <button onClick={() => setShowReel(true)} className="pedia-lift text-accent">
                ▶ play as a reel ({reel.reduce((s, f) => s + f.sec, 0)}s)
              </button>
            )}
            {!streaming && md && (
              <button onClick={download} className="pedia-lift text-accent">
                ↓ download .md
              </button>
            )}
          </div>
        </div>

        {streaming && !md && <p className="text-[14px] text-sub">compiling your path into one story…</p>}
        <article>
          <Markdown text={md} streaming={streaming} />
        </article>
      </div>

      {showReel && reel && <LyricsReel frames={reel} onClose={() => setShowReel(false)} />}
    </div>
  );
}
