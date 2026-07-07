import { META_DELIMITER } from "./protocol";

// Browser-side stream consumer. Splits the single response into prose
// (rendered as it arrives) and the trailing meta JSON. Holds back a
// delimiter-length tail so a delimiter split across chunks never leaks
// into the visible text.

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onMeta?: (meta: Record<string, unknown>) => void;
  onHeaders?: (h: Headers) => void;
  onDone?: (fullProse: string) => void;
  onError?: (message: string) => void;
}

export async function streamRequest(url: string, payload: unknown, cb: StreamCallbacks): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    cb.onHeaders?.(res.headers);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      cb.onError?.(String((err as { error?: string }).error ?? `HTTP ${res.status}`));
      return;
    }
    if (!res.body) {
      cb.onError?.("no response stream");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let emitted = 0; // chars of prose already delivered
    let metaIdx = -1;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      if (metaIdx === -1) {
        metaIdx = full.indexOf(META_DELIMITER);
        const frontier = metaIdx !== -1 ? metaIdx : Math.max(emitted, full.length - META_DELIMITER.length);
        if (frontier > emitted) {
          cb.onText(full.slice(emitted, frontier));
          emitted = frontier;
        }
      }
    }

    if (metaIdx === -1) metaIdx = full.indexOf(META_DELIMITER);
    const proseEnd = metaIdx === -1 ? full.length : metaIdx;
    if (proseEnd > emitted) cb.onText(full.slice(emitted, proseEnd));
    if (metaIdx !== -1) {
      const tail = full.slice(metaIdx + META_DELIMITER.length);
      const s = tail.indexOf("{");
      const e = tail.lastIndexOf("}");
      if (s !== -1 && e > s) {
        try {
          cb.onMeta?.(JSON.parse(tail.slice(s, e + 1)));
        } catch {
          /* malformed meta is non-fatal; prose already rendered */
        }
      }
    }
    cb.onDone?.(full.slice(0, proseEnd).trim());
  } catch (err) {
    cb.onError?.(err instanceof Error ? err.message : "network error");
  }
}
