-- 008: which QuickBooks invoices belong to a Production job, one of them the primary (the job number).
-- A split-room job (one PO, one delivery and install, one combined payment per milestone) has an invoice
-- per room plus any change orders. A job with no rows here has one invoice: its own sheet number.
-- Rows are added by the office (never automatically) and removed by setting removed_at.
-- Additive and dev_ only. Rollback: drop table if exists public.dev_job_invoices;

create table if not exists public.dev_job_invoices (
  id              uuid        primary key default gen_random_uuid(),
  job_ref         text        not null,                 -- the job (sheet row's ref), as in the other tidy tables
  invoice_number  text        not null,                 -- digits only, no '#'
  is_primary      boolean     not null default false,
  source          text        not null check (source in ('sheet', 'deal', 'manual')),
  added_by        text,
  added_at        timestamptz not null default now(),
  removed_at      timestamptz,
  unique (job_ref, invoice_number)
);

-- One live primary per job.
create unique index if not exists dev_job_invoices_one_primary
  on public.dev_job_invoices (job_ref) where is_primary and removed_at is null;

-- An invoice belongs to at most one live job, so rows filed under it on the sheets roll up to that job.
create unique index if not exists dev_job_invoices_one_job
  on public.dev_job_invoices (invoice_number) where removed_at is null;

-- Service role only: RLS on, no policies.
alter table public.dev_job_invoices enable row level security;
