-- Production module, step 2: tidy tables built from the raw sheet copy (001). Applied 2026-11-01 (migration production_002_normalized_tables).
-- Names carry the dev_ prefix until go-live. Nothing here touches an existing table.
--
-- Each row below is derived from exactly one raw row (source_row_id -> dev_sheet_rows_raw.row_id) and can be
-- rebuilt from the raw copy at any time, so these tables never hold the only copy of anything.
-- Until cutover the sheets stay the source of truth and these tables are read-only for the app.
--
-- Job identity: job_number is the QuickBooks invoice number typed as "#1234" in the sheet's Job Name.
-- Rows without one get a temporary job_ref such as T17-ESTRADA-MAIN (ref_is_temp = true). A real number
-- replaces the temp ref later; the old temp ref is kept in job_ref_history.

create table if not exists public.dev_production_jobs (
  id              uuid primary key default gen_random_uuid(),
  source_row_id   uuid        not null unique,        -- dev_sheet_rows_raw.row_id (sheet_key production_status)
  job_ref         text        not null,               -- '#6001' or a temp ref like 'T17-ESTRADA-MAIN'
  job_number      text,                               -- invoice number digits, null while the ref is temporary
  ref_is_temp     boolean     not null,
  job_ref_history text[]      not null default '{}',  -- earlier refs, oldest first
  job_name        text        not null,
  section         text,                               -- the sheet's section header (e.g. FINISHED JOBS, Year 2019)
  priority        text,
  steps           jsonb       not null default '{}',  -- the sheet's checkbox columns: {"Body Cut": true, ...}
  paint_color     text,
  pvc_tape_color  text,
  paint_ordered   boolean,
  paint_arrives_on  date,
  paint_arrives_text text,                            -- original text when it is not a clean date
  doors_arrive_on   date,
  doors_arrive_text text,
  attachment_links  text,
  removed_at      timestamptz,                        -- mirrors the raw row; never deleted
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ref_is_temp = (job_number is null))
);
create index if not exists dev_production_jobs_ref_idx    on public.dev_production_jobs (job_ref);
create index if not exists dev_production_jobs_number_idx on public.dev_production_jobs (job_number) where job_number is not null;

create table if not exists public.dev_install_events (
  id              uuid primary key default gen_random_uuid(),
  source_row_id   uuid        not null unique,        -- sheet_key install_schedule
  job_ref         text        not null,
  job_number      text,
  ref_is_temp     boolean     not null,
  job_name        text        not null,
  details         text,                               -- 'Job Details' (e.g. Installation, Delivery Only)
  address         text,
  contact         text,                               -- 'Home Owner / Contrator Number'
  delivery_on     date,
  delivery_text   text,
  delivery_time   text,
  install_on      date,
  install_text    text,
  install_time    text,
  confirmed       boolean,
  completed       boolean,
  paid_50         boolean,                            -- the sheet's payment checkboxes (50% / 45% / 5%)
  paid_45         boolean,
  paid_5          boolean,
  notes           text,
  removed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ref_is_temp = (job_number is null))
);
create index if not exists dev_install_events_ref_idx     on public.dev_install_events (job_ref);
create index if not exists dev_install_events_install_idx on public.dev_install_events (install_on);

create table if not exists public.dev_hardware_orders (
  id              uuid primary key default gen_random_uuid(),
  source_row_id   uuid        not null unique,        -- sheet_key hardware_orders
  job_ref         text        not null,
  job_number      text,
  ref_is_temp     boolean     not null,
  job_name        text        not null,               -- first line of the sheet's Job Name cell
  order_text      text        not null,               -- the full cell: customer line plus the OCR'd item list
  ordered_on      date,
  ordered_text    text,
  received_on     date,
  received_text   text,
  status          text,
  notes           text,
  image_name      text,                               -- original photo file name, for tracing back to the scan
  attachment_links text,
  removed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ref_is_temp = (job_number is null))
);
create index if not exists dev_hardware_orders_ref_idx     on public.dev_hardware_orders (job_ref);
create index if not exists dev_hardware_orders_ordered_idx on public.dev_hardware_orders (ordered_on);

-- Suggested and confirmed links from a job to an outside record (QuickBooks invoice, HubSpot deal).
-- Suggestions never overwrite a number Mike typed; a person confirms each one.
create table if not exists public.dev_job_links (
  id           uuid primary key default gen_random_uuid(),
  job_ref      text        not null,
  system       text        not null check (system in ('qbo_invoice', 'hubspot_deal')),
  external_id  text        not null,
  status       text        not null default 'suggested' check (status in ('suggested', 'confirmed', 'rejected')),
  basis        text,                                  -- how it was matched: number, name+date, manual
  decided_by   text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (job_ref, system, external_id)
);
create index if not exists dev_job_links_open_idx on public.dev_job_links (status) where status = 'suggested';

-- Service role only: RLS on, no policies.
alter table public.dev_production_jobs enable row level security;
alter table public.dev_install_events  enable row level security;
alter table public.dev_hardware_orders enable row level security;
alter table public.dev_job_links       enable row level security;
