# LATER.md — deliberately not built

- Payments / subscriptions (BYOK `users.encrypted_api_key` column reserved in schema only; **login itself is built** — email magic link via Supabase Auth, optional)
- **Personalized knowledge engine — phase 1 built, rest here.** Built (2026-07): `sessions` + `events` tables, trajectory logging (ask / derive with depth and bedrock / synthesis), and `/api/recommend` — quiet landing suggestions one step beyond where the user's curiosity stopped, cached per-user, regenerated only after new activity. Still later: (1) per-user curiosity *graph* (concepts explored vs. skipped, habitual depth, bedrock domains they gravitate toward — the events table already holds the data; this is a query + a view, then a model input); (2) `revisit` / `abandon` event types for finer trajectory signal; (3) reels as actual *video* (TTS narration + generated visuals) — the subtitle-reel player and the per-thread script generation are built (2026-07, Thread Export: essay .md + 60-second caption reel); what remains is rendering that script into a shareable mp4; (4) a "your threads" quiet history surface — deliberately withheld until it can be spatial, not a chat-history list.
- Separate keyword-card mode (folded into concept chips per spec)
- Dark mode
- Multilingual UI chrome (answers already follow the question's language)
- Admin page / analytics dashboard (SQL queries in COST.md cover the pitch data)
- Chat history
- Rate limiting / abuse protection on API routes (needed before real public launch)
- Mobile long-press selection affordance (chips + map work on mobile; text-selection derivation is desktop-first for now)
- Synthesis token logging (root + cards are logged; synthesis is ~2% of calls)
- Card voting UI (upvotes/downvotes columns exist and are wired into the schema)
- Streaming resumption on network drop (client shows error text; retry is manual)
- Public *story* pages (`/s/[slug]`) — the compiled essay + playable reel as a shareable, SEO-renderable page; requires persisting exports (today only cards persist). This is the strongest share unit: a finished 60-second artifact.
- Anonymous product analytics (activation %, threads/session, share rate) — the cards table covers cost/cache pitch data, but engagement funnels need an events baseline for signed-out users too (privacy-respecting, aggregate only)
- Neural open-source TTS for the reel (Piper / Kokoro, server-side) — consistent voice across devices. The reel currently uses the browser's built-in speechSynthesis: zero cost and zero dependencies, but voice quality varies by OS.
