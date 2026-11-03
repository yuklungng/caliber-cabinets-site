-- One row per part line of a hardware order, read from the OCR'd cell (qty is the number before the ")").
-- Additive and dev_ only. Rebuilt from the order text on each normalize; a later edit stage will own these rows.
create table if not exists public.dev_hardware_parts (
  id                    uuid primary key default gen_random_uuid(),
  order_source_row_id   uuid        not null,              -- dev_hardware_orders.source_row_id
  job_ref               text        not null,
  line_no               int         not null,              -- position within the order, from 1
  qty                   int,                               -- null when the line has no "N)" prefix
  part_name             text        not null,
  raw_line              text        not null,              -- the OCR line as read, for verification
  removed_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (order_source_row_id, line_no)
);
create index if not exists dev_hardware_parts_ref_idx on public.dev_hardware_parts (job_ref);

-- Service role only: RLS on, no policies.
alter table public.dev_hardware_parts enable row level security;
