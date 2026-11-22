# Production module SQL

These files are applied by hand, in order, and are never run by the app. Record each one in the table below when it is applied.

Rules:

- New tables only. Never alter an existing table for the module (live code reads `leads` and others with `select('*')`, and the CSV export and backup restore include every column).
- Every table is named `dev_<name>` until go-live, with RLS enabled and no policies (service role only). Go-live is a rename, or setting `PRODUCTION_DB_MODE=live` after the rename. `api/_lib/production.js` (`tbl()`) is the only place that builds these names.
- Apply to Caliber's live project only after Morris says so, with the Supabase connector showing project `jqgjgwrwrxmtdamjpctg`. A change is a write to live, so say what it does first.
- Each file is safe to run twice (`if not exists`).
- Rollback: `drop table` for the `dev_` tables. Nothing else depends on them.

| File | What it creates | Applied |
|---|---|---|
| `001_sheet_sync_raw.sql` | raw sheet rows, row history, sync runs and sync exceptions | 2026-10-26 to Caliber's live project (`jqgjgwrwrxmtdamjpctg`) as migration `production_001_sheet_sync_raw`; four empty `dev_` tables, RLS on, existing tables untouched |
| `006_job_links_room.sql` | `room` column on `dev_job_links` (which room group / invoice of the deal a job is linked to) | 2026-11-16 to Caliber's live project as migration `production_006_job_links_room`; one nullable column on a dev table, existing tables untouched |
| `007_job_step_ticks.sql` | `dev_job_step_ticks`: step boxes ticked or unticked on the Shop view, one row per job (sheet row) and step | 2026-11-17 to Caliber's live project as migration `production_007_job_step_ticks`; one empty `dev_` table, RLS on, existing tables untouched |
| `008_job_invoices.sql` | `dev_job_invoices`: which QuickBooks invoices belong to a job, one live primary per job, an invoice on at most one live job | 2026-11-22 to Caliber's live project as migration `production_008_job_invoices`; one empty `dev_` table, RLS on, existing tables untouched |
