-- Step boxes ticked (or unticked) on the Shop view. One row per job and step; the newest tap wins.
-- Keyed by the job's sheet row (source_row_id), not job_ref: a few job numbers are shared by two jobs, and a
-- temporary ref changes when the invoice number is filled in.
-- The Production Status sheet is never written: the job list shows the sheet's box unless a row here says otherwise.
-- Additive and dev_ only.
create table if not exists public.dev_job_step_ticks (
  job_row_id  uuid        not null,              -- dev_production_jobs.source_row_id
  job_ref     text        not null,              -- the job's ref when ticked, for reading the table by eye
  step        text        not null,              -- the step name as the sheet heads it, e.g. 'Body Cut'
  done        boolean     not null,
  ticked_by   text        not null,
  ticked_at   timestamptz not null default now(),
  primary key (job_row_id, step)
);

-- Service role only: RLS on, no policies.
alter table public.dev_job_step_ticks enable row level security;
