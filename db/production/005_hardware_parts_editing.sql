-- Editing support for hardware parts. Additive and dev_ only.
-- source: 'sheet' = read from the OCR text, 'manual' = added on screen.
-- edited: a person changed or removed the row, so the sheet re-read (normalize) must leave it alone.
alter table public.dev_hardware_parts
  add column if not exists source    text        not null default 'sheet' check (source in ('sheet', 'manual')),
  add column if not exists edited    boolean     not null default false,
  add column if not exists edited_by text,
  add column if not exists edited_at timestamptz;
