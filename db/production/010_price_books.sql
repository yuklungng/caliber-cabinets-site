-- 010: vendor price books (Cal Door's Wood, RTF, Drawer Box and Flex Line books), read in the browser like catalogs.
-- A book is a dev_vendor_files row of kind 'price_book' (the PDF is not stored; one picture per price page is, in the
-- dev-vendor-catalogs bucket). Each table of prices in it is a dev_price_tables row, each number a dev_price_cells
-- row, and each add-on charge printed around it a dev_price_adders row. Which table prices a part is worked out when
-- read (the part's name is printed on the table's page); dev_part_price_links holds only links set by hand and name
-- matches someone undid.
-- A new edition of a book supersedes the old one (dev_vendor_files.superseded_by); the old tables stay as history.
-- Prices are shown only to the admin and the bookkeeper (checked in the API). RLS on, no policies (service role only).
-- Additive and dev_ only. Rollback:
--   drop table if exists public.dev_part_price_links, public.dev_price_adders, public.dev_price_cells, public.dev_price_tables;
--   alter table public.dev_vendor_files drop constraint dev_vendor_files_kind_check;
--   alter table public.dev_vendor_files add constraint dev_vendor_files_kind_check check (kind in ('catalog', 'price_list'));

alter table public.dev_vendor_files drop constraint if exists dev_vendor_files_kind_check;
alter table public.dev_vendor_files add constraint dev_vendor_files_kind_check check (kind in ('catalog', 'price_list', 'price_book'));

create table if not exists public.dev_price_tables (
  id              uuid        primary key default gen_random_uuid(),
  vendor_id       uuid        not null references public.dev_vendors (id),
  file_id         uuid        not null references public.dev_vendor_files (id),
  page            integer     not null,
  options_page    integer,                                -- the page after it with its options, when there is one
  seq             integer     not null,                   -- order in the book
  title           text        not null,                   -- e.g. 'Cope ''N Stick Solid Standard Series'
  styles          text[]      not null default '{}',      -- names printed on its page (used to link parts)
  also_names      text[]      not null default '{}',      -- names on the pages after it (used only when nothing else matches)
  pricing         text        not null default 'per_sq_ft'
                  check (pricing in ('per_sq_ft', 'linear_inch_plus_box', 'per_length', 'each', 'other')),
  row_label       text,                                   -- what the rows are, e.g. 'Materials'
  columns         jsonb       not null default '[]',      -- [{ key: 'c1', label: 'Revere 2 1/4" S&R', variant: 'door' }]
  row_labels      text[]      not null default '{}',      -- in printed order
  min_sq_ft       numeric(6,2),
  notes           text[]      not null default '{}',      -- minimums and small print from the page
  issues          text[]      not null default '{}',      -- what the reader wasn't sure of
  checked_by      text,
  checked_at      timestamptz,                            -- null = not checked yet against the page
  edited_by       text,
  edited_at       timestamptz,
  created_at      timestamptz not null default now(),
  removed_at      timestamptz
);
create index if not exists dev_price_tables_file on public.dev_price_tables (file_id);
create index if not exists dev_price_tables_vendor on public.dev_price_tables (vendor_id);

create table if not exists public.dev_price_cells (
  id              uuid        primary key default gen_random_uuid(),
  table_id        uuid        not null references public.dev_price_tables (id) on delete cascade,
  row_index       integer     not null,
  column_key      text        not null,
  rate            numeric(12,4),                          -- null = N/A (not available)
  raw             text,                                   -- the text as read, so a wrong number can be traced
  prev_rate       numeric(12,4),                          -- the previous edition's number, when it changed
  edited_by       text,
  edited_at       timestamptz,
  unique (table_id, row_index, column_key)
);

create table if not exists public.dev_price_adders (
  id              uuid        primary key default gen_random_uuid(),
  table_id        uuid        not null references public.dev_price_tables (id) on delete cascade,
  seq             integer     not null default 0,
  label           text        not null,
  kind            text        not null
                  check (kind in ('percent', 'per_sq_ft', 'per_piece', 'per_door', 'per_lite', 'per_box', 'per_opening', 'per_set', 'each')),
  value           numeric(12,2) not null,
  raw             text,
  page            integer
);
create index if not exists dev_price_adders_table on public.dev_price_adders (table_id);

create table if not exists public.dev_part_price_links (
  id              uuid        primary key default gen_random_uuid(),
  part_id         uuid        not null references public.dev_vendor_parts (id),
  table_id        uuid        not null references public.dev_price_tables (id) on delete cascade,
  how             text        not null default 'manual' check (how in ('manual', 'hidden')),  -- automatic matches are worked out when read; 'hidden' undoes one
  created_by      text,
  created_at      timestamptz not null default now(),
  unique (part_id, table_id)
);
create index if not exists dev_part_price_links_table on public.dev_part_price_links (table_id);

alter table public.dev_price_tables enable row level security;
alter table public.dev_price_cells enable row level security;
alter table public.dev_price_adders enable row level security;
alter table public.dev_part_price_links enable row level security;
