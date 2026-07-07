"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamRequest } from "@/lib/client";
import ThreadMap from "@/components/ThreadMap";
import AuthCorner, { useUser } from "@/components/AuthCorner";
import ExportView, { ReelFrame } from "@/components/ExportView";

// ─────────────────────────────────────────────────────────────
// The runtime for parallel knowledge exploration. The user never
// leaves this page: root answer left, derived cards right (bottom
// sheet on mobile), thread map bottom-left. No chat, no history.
// ─────────────────────────────────────────────────────────────

export const MAX_DEPTH = 6;

export interface Node {
  id: string;
  parentId: string | null;
  depth: number; // root = 0
  kind: "root" | "drag" | "question"; // how this node came to exist
  label: string; // question (root) or selected fragment (card)
  sourceContext?: string; // the paragraph the selection came from — kept for retry
  content: string;
  streaming: boolean;
  bedrock: boolean;
  bedrockTrace: string | null;
  cache: "exact" | "semantic" | null;
  mock: boolean;
  error: string | null;
}

// Multilingual pool — 4 are drawn at random per visit. The mix itself is
// the message: ask in any language, the answer follows your language.
const SUGGESTION_POOL = [
  "Why can't anything travel faster than light?",
  "엔트로피는 왜 항상 증가하는가?",
  "돈은 어떻게 가치를 갖게 되는가?",
  "왜 우리는 잠을 자야 하는가?",
  "What is entropy, really?",
  "なぜ素数は無限に存在するのか?",
  "为什么时间只朝一个方向流动?",
  "Warum können wir uns nicht selbst kitzeln?",
  "Pourquoi le ciel est-il bleu ?",
  "Why do transformer models hallucinate?",
];

