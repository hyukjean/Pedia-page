# Pedia.page

If Perplexity replaced search, Pedia replaces the forty open tabs. A runtime for **spatial** knowledge exploration — parallel, not serial. You never leave the page: select any phrase in an answer and it derives a knowledge card beside it; select inside a card and it derives again; a corner thread-map keeps you oriented; when a thread hits axiomatic bedrock, Pedia says so and traces the chain back to your question.

Not a chatbot. No history, no bubbles, no "how can I help".

## Run locally

```bash
npm install
cp .env.example .env.local   # paste at least one API key
npm run dev                  # http://localhost:3000
```

With no API key configured the app runs in **mock mode** — deterministic placeholder content through the identical streaming protocol, so every interaction is testable offline.

### Keys

Set any one of `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` in `.env.local`. If several are set, `PEDIA_PROVIDER` picks; otherwise priority is gemini → openai → anthropic (cheapest default first). `PEDIA_CARD_PROVIDER` can route the high-volume card calls to a cheaper vendor than the root answers. Model IDs are overridable via `PEDIA_ROOT_MODEL` / `PEDIA_CARD_MODEL` — see `lib/providers.ts` for the routing table and `COST.md` for the economics.

### Database (optional)

The app is fully functional without a database. Adding one enables the semantic cache (repeat questions cost zero LLM calls), card persistence, token logging, and public card pages.

1. Create a free [Supabase](https://supabase.com) project.
2. SQL editor → paste and run `supabase/schema.sql`.
3. Add to `.env.local`: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Settings → API). The service-role key stays server-side only.

Cache behavior: exact `context_hash` match first (free, works everywhere), then pgvector cosine similarity ≥ `PEDIA_CACHE_THRESHOLD` (default 0.90; needs an OpenAI or Gemini key for embeddings — Anthropic has no embeddings API, so Anthropic-only deployments cache by exact match).

### Sign-in & personalization (optional — needs the database)

Add `NEXT_PUBLIC_SUPABASE_URL` (same value as `SUPABASE_URL`) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to `.env.local` and a quiet "sign in" appears in the landing corner — email magic link, no passwords. In Supabase: Authentication → URL Configuration → set the Site URL (e.g. `http://localhost:3000` locally, `https://pedia.page` in prod) and add `/auth/callback` to the redirect allow-list.

Signed-in exploration is saved as a **trajectory** — every question (`ask`), every dragged fragment with its depth (`derive`), every synthesis — in the `sessions` and `events` tables. Cards themselves stay communal (they're the shared cache); what's yours is the path your curiosity took. From that trajectory, `/api/recommend` generates the four landing suggestions personally: questions one step beyond where you stopped, in the language you asked in. They're cached per-user and only regenerated after new activity, so this costs one cheap-model call per active session at most (see COST.md).

Anonymous use is untouched: signed out (or with these two vars unset) the product is exactly the MVP.

## Deploy to Vercel

1. Push this repo to GitHub.
2. [vercel.com/new](https://vercel.com/new) → import the repo. Framework auto-detects as Next.js; no build settings needed.
3. Project → Settings → Environment Variables: add the same variables as `.env.local`, plus `NEXT_PUBLIC_SITE_URL=https://pedia.page`.
4. Deploy, verify on the `*.vercel.app` URL, then Project → Settings → Domains → add `pedia.page`.

### Domain on Cloudflare (keep it there)

Registration and DNS stay at Cloudflare; only the records point at Vercel. In the Cloudflare DNS panel, remove the old records for `pedia.page` and add — **proxy OFF (grey cloud, "DNS only") on both**, so Vercel serves TLS and nothing buffers the streams:

| Type | Name | Value |
|---|---|---|
| CNAME | `@` | `cname.vercel-dns.com` |
| CNAME | `www` | `cname.vercel-dns.com` |

Certificates are automatic (`.page` is HSTS-preloaded; Vercel provisions HTTPS in minutes). Finally, in Supabase → Authentication → URL Configuration: set Site URL to `https://pedia.page` and add `https://pedia.page/auth/callback` to the redirect allow-list (keep the localhost entries for development).

## Architecture in one breath

One provider adapter (`lib/providers.ts`) speaks the OpenAI-compatible endpoint all three vendors expose — vendor differences are data, not code. Every response is a single streamed call: prose first, then a `<<<PEDIA_META>>>` delimiter, then one JSON object carrying the machine half (concept chips for root answers, the bedrock verdict for cards) — never a second call. Routes check the cache before touching a model and persist after the stream closes, off the response path. System prompts live in `/prompts` as plain files, separate from code.

```
app/page.tsx            landing + session (→ components/Workspace.tsx)
app/c/[slug]/page.tsx   public, SEO-renderable cached cards
app/auth/callback       magic-link landing (sets session cookies)
app/api/answer          root answer   — strong model, 1 call/session
app/api/card            knowledge card — cheap model, ~90% of calls
app/api/synthesis       root rewrite from explored concepts
app/api/export          thread → one essay (.md) + 60-second caption reel
app/api/recommend       personalized suggestions from the user's trajectory
lib/                    providers · cache · embeddings · hash · protocol · auth · events
prompts/                the four system prompts (content, not code)
supabase/schema.sql     cards + users + sessions + events + match_cards()
```

## Completion criteria (from the spec)

| Phase | Criterion | How to check |
|---|---|---|
| 1 | streaming starts < 3 s after submit | ask anything on the landing page |
| 2 | 3-level derivation without losing your place | select text in an answer, then in the card, then again |
| 3 | map node click returns to the card | click any dot bottom-left |
| 4 | repeat question → 0 API calls | ask the same question twice; status line reads "served from cache"; `x-pedia-cache: exact` header |
| 5 | cached card renders as a public page | open `/c/<slug>` (slug is in the `cards` table, also in the `x-pedia-slug` header on cache hits) |
| 6 | signed-in exploration is saved and shapes the landing | sign in, explore a thread, return to the landing — the four suggestions now grow from your trajectory ("from what you've been exploring") |
