-- Pedia.page schema — run once in the Supabase SQL editor.
-- Requires the pgvector extension (bundled with Supabase).
-- Idempotent: safe to re-run on a project that already has v1.

create extension if not exists vector;

-- Every generated artifact (root answers and knowledge cards).
-- Cards are communal: a cache hit serves one user a card another user's
-- question created. tokens_in / tokens_out are recorded from day one:
-- cache-hit rate and the cost curve are the core pitch data.
create table if not exists cards (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('root', 'card')),
  slug          text unique,
  query_text    text not null,
  context_hash  text not null,
  content       text not null,
  meta          jsonb not null default '{}',
  embedding     vector(1536),
  model_used    text,
  tokens_in     integer,
  tokens_out    integer,
  created_at    timestamptz not null default now(),
  upvotes       integer not null default 0,
  downvotes     integer not null default 0,
  unique (context_hash, type)
);

create index if not exists cards_hash_idx on cards (context_hash);
create index if not exists cards_embedding_idx on cards using hnsw (embedding vector_cosine_ops);

-- Semantic cache lookup: nearest neighbor above a cosine-similarity threshold.
create or replace function match_cards(
  query_embedding vector(1536),
  match_type      text,
  threshold       float default 0.90,
  match_count     int   default 1
) returns table (
  id uuid,
  slug text,
  content text,
  meta jsonb,
  model_used text,
  similarity float
)
language sql stable
as $$
  select c.id, c.slug, c.content, c.meta, c.model_used,
         1 - (c.embedding <=> query_embedding) as similarity
  from cards c
  where c.type = match_type
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Signed-in users ──────────────────────────────────────────
-- Profile row keyed to Supabase Auth. Created lazily on first
-- attributed event. recs / recs_event_count cache the personalized
-- landing suggestions so an idle user costs zero LLM calls.
create table if not exists users (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text,
  encrypted_api_key text,          -- BYOK: AES-256-GCM, server-side only
  byok_provider     text,          -- 'gemini' | 'openai' | 'anthropic'
  plan              text not null default 'free',  -- 'free' | 'plus'
  recs              jsonb,         -- last generated suggestions
  recs_event_count  integer not null default -1,
  created_at        timestamptz not null default now()
);

-- Columns for projects created before BYOK / plans existed.
alter table users add column if not exists byok_provider text;
alter table users add column if not exists plan text not null default 'free';

-- One exploration session = one root question and everything derived from it.
-- id is client-generated so event logging never blocks the answer stream.
create table if not exists sessions (
  id            uuid primary key,
  user_id       uuid not null references users (id) on delete cascade,
  root_question text not null,
  created_at    timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id, created_at desc);

-- The unit of personal knowledge is the trajectory, not the card:
-- what was asked, what was dragged, how deep the thread went, where
-- it hit bedrock. Recommendations are computed from this table.
create table if not exists events (
  id          bigint generated always as identity primary key,
  session_id  uuid references sessions (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  type        text not null check (type in ('ask', 'derive', 'synthesis', 'export')),
  label       text not null,       -- the question (ask) or dragged fragment (derive)
  depth       integer not null default 0,
  card_hash   text,                -- joins to cards.context_hash when needed
  bedrock     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Keep the type list current on projects created before 'export' existed.
alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check
  check (type in ('ask', 'derive', 'synthesis', 'export'));

create index if not exists events_user_idx on events (user_id, created_at desc);

-- ── Rate limiting ────────────────────────────────────────────
-- Fixed-window counters, atomic via upsert. One row per (class, identity)
-- bucket; serverless instances share it, which in-memory counters can't.
create table if not exists rate_limits (
  bucket       text primary key,
  window_start timestamptz not null,
  count        integer not null
);

create or replace function hit_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
as $$
declare
  allowed boolean;
begin
  insert into rate_limits (bucket, window_start, count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update set
    count = case
      when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1
      else rate_limits.count + 1
    end,
    window_start = case
      when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now()
      else rate_limits.window_start
    end;
  select count <= p_limit into allowed from rate_limits where bucket = p_bucket;
  return allowed;
end;
$$;

-- ── Row-level security ───────────────────────────────────────
-- All reads/writes go through server routes using the service-role key
-- (which bypasses RLS). The browser's anon key is used for auth only,
-- so enabling RLS with no policies closes every direct-table path.
alter table cards       enable row level security;
alter table users       enable row level security;
alter table sessions    enable row level security;
alter table events      enable row level security;
alter table rate_limits enable row level security;