/** Touch device? Selection mechanics and popover placement differ. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  return coarse;
}

function draw4(): string[] {
  const pool = [...SUGGESTION_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 4);
}

const ROOT_ID = "root";

export default function Workspace({
  initialQuestion,
  initialSelection = null,
}: {
  initialQuestion: string | null;
  initialSelection?: string | null;
}) {
  const [phase, setPhase] = useState<"landing" | "session">("landing");
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [nodes, setNodes] = useState<Record<string, Node>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [chips, setChips] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>(ROOT_ID);
  const [notice, setNotice] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(false);
  const [rootSlug, setRootSlug] = useState("");
  const [synthesis, setSynthesis] = useState<{ status: "idle" | "streaming" | "done"; text: string }>({
    status: "idle",
    text: "",
  });
  const [showSynthesis, setShowSynthesis] = useState(false);
  const bootRef = useRef(false);

  // Signed-in users get their trajectory saved server-side and, in return,
  // landing suggestions grown from where their curiosity actually went.
  const { user } = useUser();
  const sessionRef = useRef<string>("");
  const [suggestions, setSuggestions] = useState<string[]>(SUGGESTION_POOL.slice(0, 4));
  const [personalized, setPersonalized] = useState(false);

  // Shuffle client-side only — a random SSR pick would break hydration.
  useEffect(() => {
    setSuggestions(draw4());
  }, []);

  // Refetched every time the landing is shown: exploring changes the event
  // count, and the server regenerates only then — idle returns are free.
  useEffect(() => {
    if (!user || phase !== "landing") {
      if (!user) setPersonalized(false);
      return;
    }
    let alive = true;
    fetch("/api/recommend")
      .then((r) => r.json())
      .then((d: { suggestions?: string[] | null }) => {
        if (alive && Array.isArray(d.suggestions) && d.suggestions.length) {
          setSuggestions(d.suggestions);
          setPersonalized(true);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user, phase]);

  const patchNode = useCallback((id: string, patch: Partial<Node> | ((n: Node) => Partial<Node>)) => {
    setNodes((prev) => {
      const n = prev[id];
      if (!n) return prev;
      return { ...prev, [id]: { ...n, ...(typeof patch === "function" ? patch(n) : patch) } };
    });
  }, []);

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 4000);
  }, []);

  // ── Root answer ────────────────────────────────────────────
  const ask = useCallback(
    (raw: string) => {
      const q = raw.trim();
      if (!q) return;
      sessionRef.current = crypto.randomUUID();
      setQuestion(q);
      setPhase("session");
      setChips([]);
      setActiveId(ROOT_ID);
      setSynthesis({ status: "idle", text: "" });
      setShowSynthesis(false);
      setExportState({ status: "idle", level: "easy", md: "", reel: null });
      setShowExport(false);
      setDemoPlayed(false);
      setDemoRect(null);
      setRootSlug("");
      const root: Node = {
        id: ROOT_ID,
        parentId: null,
        depth: 0,
        kind: "root",
        label: q,
        content: "",
        streaming: true,
        bedrock: false,
        bedrockTrace: null,
        cache: null,
        mock: false,
        error: null,
      };
      setNodes({ [ROOT_ID]: root });
      setOrder([ROOT_ID]);

      streamRequest("/api/answer", { question: q, sessionId: sessionRef.current }, {
        onHeaders: (h) => {
          const c = h.get("x-pedia-cache");
          patchNode(ROOT_ID, {
            cache: c === "exact" || c === "semantic" ? c : null,
            mock: h.get("x-pedia-mock") === "1",
          });
          if (h.get("x-pedia-mock") === "1") setMockMode(true);
          const s = h.get("x-pedia-slug");
          if (s) setRootSlug(decodeURIComponent(s));
        },
        onText: (t) => patchNode(ROOT_ID, (n) => ({ content: n.content + t })),
        onMeta: (meta) => {
          const c = Array.isArray(meta.chips) ? (meta.chips as unknown[]).map(String).slice(0, 4) : [];
          setChips(c);
        },
        onDone: (prose) => patchNode(ROOT_ID, { content: prose, streaming: false }),
        onError: (e) => patchNode(ROOT_ID, { streaming: false, error: e }),
      });
    },
    [patchNode],
  );

  // ── Knowledge card derivation ──────────────────────────────
  // kind "drag": text selected inside a node. kind "question": typed into
  // the follow-up input — same tree, same card API, different prompt frame.
  const cardStreamCallbacks = useCallback(
    (id: string) => ({
      onHeaders: (h: Headers) => {
        const c = h.get("x-pedia-cache");
        patchNode(id, {
          cache: c === "exact" || c === "semantic" ? c : null,
          mock: h.get("x-pedia-mock") === "1",
        });
      },
      onText: (t: string) => patchNode(id, (n) => ({ content: n.content + t })),
      onMeta: (meta: Record<string, unknown>) =>
        patchNode(id, {
          bedrock: meta.bedrock === true,
          bedrockTrace: typeof meta.bedrock_trace === "string" ? meta.bedrock_trace : null,
        }),
      onDone: (prose: string) => patchNode(id, { content: prose, streaming: false }),
      onError: (e: string) => patchNode(id, { streaming: false, error: e }),
    }),
    [patchNode],
  );

  const derive = useCallback(
    (parentId: string, selection: string, context: string, kind: "drag" | "question" = "drag") => {
      const parent = nodes[parentId];
      if (!parent) return;
      const depth = parent.depth + 1;
      if (depth > MAX_DEPTH) {
        flashNotice(`Depth limit (${MAX_DEPTH}) reached — the map is your way back up.`);
        return;
      }
      // Same fragment under the same parent → refocus, don't refetch
      // (unless that attempt errored — then a fresh derive is wanted).
      const dup = order.find(
        (id) => nodes[id]?.parentId === parentId && nodes[id]?.label === selection && !nodes[id]?.error,
      );
      if (dup) {
        setActiveId(dup);
        return;
      }

      // Path of concepts from just below the root down to the parent.
      const path: string[] = [];
      for (let n: Node | undefined = parent; n && n.parentId !== null; n = nodes[n.parentId!]) {
        path.unshift(n.label);
      }

      const id = crypto.randomUUID();
      const card: Node = {
        id,
        parentId,
        depth,
        kind,
        label: selection,
        sourceContext: context,
        content: "",
        streaming: true,
        bedrock: false,
        bedrockTrace: null,
        cache: null,
        mock: false,
        error: null,
      };
      setNodes((prev) => ({ ...prev, [id]: card }));
      setOrder((prev) => [...prev, id]);
      setActiveId(id);

      streamRequest(
        "/api/card",
        { selection, context, rootQuestion: question, path, depth, kind, sessionId: sessionRef.current },
        cardStreamCallbacks(id),
      );
    },
    [nodes, order, question, patchNode, flashNotice, cardStreamCallbacks],
  );

  // Retry a failed node in place — root re-asks, cards re-stream into
  // the same node using the context they were born from.
  const retryNode = useCallback(
    (id: string) => {
      const n = nodes[id];
      if (!n || n.streaming) return;
      if (id === ROOT_ID) {
        ask(question);
        return;
      }
      const parent = n.parentId ? nodes[n.parentId] : undefined;
      const path: string[] = [];
      for (let cur = parent; cur && cur.parentId !== null; cur = nodes[cur.parentId!]) {
        path.unshift(cur.label);
      }
      patchNode(id, { streaming: true, error: null, content: "", bedrock: false, bedrockTrace: null });
      streamRequest(
        "/api/card",
        {
          selection: n.label,
          context: n.sourceContext ?? parent?.content.slice(0, 1200) ?? "",
          rootQuestion: question,
          path,
          depth: n.depth,
          kind: n.kind === "question" ? "question" : "drag",
          sessionId: sessionRef.current,
        },
        cardStreamCallbacks(id),
      );
    },
    [nodes, question, ask, patchNode, cardStreamCallbacks],
  );

  // Focus a node: expand its card and bring it into view.
  const focusNode = useCallback((id: string) => {
    setActiveId(id);
    requestAnimationFrame(() => {
      document.getElementById(`card-${id}`)?.scrollIntoView({ block: "nearest" });
    });
  }, []);

  // ── Follow-up question → card (the second gesture) ─────────
  // Not a chatbot: the question joins the tree as a card derived from
  // whatever the user is currently reading (active card, else root).
  const [followInput, setFollowInput] = useState("");
  const askFollowUp = useCallback(() => {
    const q = followInput.trim();
    if (!q) return;
    const host = nodes[activeId] ?? nodes[ROOT_ID];
    if (!host || host.streaming) return;
    setFollowInput("");
    derive(host.id, q, host.content.slice(0, 1200), "question");
  }, [followInput, nodes, activeId, derive]);

  // ── Selection → popover (the core gesture) ─────────────────
  // A drag doesn't act immediately: two tiny choices appear above it.
  // “?” opens the fragment as a card; “+” quotes it into the follow-up
  // question input. Deciding beats guessing.
  const coarse = useCoarsePointer();
  const [pendingSel, setPendingSel] = useState<{
    nodeId: string;
    text: string;
    context: string;
    x: number;
    top: number;
    bottom: number;
    /** which corner of the selection the popover hugs — where the cursor ended */
    align: "left" | "right";
  } | null>(null);

  // Read the live selection into a popover candidate; null when invalid.
  const selectionToPending = useCallback((): typeof pendingSel => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (text.length < 2 || text.length > 300) return null;
    const anchor = sel.anchorNode;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    const host = el?.closest("[data-node-id]");
    if (!host) return null;
    const nodeId = host.getAttribute("data-node-id")!;
    const para = el?.closest("p")?.textContent ?? nodes[nodeId]?.content.slice(0, 1200) ?? "";
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    // The popover meets the cursor where the drag ended: forward drag →
    // right corner of the selection, backward drag → left.
    let backward = false;
    if (sel.focusNode) {
      const cmp = sel.anchorNode!.compareDocumentPosition(sel.focusNode);
      backward = cmp === 0 ? sel.anchorOffset > sel.focusOffset : Boolean(cmp & Node.DOCUMENT_POSITION_PRECEDING);
    }
    return {
      nodeId,
      text,
      context: para,
      x: backward ? rect.left : rect.right,
      top: rect.top,
      bottom: rect.bottom,
      align: backward ? "left" : "right",
    };
  }, [nodes]);

  const handleMouseUp = useCallback(() => {
    setPendingSel(selectionToPending());
  }, [selectionToPending]);

  // Touch path: long-press selection never fires mouseup, so listen to
  // selectionchange and settle 550ms after the handles stop moving. Never
  // clears here — dismissal stays with taps (mouseup) and scroll.
  useEffect(() => {
    if (phase !== "session") return;
    let t: number | undefined;
    const onSel = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const p = selectionToPending();
        if (p) setPendingSel(p);
      }, 550);
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      document.removeEventListener("selectionchange", onSel);
      window.clearTimeout(t);
    };
  }, [phase, selectionToPending]);

  // The popover is viewport-fixed; scrolling would detach it from the text.
  useEffect(() => {
    if (!pendingSel) return;
    const clear = () => setPendingSel(null);
    window.addEventListener("scroll", clear, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", clear, { capture: true });
  }, [pendingSel]);

  const popoverCard = useCallback(() => {
    if (!pendingSel) return;
    window.getSelection()?.removeAllRanges();
    derive(pendingSel.nodeId, pendingSel.text, pendingSel.context);
    setPendingSel(null);
  }, [pendingSel, derive]);

  const popoverQuote = useCallback(() => {
    if (!pendingSel) return;
    window.getSelection()?.removeAllRanges();
    setFollowInput((prev) => `${prev ? prev.trimEnd() + " " : ""}“${pendingSel.text}” `);
    if (pendingSel.nodeId !== activeId) focusNode(pendingSel.nodeId);
    setPendingSel(null);
    requestAnimationFrame(() => document.getElementById("follow-input")?.focus());
  }, [pendingSel, activeId, focusNode]);

  // ── Thread export: the session compiled into one story ─────
  const [exportState, setExportState] = useState<{
    status: "idle" | "choosing" | "streaming" | "done";
    level: "standard" | "easy";
    md: string;
    reel: ReelFrame[] | null;
  }>({ status: "idle", level: "easy", md: "", reel: null });
  const [showExport, setShowExport] = useState(false);

  const runExport = useCallback(
    (level: "standard" | "easy") => {
      const payload = {
        question,
        level: level === "easy" ? "easy" : "standard",
        sessionId: sessionRef.current,
        nodes: order
          .map((id) => nodes[id])
          .filter((n): n is Node => Boolean(n && n.content && !n.streaming))
          .map((n) => ({
            label: n.label,
            kind: n.kind,
            depth: n.depth,
            parent: n.parentId ? nodes[n.parentId]?.label ?? null : null,
            bedrock: n.bedrock,
            content: n.content,
          })),
      };
      setExportState({ status: "streaming", level, md: "", reel: null });
      setShowExport(true);
      streamRequest("/api/export", payload, {
        onText: (t) => setExportState((s) => ({ ...s, md: s.md + t })),
        onMeta: (meta) => {
          const frames = Array.isArray(meta.reel)
            ? (meta.reel as unknown[])
                .map((f) => {
                  const o = (f ?? {}) as Record<string, unknown>;
                  return { text: String(o.text ?? "").trim(), sec: Math.min(Math.max(Number(o.sec) || 4, 2), 8) };
                })
                .filter((f) => f.text)
                .slice(0, 20)
            : null;
          setExportState((s) => ({ ...s, reel: frames && frames.length > 1 ? frames : null }));
        },
        onDone: (md) => setExportState((s) => ({ ...s, status: "done", md })),
        onError: () => {
          setExportState({ status: "idle", level, md: "", reel: null });
          setShowExport(false);
          flashNotice("export failed — try again.");
        },
      });
    },
    [question, order, nodes, flashNotice],
  );

  // ── Refresh survival (not history — the anti-goal stands) ──
  // The live thread is mirrored to sessionStorage, which dies with the
  // tab. An accidental reload offers one quiet way back; nothing persists
  // beyond the browsing session, nothing is listed, nothing accumulates.
  const [resume, setResume] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "session" || !question) return;
    try {
      sessionStorage.setItem(
        "pedia-thread",
        JSON.stringify({ question, nodes, order, chips, activeId, rootSlug, sessionId: sessionRef.current }),
      );
    } catch {}
  }, [phase, question, nodes, order, chips, activeId, rootSlug]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("pedia-thread");
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d?.question && d?.nodes?.[ROOT_ID]) setResume(String(d.question));
    } catch {}
  }, []);

  const restoreThread = useCallback(() => {
    try {
      const d = JSON.parse(sessionStorage.getItem("pedia-thread")!);
      const restored: Record<string, Node> = {};
      for (const [id, n] of Object.entries(d.nodes as Record<string, Node>)) {
        // A node caught mid-stream by the reload becomes a retryable error.
        restored[id] = {
          ...n,
          streaming: false,
          error: n.streaming && !n.content ? "interrupted by reload" : n.error,
        };
      }
      sessionRef.current = typeof d.sessionId === "string" ? d.sessionId : crypto.randomUUID();
      setQuestion(d.question);
      setNodes(restored);
      setOrder(Array.isArray(d.order) ? d.order : [ROOT_ID]);
      setChips(Array.isArray(d.chips) ? d.chips : []);
      setActiveId(typeof d.activeId === "string" && restored[d.activeId] ? d.activeId : ROOT_ID);
      setRootSlug(typeof d.rootSlug === "string" ? d.rootSlug : "");
      setSynthesis({ status: "idle", text: "" });
      setShowSynthesis(false);
      setExportState({ status: "idle", level: "easy", md: "", reel: null });
      setShowExport(false);
      setPhase("session");
    } catch {
      setResume(null);
    }
  }, []);

  // "/" focuses the follow-up input from anywhere in a session.
  useEffect(() => {
    if (phase !== "session") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      document.getElementById("follow-input")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // A drag carried over from a public card page (/?q=…&sel=…): the moment
  // the root answer settles, that selection becomes the first card — the
  // visitor's gesture on the shared page completes inside the runtime.
  const selConsumed = useRef(false);
  useEffect(() => {
    if (!initialSelection || selConsumed.current) return;
    const root = nodes[ROOT_ID];
    if (phase !== "session" || !root?.content || root.streaming) return;
    selConsumed.current = true;
    const para = root.content.split(/\n\n+/).find((p) => p.includes(initialSelection)) ?? root.content.slice(0, 1200);
    derive(ROOT_ID, initialSelection, para);
  }, [initialSelection, phase, nodes, derive]);

  // ── Drag demo ──────────────────────────────────────────────
  // Once, ~2.8s after the first answer settles and only while nothing has
  // been derived: a phantom selection sweeps across a real phrase in the
  // answer and fades — the gesture demonstrated, not described. Language-
  // free by construction.
  const [demoRect, setDemoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [demoPlayed, setDemoPlayed] = useState(false);
  const rootSettled = phase === "session" && !!nodes[ROOT_ID]?.content && !nodes[ROOT_ID]?.streaming;
  const hasCards = order.length > 1;
  useEffect(() => {
    if (!rootSettled || hasCards || demoPlayed) return;
    const t = setTimeout(() => {
      setDemoPlayed(true);
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // they already found the gesture
      const paras = document.querySelectorAll<HTMLParagraphElement>(`[data-node-id="${ROOT_ID}"] p`);
      const p = paras[1] ?? paras[0];
      const tn = p?.firstChild;
      if (!(tn instanceof Text) || (tn.textContent?.length ?? 0) < 24) return;
      const text = tn.textContent!;
      let end = Math.min(26, text.length);
      const space = text.lastIndexOf(" ", end); // end on a word boundary when possible
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
  }, [rootSettled, hasCards, demoPlayed]);

  // ── Synthesis Return ───────────────────────────────────────
  const cardIds = order.filter((id) => id !== ROOT_ID);
  const canSynthesize = cardIds.length >= 3 && !nodes[ROOT_ID]?.streaming;

  const runSynthesis = useCallback(() => {
    if (synthesis.status === "streaming") return;
    if (synthesis.status === "done") {
      setShowSynthesis((v) => !v);
      return;
    }
    setSynthesis({ status: "streaming", text: "" });
    setShowSynthesis(true);
    const concepts = cardIds
      .map((id) => nodes[id])
      .filter((n): n is Node => Boolean(n && n.content))
      .map((n) => ({
        term: n.label,
        gist: n.content.split(/(?<=[.!?。．])\s/)[0]?.slice(0, 240) ?? "",
      }));
    streamRequest(
      "/api/synthesis",
      { question, answer: nodes[ROOT_ID]?.content ?? "", concepts, sessionId: sessionRef.current },
      {
        onText: (t) => setSynthesis((s) => ({ ...s, text: s.text + t })),
        onDone: (prose) => setSynthesis({ status: "done", text: prose }),
        onError: () => {
          setSynthesis({ status: "idle", text: "" });
          setShowSynthesis(false);
          flashNotice("Synthesis failed — try again.");
        },
      },
    );
  }, [cardIds, nodes, question, synthesis.status, flashNotice]);

  // Auto-ask when arriving via /?q=…
  useEffect(() => {
    if (initialQuestion && !bootRef.current) {
      bootRef.current = true;
      ask(initialQuestion);
    }
  }, [initialQuestion, ask]);

  // ───────────────────────────────────────────────────────────
  if (phase === "landing") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-[560px] px-6">
          <p className="mb-10 text-center text-[15px] font-semibold tracking-tight">
            pedia<span className="text-accent">.</span>page
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything"
              className="w-full rounded bg-surface px-4 py-3 text-[16px] outline-none placeholder:text-sub"
            />
          </form>
          <div className="mt-8 flex flex-col gap-2.5">
            {personalized && (
              <span className="text-[11px] text-sub opacity-70">from what you&apos;ve been exploring</span>
            )}
            {suggestions.map((s, i) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="pedia-in pedia-invite text-left text-[14px] text-ink opacity-45 hover:opacity-100"
                style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
              >
                {s}
              </button>
            ))}
          </div>
          {resume && (
            <button
              onClick={restoreThread}
              className="pedia-invite mt-9 block text-[13px] text-sub opacity-70 hover:opacity-100"
            >
              continue where you left off — “{resume.slice(0, 42)}
              {resume.length > 42 ? "…" : ""}” →
            </button>
          )}
        </div>
        <AuthCorner user={user} />
      </div>
    );
  }

  const root = nodes[ROOT_ID];
  const activeNode = nodes[activeId];
  const rootParagraphs = (showSynthesis ? synthesis.text : root?.content ?? "")
    .split(/\n\n+/)
    .filter(Boolean);

  return (
    <div className="min-h-screen" onMouseUp={handleMouseUp}>
      <div className="mx-auto flex max-w-[1200px] gap-12 px-6 py-14 max-md:pb-[45vh]">
        {/* ── Root column ─────────────────────────────────── */}
        <main className="min-w-0 max-w-[640px] flex-1">
          <div className="mb-8 flex items-center justify-between">
            <button
              onClick={() => {
                // Leaving on purpose = done with this thread. The mirror is
                // crash protection, not history — it survives reloads only.
                try {
                  sessionStorage.removeItem("pedia-thread");
                } catch {}
                setResume(null);
                setPhase("landing");
                setInput("");
              }}
              className="text-[12px] text-sub opacity-70 transition-opacity duration-150 hover:opacity-100"
            >
              ← new question
            </button>
            {rootSlug && (
              <button
                onClick={() => {
                  navigator.clipboard
                    .writeText(`${window.location.origin}/c/${encodeURIComponent(rootSlug)}`)
                    .then(() => flashNotice("public link copied — anyone can explore from it"))
                    .catch(() => flashNotice("couldn't copy — is clipboard blocked?"));
                }}
                className="text-[12px] text-sub opacity-70 transition-opacity duration-150 hover:opacity-100"
              >
                share this thread
              </button>
            )}
          </div>

          {/* Synthesis Return — one quiet line, only when earned */}
          {canSynthesize && (
            <button
              onClick={runSynthesis}
              className="pedia-in pedia-invite mb-3 block text-left text-[13px] text-accent opacity-80 hover:opacity-100"
            >
              {synthesis.status === "done"
                ? showSynthesis
                  ? "← back to the original answer"
                  : "re-read the first answer with what you now know →"
                : synthesis.status === "streaming"
                  ? "rewriting…"
                  : "re-read the first answer with the concepts you've explored →"}
            </button>
          )}

          <h1 className="text-[21px] font-semibold leading-snug">{question}</h1>

          <article data-node-id={ROOT_ID} className="mt-6 cursor-text">
            {rootParagraphs.map((p, i) => (
              <p
                key={i}
                className={`mb-4 text-[16px] leading-[1.75] ${
                  showSynthesis && synthesis.status === "streaming" && i === rootParagraphs.length - 1
                    ? "pedia-caret"
                    : ""
                } ${!showSynthesis && root?.streaming && i === rootParagraphs.length - 1 ? "pedia-caret" : ""}`}
              >
                {p}
              </p>
            ))}
            {/* the silence before the first token — OpenAI-style shimmer */}
            {!showSynthesis && root?.streaming && !root.content && (
              <Skeleton lines={[100, 97, 91, 54, 100, 95, 88, 38]} />
            )}
            {showSynthesis && synthesis.status === "streaming" && !synthesis.text && (
              <Skeleton lines={[100, 97, 91, 54, 100, 95, 88, 38]} />
            )}
            {root?.error && (
              <p className="text-[14px] text-sub">
                {root.error}
                <button
                  onClick={() => retryNode(ROOT_ID)}
                  className="ml-3 text-accent transition-opacity duration-150 hover:opacity-70"
                >
                  retry →
                </button>
              </p>
            )}
          </article>

          {/* Concept chips — extracted in the same call as the answer */}
          {!showSynthesis && chips.length > 0 && (
            <div className="pedia-in mt-6 flex flex-wrap gap-2">
              {chips.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    const para =
                      root?.content.split(/\n\n+/).find((p) => p.toLowerCase().includes(c.toLowerCase())) ??
                      root?.content.slice(0, 1200) ??
                      "";
                    derive(ROOT_ID, c, para);
                  }}
                  className="pedia-lift rounded bg-surface px-2.5 py-1 text-[13px] text-ink opacity-60 hover:opacity-100"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {/* Follow-up input: a typed question joins the tree as a card
              derived from whatever is currently active — never a chat. */}
          {!root?.streaming && (
            <form
              className="mt-10"
              onSubmit={(e) => {
                e.preventDefault();
                askFollowUp();
              }}
            >
              <input
                id="follow-input"
                value={followInput}
                onChange={(e) => setFollowInput(e.target.value)}
                placeholder={
                  activeId !== ROOT_ID && activeNode
                    ? `ask about “${activeNode.label.slice(0, 40)}” — it joins the thread`
                    : "ask a follow-up — it joins this thread as a card"
                }
                className="w-full rounded bg-surface px-3.5 py-2.5 text-[16px] outline-none placeholder:text-sub md:text-[14px]"
              />
            </form>
          )}

          {/* Thread export: compile the whole exploration into one story */}
          {cardIds.length >= 1 && !root?.streaming && (
            <div className="mt-8 text-[13px]">
              {exportState.status === "idle" && (
                <button
                  onClick={() => setExportState((s) => ({ ...s, status: "choosing" }))}
                  className="pedia-invite text-accent opacity-80 hover:opacity-100"
                >
                  compile this thread into one story →
                </button>
              )}
              {exportState.status === "choosing" && (
                <div className="pedia-in flex items-center gap-4">
                  <span className="text-sub">tell it:</span>
                  <button onClick={() => runExport("standard")} className="text-accent transition-opacity duration-150 hover:opacity-70">
                    standard
                  </button>
                  <button onClick={() => runExport("easy")} className="text-accent transition-opacity duration-150 hover:opacity-70">
                    easy — a 1-minute reel
                  </button>
                  <button
                    onClick={() => setExportState((s) => ({ ...s, status: "idle" }))}
                    className="text-sub transition-opacity duration-150 hover:opacity-70"
                  >
                    ×
                  </button>
                </div>
              )}
              {exportState.status === "streaming" && !showExport && <span className="text-sub">compiling…</span>}
              {exportState.status === "done" && !showExport && (
                <button
                  onClick={() => setShowExport(true)}
                  className="pedia-invite text-accent opacity-80 hover:opacity-100"
                >
                  read the compiled story →
                </button>
              )}
            </div>
          )}

          {/* Quiet status line: model reality, cache truth. Dev-honest, invisible-ish. */}
          <p className="mt-6 text-[11px] text-sub opacity-60">
            {root?.cache ? `served from cache (${root.cache})` : mockMode ? "mock mode — set an API key in .env.local" : ""}
          </p>
        </main>

        {/* ── Thread rail (desktop): the map and its cards are one tree ── */}
        <aside className="hidden w-[400px] shrink-0 md:block">
          {cardIds.length > 0 && (
            <div className="sticky top-14 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
              <div className="mb-5">
                <ThreadMap
                  variant="inline"
                  nodes={order.map((id) => nodes[id]).filter(Boolean)}
                  activeId={activeId}
                  maxDepth={MAX_DEPTH}
                  onSelect={focusNode}
                />
              </div>
              <div className="flex flex-col gap-2">
                {cardIds.map((id) => (
                  <Card
                    key={id}
                    node={nodes[id]}
                    parentLabel={
                      nodes[id]?.parentId && nodes[id].parentId !== ROOT_ID
                        ? nodes[nodes[id].parentId!]?.label ?? null
                        : null
                    }
                    expanded={id === activeId}
                    onFocus={() => focusNode(id)}
                    onRetry={() => retryNode(id)}
                  />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Mobile bottom sheet ─────────────────────────────── */}
      {activeId !== ROOT_ID && activeNode && (
        <div className="pedia-in fixed inset-x-0 bottom-0 z-20 max-h-[45vh] overflow-y-auto bg-surface px-5 pb-6 pt-4 md:hidden">
          <div className="mb-2 flex items-start justify-between gap-4">
            <span className="text-[14px] font-semibold leading-snug">{activeNode.label}</span>
            <button onClick={() => setActiveId(ROOT_ID)} className="text-[16px] leading-none text-sub">
              ×
            </button>
          </div>
          <CardBody node={activeNode} onRetry={() => retryNode(activeNode.id)} />
        </div>
      )}

      {/* ── Thread map (mobile: corner; lifts above the open sheet) ── */}
      {order.length > 1 && (
        <div className="md:hidden">
          <ThreadMap
            nodes={order.map((id) => nodes[id]).filter(Boolean)}
            activeId={activeId}
            maxDepth={MAX_DEPTH}
            onSelect={focusNode}
            lift={activeId !== ROOT_ID}
          />
        </div>
      )}

      {/* ── Drag demo: phantom selection sweep + ghost popover ── */}
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

      {/* ── Selection popover: + quotes, ? derives ───────────
          One accent pill — unmistakably a control, not more text.
          Touch: dropped well below the selection (clear of the iOS
          callout), with word labels. Mouse: at the drag's end corner. */}
      {pendingSel && (
        <div
          className={`pedia-in fixed z-30 flex items-stretch overflow-hidden rounded bg-accent ${
            coarse ? "" : "-translate-y-full"
          } ${pendingSel.align === "right" ? "-translate-x-full" : ""}`}
          style={{
            left: pendingSel.x,
            top: coarse ? pendingSel.bottom + 28 : pendingSel.top - 8,
          }}
        >
          <button
            title="quote this into a question"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              popoverQuote();
            }}
            className={`font-semibold leading-none text-white transition-opacity duration-150 active:opacity-70 ${
              coarse ? "px-3.5 py-2.5 text-[13px]" : "px-2.5 py-1.5 text-[13px] hover:opacity-80"
            }`}
          >
            {coarse ? "+ quote" : "+"}
          </button>
          <span className="my-1.5 w-px bg-white opacity-30" />
          <button
            title="open this as a card"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              popoverCard();
            }}
            className={`font-semibold leading-none text-white transition-opacity duration-150 active:opacity-70 ${
              coarse ? "px-3.5 py-2.5 text-[13px]" : "px-2.5 py-1.5 text-[13px] hover:opacity-80"
            }`}
          >
            {coarse ? "? card" : "?"}
          </button>
        </div>
      )}

      {notice && (
        <div className="pedia-in fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded bg-surface px-4 py-2 text-[13px] text-sub">
          {notice}
        </div>
      )}

      {/* ── Compiled story overlay (essay + reel) ───────────── */}
      {showExport && exportState.status !== "idle" && exportState.status !== "choosing" && (
        <ExportView
          md={exportState.md}
          streaming={exportState.status === "streaming"}
          reel={exportState.reel}
          question={question}
          level={exportState.level}
          onRetell={runExport}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

// ── Thinking skeleton ────────────────────────────────────────
// Text-shaped bars with a sweeping sheen fill the silence between the
// question and the first token. Bar height = the font size it stands in
// for, gaps = its line rhythm — it should read as blurred text, not as
// a different widget.
function Skeleton({ lines, height = 17 }: { lines: number[]; height?: number }) {
  return (
    <div className="pedia-in flex flex-col" style={{ gap: Math.round(height * 0.65) }}>
      {lines.map((w, i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded"
          style={{
            height,
            width: `${w}%`,
            background: "color-mix(in srgb, var(--color-sub) 28%, transparent)",
            marginBottom: w < 70 && i < lines.length - 1 ? height : 0,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(90deg, transparent, var(--pedia-sheen), transparent)",
              animation: "pedia-shimmer 1.5s ease-in-out infinite",
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Knowledge card ───────────────────────────────────────────
// Depth renders as indentation: the rail *is* the tree, matching the
// map above it, so derivation reads as branching — not a flat index.
function Card({
  node,
  parentLabel,
  expanded,
  onFocus,
  onRetry,
}: {
  node: Node;
  parentLabel: string | null;
  expanded: boolean;
  onFocus: () => void;
  onRetry: () => void;
}) {
  const indent = Math.min(Math.max(node.depth - 1, 0), 4) * 14;
  if (!expanded) {
    return (
      <button
        onClick={onFocus}
        id={`card-${node.id}`}
        style={{ marginLeft: indent }}
        className="pedia-invite flex items-center gap-2 rounded bg-surface px-3 py-2 text-left"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${node.bedrock ? "bg-accent" : "bg-sub"}`} />
        <span className="truncate text-[13px] text-ink opacity-55">{node.label}</span>
      </button>
    );
  }
  return (
    <div
      id={`card-${node.id}`}
      data-node-id={node.id}
      style={{ marginLeft: indent }}
      className="pedia-in cursor-text rounded bg-surface p-4"
    >
      {parentLabel && (
        <p className="mb-1 truncate text-[10px] text-sub opacity-80">↳ {parentLabel}</p>
      )}
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold leading-snug">{node.label}</span>
        <span className="shrink-0 text-[10px] text-sub">d{node.depth}</span>
      </div>
      <CardBody node={node} onRetry={onRetry} />
    </div>
  );
}

function CardBody({ node, onRetry }: { node: Node; onRetry?: () => void }) {
  const paragraphs = node.content.split(/\n\n+/).filter(Boolean);
  return (
    <div data-node-id={node.id} className="cursor-text">
      {node.streaming && !node.content && <Skeleton lines={[100, 94, 76, 100, 42]} height={15} />}
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className={`mb-3 text-[14px] leading-[1.7] ${
            node.streaming && i === paragraphs.length - 1 ? "pedia-caret" : ""
          }`}
        >
          {p}
        </p>
      ))}
      {node.error && (
        <p className="text-[13px] text-sub">
          {node.error}
          {onRetry && (
            <button onClick={onRetry} className="ml-3 text-accent transition-opacity duration-150 hover:opacity-70">
              retry →
            </button>
          )}
        </p>
      )}
      {node.bedrock && (
        <div className="pedia-in mt-3 rounded bg-page p-3">
          <p className="text-[12px] font-semibold text-accent">This is bedrock — the floor of this thread.</p>
          {node.bedrockTrace && <p className="mt-2 text-[13px] leading-[1.65] text-ink">{node.bedrockTrace}</p>}
        </div>
      )}
      {node.cache && <p className="mt-2 text-[10px] text-sub opacity-70">cached · {node.cache}</p>}
    </div>
  );
}
