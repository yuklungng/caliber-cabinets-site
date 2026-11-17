-- 006: which room group (invoice) of a deal a Production job is linked to.
-- A deal can be split into rooms in Financial Management, each with its own QuickBooks invoice,
-- so a job links to a deal plus a room. Dev table only; safe to run twice.
-- Rollback: alter table public.dev_job_links drop column if exists room;

alter table public.dev_job_links add column if not exists room text;
