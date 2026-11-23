-- 009: vendors, their catalogs and price lists, and the parts read from them (each with a picture), plus dated prices.
-- The parts list that ordering, the parts-on-order card and inventory will point at later. Nothing here orders anything.
-- A catalog PDF is never uploaded: the browser reads it and uploads only a picture per part and per catalog page.
-- Those pictures and the (small, CSV) price lists go in a private storage bucket, dev-vendor-catalogs (pictures are
-- the vendors' copyright: shown only through short-lived signed links, never public).
-- Additive and dev_ only. Rollback:
--   drop table if exists public.dev_vendor_prices, public.dev_vendor_parts, public.dev_vendor_files, public.dev_vendors;
--   delete from storage.objects where bucket_id = 'dev-vendor-catalogs'; delete from storage.buckets where id = 'dev-vendor-catalogs';

create table if not exists public.dev_vendors (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  website         text,
  order_email     text,
  phone           text,
  account_number  text,
  notes           text,                                   -- never logins or passwords
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  removed_at      timestamptz
);
create unique index if not exists dev_vendors_name_live on public.dev_vendors (lower(name)) where removed_at is null;

-- Catalogs (read in the browser) and price lists (CSV) for a vendor. Old editions are kept, never deleted.
create table if not exists public.dev_vendor_files (
  id              uuid        primary key default gen_random_uuid(),
  vendor_id       uuid        not null references public.dev_vendors (id),
  kind            text        not null check (kind in ('catalog', 'price_list')),
  title           text        not null,
  edition         text,
  storage_path    text,                                   -- price lists: the file in the bucket; catalogs: none (pictures only)
  file_name       text,
  size_bytes      bigint,
  pages           integer,
  status          text        not null default 'uploading'
                  check (status in ('uploading', 'uploaded', 'extracting', 'extracted', 'reviewed', 'failed')),
  reader          text,                                   -- which catalog reader read it (e.g. 'caldoor')
  superseded_by   uuid        references public.dev_vendor_files (id),
  notes           text,
  uploaded_by     text,
  uploaded_at     timestamptz not null default now(),
  extracted_at    timestamptz,
  removed_at      timestamptz
);
create index if not exists dev_vendor_files_vendor on public.dev_vendor_files (vendor_id);

create table if not exists public.dev_vendor_parts (
  id              uuid        primary key default gen_random_uuid(),
  vendor_id       uuid        not null references public.dev_vendors (id),
  kind            text        not null default 'other'
                  check (kind in ('door_style', 'drawer_front', 'drawer_box', 'hardware', 'material', 'other')),
  item_number     text,                                   -- e.g. 533.83.097; door styles often have none
  name            text        not null,                   -- e.g. 'Mitered #5 Solid'
  description     text,
  category        text,
  options         text,                                   -- finish, sizes, notes from the catalog
  file_id         uuid        references public.dev_vendor_files (id),
  page            integer,
  image_path      text,                                   -- picture in the dev-vendor-catalogs bucket
  status          text        not null default 'review' check (status in ('review', 'active', 'retired', 'rejected')),
  source          text        not null check (source in ('catalog', 'price_list', 'manual')),
  created_by      text,
  created_at      timestamptz not null default now(),
  reviewed_by     text,
  reviewed_at     timestamptz,
  edited_by       text,
  edited_at       timestamptz,
  removed_at      timestamptz
);
-- One live part per vendor per item number; with no item number, per name (any case).
create unique index if not exists dev_vendor_parts_key on public.dev_vendor_parts
  (vendor_id, lower(coalesce(item_number, '~' || name))) where removed_at is null and status <> 'rejected';
create index if not exists dev_vendor_parts_vendor on public.dev_vendor_parts (vendor_id, status);

-- Dated prices; the newest per part is the current one. Rows are never overwritten.
create table if not exists public.dev_vendor_prices (
  id              uuid        primary key default gen_random_uuid(),
  part_id         uuid        not null references public.dev_vendor_parts (id),
  price           numeric(12, 2) not null check (price >= 0),
  unit            text        not null default 'each',
  as_of           date        not null,
  source          text        not null check (source in ('price_list', 'manual', 'invoice')),
  file_id         uuid        references public.dev_vendor_files (id),
  entered_by      text,
  entered_at      timestamptz not null default now()
);
create index if not exists dev_vendor_prices_part on public.dev_vendor_prices (part_id, as_of desc, entered_at desc);

-- Service role only: RLS on, no policies.
alter table public.dev_vendors enable row level security;
alter table public.dev_vendor_files enable row level security;
alter table public.dev_vendor_parts enable row level security;
alter table public.dev_vendor_prices enable row level security;

-- Private bucket for part and page pictures and price lists. 20 MB per file is plenty (a page picture is ~200 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dev-vendor-catalogs', 'dev-vendor-catalogs', false, 20971520,
        array['text/csv', 'text/plain', 'application/vnd.ms-excel', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
