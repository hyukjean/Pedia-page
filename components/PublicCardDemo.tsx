"use client";

import { useCallback, useEffect, useState } from "react";

// The shared page teaches the gesture. A few seconds in, the same phantom
// drag sweeps a phrase; and a real selection offers one action that drops
// the visitor into the live runtime with their selection already becoming
// a card (/?q=…&sel=…). The first drag *is* the onboarding.

interface Pending {
  text: string;
  x: number;
  top: number;
  bottom: number;
  align: "left" | "right";
}

export default function PublicCardDemo({ question }: { question: string }) {
  const [coarse, setCoarse] = useState(false);
  const [demoRect, setDemoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ask, setAsk] = useState("");

  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Phantom drag, once, 2.8s after arrival.
  useEffect(() => {
    const t = setTimeout(() => {
      if (window.getSelection()?.isCollapsed === false) return;
      const paras = document.querySelectorAll<HTMLParagraphElement>("#public-card p");
      const p = paras[1] ?? paras[0];
      const tn = p?.firstChild;
      if (!(tn instanceof Text) || (tn.textContent?.length ?? 0) < 24) return;
      const text = tn.textContent!;
      let end = Math.min(26, text.length);
      const space = text.lastIndexOf(" ", end);
      if (space > 10) end = space;
      const range = document.createRange();
      range.setStart(tn, 0);
      range.setEnd(tn, end);
      const r = range.getBoundingClientRect();
      if (r.width < 40) return;
      setDemoRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      window.setTimeout(() => setDemoRect(null), 2650);
    }, 2800);
    return () => clearTimeout(t);
  }, []);

  // Real selection → one-action popover.
  const readSelection = useCallback((): Pending | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 300) return null;
    const anchor = sel.anchorNode;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    if (!el?.closest("#public-card")) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    let backward = false;
    if (sel.focusNode) {
      const cmp = sel.anchorNode!.compareDocumentPosition(sel.focusNode);
      backward = cmp === 0 ? sel.anchorOffset > sel.focusOffset : Boolean(cmp & Node.DOCUMENT_POSITION_PRECEDING);
    }
    return {
      text,
      x: backward ? rect.left : rect.right,
      top: rect.top,
      bottom: rect.bottom,
      align: backward ? "left" : "right",
    };
  }, []);

  useEffect(() => {
    const onMouseUp = () => setPending(readSelection());
    let t: number | undefined;
    const onSelChange = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const p = readSelection();
        if (p) setPending(p);
      }, 550);
    };
    const clear = () => setPending(null);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("selectionchange", onSelChange);
    window.addEventListener("scroll", clear, { passive: true, capture: true });
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("selectionchange", onSelChange);
      window.removeEventListener("scroll", clear, { capture: true });
      window.clearTimeout(t);
    };
  }, [readSelection]);

  const explore = useCallback(() => {
    if (!pending) return;
    window.location.href = `/?q=${encodeURIComponent(question)}&sel=${encodeURIComponent(pending.text)}`;
  }, [pending, question]);

  return (
    <>
      {/* The same glass bar as the live app: a typed question drops the
          visitor into the runtime with their question already becoming
          a card on this thread. */}
      <form
        className="fixed inset-x-3 bottom-[max(0.8rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-[600px]"
        onSubmit={(e) => {
          e.preventDefault();
          const q = ask.trim();
          if (!q) return;
          window.location.href = `/?q=${encodeURIComponent(question)}&ask=${encodeURIComponent(q)}`;
        }}
      >
        <div className="pedia-input pedia-glass relative rounded-full">
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="ask a follow-up — it opens the live thread"
            className="w-full rounded-full bg-transparent px-4.5 py-2.5 pr-12 text-[16px] outline-none placeholder:text-sub md:text-[14px]"
          />
          <button
            type="submit"
            disabled={!ask.trim()}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-white transition-opacity duration-150 disabled:opacity-25"
          >
            →
          </button>
        </div>
      </form>

      {demoRect && (
        <div
          className="pointer-events-none fixed z-20"
          style={{ left: demoRect.x, top: demoRect.y, width: demoRect.w, height: demoRect.h }}
        >
          <div
            className="h-full w-full rounded-[2px]"
            style={{
              background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
              transformOrigin: "left center",
              animation: "pedia-drag-demo 2600ms ease-in-out forwards",
            }}
          />
          <div
            className={`absolute right-0 flex items-stretch overflow-hidden rounded bg-accent text-[13px] font-semibold leading-none text-white ${
              coarse ? "-bottom-2.5 translate-y-full" : "-top-2 -translate-y-full"
            }`}
            style={{ opacity: 0, animation: "pedia-demo-popover 2600ms ease-in-out forwards" }}
          >
            <span className="px-2.5 py-1.5">+</span>
            <span className="my-1.5 w-px bg-white opacity-30" />
            <span className="px-2.5 py-1.5">?</span>
          </div>
        </div>
      )}

      {pending && (
        <div
          className={`pedia-in fixed z-30 flex ${coarse ? "" : "-translate-y-full"} ${
            pending.align === "right" ? "-translate-x-full" : ""
          }`}
          style={{ left: pending.x, top: coarse ? pending.bottom + 28 : pending.top - 8 }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              explore();
            }}
            className="rounded bg-accent px-4 py-2.5 text-[16px] font-semibold leading-none text-white transition-opacity duration-150 hover:opacity-80 active:opacity-70"
          >
            ?
          </button>
        </div>
      )}
    </>
  );
}
