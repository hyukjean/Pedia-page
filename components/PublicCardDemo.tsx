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
            className={`absolute right-0 flex items-center overflow-hidden rounded bg-accent px-2.5 py-1.5 text-[13px] font-semibold leading-none text-white ${
              coarse ? "-bottom-2.5 translate-y-full" : "-top-2 -translate-y-full"
            }`}
            style={{ opacity: 0, animation: "pedia-demo-popover 2600ms ease-in-out forwards" }}
          >
            ? card
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
            className="rounded bg-accent px-3.5 py-2.5 text-[13px] font-semibold leading-none text-white transition-opacity duration-150 hover:opacity-80 active:opacity-70"
          >
            ? open this as a card →
          </button>
        </div>
      )}
    </>
  );
}
