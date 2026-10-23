# Production module: Sheets to Supabase sync design

Draft, 2026-10-23. For Morris to review before anything is built.

## Rule

Google Sheets stay the system of record until cutover. Until then the sync is one way, Sheets into Supabase. The app never edits a sheet, with one exception: it writes a row ID into a hidden column (see Row identity). Every review stage runs on Mike's live data.

## Sources

Six sheets in the Caliber Drive folder. First sync covers the three that matter: Production Status, Install Schedule (plus its Comments tab) and Job Hardware Orders. In Stock Hardware, Services and Suppliers and Punch List are small and come later.

Access is a Google service account with the Sheets API, shared on each sheet as Editor (Editor only because of the ID column). The key lives in a Vercel env var and is never exposed to the browser.

## Row identity

The sheets have no stable key. Rows get inserted, sorted and copied, and job numbers repeat (#3830 is two different jobs). So the sync assigns each non-empty row a UUID in a hidden last column, `_id`.

- A copied populated row carries a duplicate `_id`. The later row gets a new one and an exception is logged.
- Empty formatted rows (the "copy an empty row" habit) have no `_id` until someone fills them.
- Job number and name are data, never the key.

## Tables (RLS on, no policies, service role only)

- `sheet_rows_raw`: sheet_key, row_id, row_number, raw jsonb, content_hash, first_seen_at, last_seen_at, removed_at.
- `sheet_row_versions`: previous raw values for the last 30 days, so any row can be reconstructed.
- `sync_runs`: started_at, finished_at, sheet_key, rows_seen, inserted, updated, removed, errors.
- `sync_exceptions`: sheet_key, row_id, code, detail, resolved_at.
- `production_jobs`, `install_events`, `hardware_orders`: normalized tables, fully derived from raw, never edited in the app before cutover, so they can be dropped and rebuilt. Shapes are decided at review stage 1.
- `job_links`: job_number to hubspot_deal_id and room, with matched_by and confirmed_by. Unmatched jobs stay visible. Matching is a screen in the portal, not guesswork.

## Sync cycle

- Endpoint: a new `api/production-sync.js`, called by Vercel Cron with a secret. Poll about every 10 minutes on weekdays 6am to 6pm Pacific, hourly otherwise. Admins also get a "Sync now" button.
- Read with `values.batchGet`. Hash each row. Upsert by `_id`. A row missing on two runs in a row is marked removed, not deleted. This guards against a read that lands mid-edit.
- Safety stop: if a run would remove more than 10% of a sheet's rows, abort and flag it.
- Kill switch: env `PRODUCTION_SYNC_ENABLED`.
- Cell images are not readable through the API, so only text syncs. Photos come in later as Drive links or app uploads.

## Parsing rules

- Year comes from the dates in the row, never from a section heading. Headings like "Installs 2019" and "FINISHED JOBS" are markers to skip. This fixes the unlabeled-2026 problem.
- Dates arrive as `03/26/19`, `3/25-3/26/19`, `04/17 - 4/18`. Parse ranges into start and end, and two-digit years as 20xx.
- A stage tick means done or not needed. Per-job-type stages (paint, stain, unfinished, doors only) are decided at review stage 1.

## Exceptions list

Visible to Mike and Morris in the portal, not buried in logs: missing job number; same job number on different names; unparseable date; stage cell not TRUE or FALSE; row with no job name; duplicate `_id`; unmatched to a HubSpot deal. Bad rows load anyway and are flagged. The list is also the cleanup checklist before launch.

## Recovery

- Sync is idempotent. Rebuilding everything from the sheets is one run.
- Raw history for 30 days plus Supabase backups. Do a real restore test before launch.
- If the portal is down, the sheets are untouched and still work.

## Cutover

1. Rehearse on a copy of the sheets and a branch database.
2. Pick a quiet day. Protect the sheet ranges. Run a final sync.
3. Check row counts and hashes against the sheets.
4. Flip the source of truth to the app. Turn on the Supabase to Sheets export (nightly plus on demand) into a Mike-owned copy.
5. Keep a snapshot of the original sheets for 30 days.
6. Go/no-go checklist signed off by Mike.

Emergency edits: unprotect the mirror, edit, and re-import afterward by a written procedure. Without it, the sheet and the app drift apart.

## Open items

1. Sheet ownership. The files are owned by Morris's personal Gmail, with Mike as Editor. Move them to a Mike-owned account before the sync is wired up, because the service account and the cutover export both point at specific file IDs.
2. Sync frequency against Vercel Active CPU cost. Measure after the first week.
3. Job Hardware Orders is 2.2 MB. Check whether images in cells inflate it before choosing a sync batch size.
4. Stages and dates (decided 2026-10-23). Mike sets each job's stage, and nobody else does. Delivery, install and completion dates are proposed automatically from the production schedule and stage progress, so Mike reviews and edits them instead of typing them from scratch. Only Mike's confirmed date is final, which keeps the 10/14 rule that only an admin sets these dates. Carlos and Anna see them read-only. The Financial tab reads the dates for payment timing and keeps its "estimated" label until Mike confirms. The automation rules (for example, weeks from paperwork in shop to delivery) need Mike's real numbers at review stage 1, not guesses.
   Two protections, because a proposed date that slips quietly would move when a payment falls due:
   - Every date shows its state, Proposed or Confirmed, everywhere it appears. The Financial tab treats Proposed as an estimate and Confirmed as real.
   - Nudge: an unconfirmed delivery date within 4 weeks raises an item in Action Items for Mike. The Production payment falls due 3 weeks before delivery (contract §7.3), so the date has to be confirmed before then. Install and completion dates get the same nudge on a shorter window. The windows are starting values, tuned with Mike.
5. OCR scan-to-text screen: accuracy bar and cost per scan, tested on about 30 real orders before building.
