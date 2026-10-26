-- Production module, step 1: raw copy of the production sheets and the sync bookkeeping.
-- Applied 2026-10-26 (migration production_001_sheet_sync_raw). See README.md. Names carry the dev_ prefix until go-live.

create table if not exists public.dev_sheet_rows_raw (
  id            uuid primary key default gen_random_uuid(),
  sheet_key     text        not null,            -- which sheet: production_status, install_schedule, hardware_orders, ...
  row_id        uuid        not null,            -- the hidden _id the sync writes into the sheet
  row_number    integer     not null,            -- last seen position, informational only
  raw           jsonb       not null,
  content_hash  text        not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  removed_at    timestamptz,                     -- set after a row is missing on two runs in a row; never deleted
  unique (sheet_key, row_id)
);

create table if not exists public.dev_sheet_row_versions (
  id          uuid primary key default gen_random_uuid(),
  sheet_key   text        not null,
  row_id      uuid        not null,
  raw         jsonb       not null,              -- the previous value, kept 30 days
  replaced_at timestamptz not null default now()
);
create index if not exists dev_sheet_row_versions_row_idx on public.dev_sheet_row_versions (sheet_key, row_id, replaced_at desc);

create table if not exists public.dev_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  sheet_key   text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  rows_seen   integer,
  inserted    integer,
  updated     integer,
  removed     integer,
  errors      jsonb
);

create table if not exists public.dev_sync_exceptions (
  id          uuid primary key default gen_random_uuid(),
  sheet_key   text        not null,
  row_id      uuid,
  code        text        not null,              -- missing_job_number, duplicate_job_number, unparseable_date, ...
  detail      text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists dev_sync_exceptions_open_idx on public.dev_sync_exceptions (sheet_key) where resolved_at is null;

-- Service role only: RLS on, no policies.
alter table public.dev_sheet_rows_raw     enable row level security;
alter table public.dev_sheet_row_versions enable row level security;
alter table public.dev_sync_runs          enable row level security;
alter table public.dev_sync_exceptions    enable row level security;
