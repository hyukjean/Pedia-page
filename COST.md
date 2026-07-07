# COST.md — model routing and the cost curve

Prices are per **million tokens** (input / output), checked July 2026. Verify before pitching: vendors reprice quarterly.

## Routing table (defaults in `lib/providers.ts`)

| Provider | Root answer + synthesis (strong) | Knowledge card (cheap, ~90% of calls) | Embeddings |
|---|---|---|---|
| Gemini (default) | gemini-3.5-flash — $1.50 / $9.00 | gemini-2.5-flash-lite — $0.10 / $0.40 | gemini-embedding-001 |
| OpenAI | gpt-5.4 — ~$2.50 / $15.00* | gpt-5.4-nano — $0.20 / $1.25 | text-embedding-3-small ($0.02) |
| Anthropic | claude-sonnet-5 — $2.00 / $10.00 (intro to 2026-08-31, then $3/$15) | claude-haiku-4-5 — $1.00 / $5.00 | none → exact-hash cache only |

\* verify exact OpenAI root-model ID and output price at deploy time; all IDs are env-overridable.

## Session model

Assumed average session: 1 root answer (in ~1,200 tokens incl. system prompt, out ~450) + 4 cards (in ~800, out ~250 each) + 0.3 synthesis (in ~1,500, out ~500). Embedding cost is negligible (<$0.01 per 1,000 sessions).

## Thread export (essay + reel)

One strong-model call per export (in ~3–6k tokens: the whole thread; out ~1.2k: essay + 14 reel frames). User-initiated and rare — a session ends in at most one or two exports. At Gemini default pricing that is ~$0.02 per export; even if 30% of sessions export, ~$6 per 1,000 sessions. The reel script rides in the same call's META block — never a second call.

## Personalized recommendations (signed-in users)

One cheap-model call (in ~900 tokens: system prompt + trajectory, out ~120) generates 4 landing suggestions. The result is cached on the profile row (`users.recs`) and regenerated **only after new activity** — `recs_event_count` is compared to the user's event count, so an idle user's landing visits cost $0. Worst case (every signed-in session triggers one regeneration) adds ~$0.14 per 1,000 sessions on Gemini flash-lite — noise relative to the table above.

## Cost per 1,000 sessions (0% cache)

| Routing | Root | 4 cards | 0.3 synthesis | Total /1k sessions |
|---|---|---|---|---|
| Gemini default | $5.85 | $0.72 | $2.02 | **$8.59** |
| OpenAI | $9.75 | $1.89 | $3.38 | **$15.02** |
| Anthropic | $6.90 | $8.20 | $2.40 | **$17.50** |
| Anthropic root + Gemini cards (`PEDIA_CARD_PROVIDER=gemini`) | $6.90 | $0.72 | $2.40 | **$10.02** |

Note the Anthropic row: cards outcost the root answer 
— the cheap-model tier is the whole ballgame, which is why cross-provider card routing exists.

## Why the cache is the business model

Cache hits cost $0.00 in LLM calls. At hit rate *h*, cost per 1,000 sessions ≈ (1 − h) × the table above.

| Cache hit rate | Gemini default /1k sessions |
|---|---|
| 0% | $8.59 |
| 40% | $5.15 |
| 70% | $2.58 |

Popular questions converge: the Nth person asking "what is entropy" is served a stored card, and the marginal cost of the product falls toward zero as the corpus grows. `tokens_in` / `tokens_out` are logged on every generation from day one — the hit-rate curve and the cost curve come straight out of the `cards` table:

```sql
select date_trunc('week', created_at) as week,
       count(*) as generations,
       sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out
from cards group by 1 order by 1;
```

(Generations per week vs. sessions per week from analytics = miss rate; 1 − miss = the pitch slide.)
