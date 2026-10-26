# Production module SQL

These files are applied by hand, in order, and are never run by the app. Nothing here has been applied yet.

Rules:

- New tables only. Never alter an existing table for the module (live code reads `leads` and others with `select('*')`, and the CSV export and backup restore include every column).
- Every table is named `dev_<name>` until go-live, with RLS enabled and no policies (service role only). Go-live is a rename, or setting `PRODUCTION_DB_MODE=live` after the rename. `api/_lib/production.js` (`tbl()`) is the only place that builds these names.
- Apply to Caliber's live project only after Morris says so, with the Supabase connector showing project `jqgjgwrwrxmtdamjpctg`. A change is a write to live, so say what it does first.
- Each file is safe to run twice (`if not exists`).
- Rollback: `drop table` for the `dev_` tables. Nothing else depends on them.

| File | What it creates |
|---|---|
| `001_sheet_sync_raw.sql` | raw sheet rows, row history, sync runs and sync exceptions |
