// ─────────────────────────────────────────────────────────────
// Unified provider layer.
// First principle: all three vendors expose OpenAI-compatible
// chat-completions endpoints, so there is exactly one code path;
// vendor differences are data, not code.
// ─────────────────────────────────────────────────────────────

export type ProviderId = "gemini" | "openai" | "anthropic";
export type TaskKind = "root" | "card" | "synthesis";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  envKey: string;
  /** Strong model — root answers & synthesis (1 call per session). */
  rootModel: string;
  /** Cheap model — knowledge cards (~90% of calls). */
  cardModel: string;
  /** Embedding model for the semantic cache; null → exact-hash cache only. */
  embedModel: string | null;
  /** Some OpenAI-compat layers reject stream_options. */
  supportsStreamUsage: boolean;
  /** Recent OpenAI models require max_completion_tokens instead of max_tokens. */
  maxTokensParam: "max_tokens" | "max_completion_tokens";
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envKey: "GEMINI_API_KEY",
    rootModel: "gemini-3.5-flash",
    cardModel: "gemini-2.5-flash-lite",
    embedModel: "gemini-embedding-001",
    supportsStreamUsage: true,
    maxTokensParam: "max_tokens",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    rootModel: "gpt-5.4",
    cardModel: "gpt-5.4-nano",
    embedModel: "text-embedding-3-small",
    supportsStreamUsage: true,
    maxTokensParam: "max_completion_tokens",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    rootModel: "claude-sonnet-5",
    cardModel: "claude-haiku-4-5",
    embedModel: null, // Anthropic has no embeddings API → exact-hash cache only
    supportsStreamUsage: false,
    maxTokensParam: "max_tokens",
  },
};

const ORDER: ProviderId[] = ["gemini", "openai", "anthropic"];

export function apiKeyFor(p: ProviderConfig): string | undefined {
  return process.env[p.envKey] || undefined;
}

/** Active provider: forced via PEDIA_PROVIDER, else first with a key, else null (mock). */
export function activeProvider(task: TaskKind = "root"): ProviderConfig | null {
  // Cards may be routed to a different (cheaper) vendor.
  if (task === "card") {
    const cardOverride = process.env.PEDIA_CARD_PROVIDER as ProviderId | undefined;
    if (cardOverride && PROVIDERS[cardOverride] && apiKeyFor(PROVIDERS[cardOverride])) {
      return PROVIDERS[cardOverride];
    }
  }
  const forced = process.env.PEDIA_PROVIDER as ProviderId | undefined;
  if (forced && PROVIDERS[forced] && apiKeyFor(PROVIDERS[forced])) return PROVIDERS[forced];
  for (const id of ORDER) if (apiKeyFor(PROVIDERS[id])) return PROVIDERS[id];
  return null;
}

export function modelFor(p: ProviderConfig, task: TaskKind): string {
  if (task === "card") return process.env.PEDIA_CARD_MODEL || p.cardModel;
  return process.env.PEDIA_ROOT_MODEL || p.rootModel; // root & synthesis share the strong model
}

export interface Usage {
  tokens_in: number;
  tokens_out: number;
  estimated: boolean;
}

export interface StreamResult {
  /** Plain text stream (model output only — no SSE framing). */
  stream: ReadableStream<Uint8Array>;
  /** Resolves when the stream ends, with the full text and token usage. */
  done: Promise<{ fullText: string; usage: Usage }>;
  provider: string;
  model: string;
  mock: boolean;
}

/** BYOK: run this call on the user's own provider account. */
export interface ProviderOverride {
  provider: ProviderId;
  apiKey: string;
}

/**
 * Call the provider's chat-completions endpoint with streaming and re-emit
 * plain text. Token usage is captured from the final SSE chunk when the
 * vendor supports it, otherwise estimated (~4 chars/token) and flagged.
 */
export async function streamChat(
  task: TaskKind,
  system: string,
  user: string,
  maxTokens = 1024,
  override?: ProviderOverride,
): Promise<StreamResult> {
  const p = override ? PROVIDERS[override.provider] : activeProvider(task);
  if (!p) return mockStream(task, user);
  const apiKey = override?.apiKey ?? apiKeyFor(p);
  if (!apiKey) return mockStream(task, user);

  const model = modelFor(p, task);
  const body: Record<string, unknown> = {
    model,
    stream: true,
    [p.maxTokensParam]: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (p.supportsStreamUsage) body.stream_options = { include_usage: true };

  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${p.label} ${res.status}: ${detail.slice(0, 300)}`);
  }

  const promptChars = system.length + user.length;
  let fullText = "";
  let usage: Usage | null = null;
  let resolveDone!: (v: { fullText: string; usage: Usage }) => void;
  const done = new Promise<{ fullText: string; usage: Usage }>((r) => (resolveDone = r));

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  const reader = res.body.getReader();

  // Eager pump, not pull(): a pull() that resolves without enqueueing
  // (role-only / usage-only SSE chunks) is never re-called by the stream
  // machinery, deadlocking the response. Payloads are a few KB, so
  // draining upstream without backpressure is free.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        try {
          for (;;) {
            const { done: rDone, value } = await reader.read();
            if (rDone) break;
            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split("\n");
            sseBuffer = lines.pop() ?? "";
            let out = "";
            for (const line of lines) {
              const data = line.startsWith("data:") ? line.slice(5).trim() : null;
              if (!data || data === "[DONE]") continue;
              try {
                const json = JSON.parse(data);
                const delta: string = json.choices?.[0]?.delta?.content ?? "";
                if (delta) out += delta;
                if (json.usage?.prompt_tokens != null) {
                  usage = {
                    tokens_in: json.usage.prompt_tokens,
                    tokens_out: json.usage.completion_tokens ?? 0,
                    estimated: false,
                  };
                }
              } catch {
                /* partial JSON across chunks is impossible here (line-framed); ignore junk */
              }
            }
            if (out) {
              fullText += out;
              controller.enqueue(encoder.encode(out));
            }
          }
          controller.close();
        } catch (e) {
          try {
            controller.error(e);
          } catch {}
        } finally {
          resolveDone({
            fullText,
            usage:
              usage ?? {
                tokens_in: Math.ceil(promptChars / 4),
                tokens_out: Math.ceil(fullText.length / 4),
                estimated: true,
              },
          });
        }
      })();
    },
    cancel() {
      reader.cancel();
    },
  });

  return { stream, done, provider: p.id, model, mock: false };
}

// ─────────────────────────────────────────────────────────────
// Mock mode — no API key configured. Deterministic, clearly not
// real content, but exercises the exact same streaming protocol
// so every UI feature is testable offline.
// ─────────────────────────────────────────────────────────────

function mockStream(task: TaskKind, user: string): StreamResult {
  const topic = user.split("\n").pop()?.slice(0, 60) || "the topic";
  let text: string;
  if (task === "root") {
    text =
      `[Mock] "${topic}" names a concept whose essence is a relation between simpler primitives. Its definition fixes what counts as an instance and what does not. The boundary of that definition is where most confusion about it lives.\n\n` +
      `Mechanically, it operates through a small causal loop: an input state, a transformation rule, and a constraint that the rule conserves. The conserved quantity is why the behavior is predictable. Change the constraint and the phenomenon changes character entirely.\n\n` +
      `It matters because adjacent fields quietly assume it: measurement theory, information dynamics, and statistical inference all lean on it. Understanding it converts several memorized facts into one derivable result.\n\n` +
      `<<<PEDIA_META>>>\n{"chips": ["transformation rule", "conserved quantity", "statistical inference"]}`;
  } else if (task === "card") {
    const bedrock = /axiom|constant|definition|primitive|conserv/i.test(user);
    text =
      `[Mock] In this context, the selected phrase does the argument's load-bearing work: it names the mechanism that links the paragraph's premise to its conclusion. Without it the claim would be correlation, not cause.\n\n` +
      `It compresses a longer chain — rule, constraint, invariant — into one term, which is exactly why expanding it is worthwhile.\n\n` +
      `<<<PEDIA_META>>>\n{"bedrock": ${bedrock}, "bedrock_trace": ${
        bedrock
          ? `"[Mock] This is a definitional floor. From here the chain runs back up: the primitive fixes the rule, the rule fixes the invariant, and the invariant is what the root question was really asking about. Nothing beneath this level is decomposable further."`
          : "null"
      }}`;
  } else {
    text =
      `[Mock] Re-read with your explored concepts as vocabulary: the thing asked is an instance of the transformation rule you examined, constrained by the conserved quantity.\n\n` +
      `The mechanism is now one sentence: the rule advances the state while the invariant forbids most trajectories, leaving the observed behavior as the only survivor.\n\n` +
      `Its importance follows directly: statistical inference works because the invariant guarantees stable frequencies. What were three facts is now one derivation.`;
  }

  const encoder = new TextEncoder();
  const chunks: string[] = text.match(/[\s\S]{1,24}/g) ?? [text];
  let i = 0;
  let resolveDone!: (v: { fullText: string; usage: Usage }) => void;
  const done = new Promise<{ fullText: string; usage: Usage }>((r) => (resolveDone = r));

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        resolveDone({
          fullText: text,
          usage: { tokens_in: Math.ceil(user.length / 4), tokens_out: Math.ceil(text.length / 4), estimated: true },
        });
        return;
      }
      await new Promise((r) => setTimeout(r, 12));
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });

  return { stream, done, provider: "mock", model: "mock", mock: true };
}
