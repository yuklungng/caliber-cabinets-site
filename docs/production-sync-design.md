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

## Development isolation (decided 2026-10-26)

The module must not be able to affect Mike's live site or books while it is being built. First plan was a separate dev Supabase project. It was dropped: Morris's free org is full at two projects, and a project in Mike's org would add to his bill. The plan below uses Caliber's own database with new `dev_` tables and a read-only switch.

- Tables: every module table is new and named `dev_<name>` (for example `dev_sheet_rows_raw`, `dev_production_jobs`, `dev_job_links`), with RLS on and no policies. They are created only by SQL kept in `db/production/` and applied by hand. Nothing is ever added to an existing table for dev, because live code reads those with `select('*')` and the CSV export and backup restore include every column. Go-live is a table rename or one env change for the prefix. A table-name helper adds `dev_` by default, so a mistake lands in dev.
- Read-only preview: the Hobby preview runs with `READ_ONLY_PREVIEW=1`. `api/_lib/readonly.js`, imported by every `api/*.js`, refuses every Supabase, HubSpot and QuickBooks write except writes to `dev_*` tables and `admin_sessions` (so sign-in works), HubSpot POSTs that are searches or batch reads, and QuickBooks POSTs to `/query`. It also blocks QuickBooks token refresh and revoke, because Intuit rotates the refresh token on every use and a new token that cannot be saved would break Mike's connection. `lead-submit` returns 403 so no email or HubSpot write happens. `node scripts/test-readonly.mjs` checks it. The flag is never set on Mike's project.
- Consequence: the existing admin on the preview can be browsed but not edited, and write-path fixes to existing features cannot be tested there. QuickBooks calls on the preview work only while the stored access token is valid.
- Credentials: remove the live QuickBooks and HubSpot keys from the Hobby project anyway. QuickBooks development uses an Intuit sandbox company.
- Code: everything sits behind `PRODUCTION_MODULE_ENABLED`, default off. With the flag off the admin tab is not rendered and the module's API endpoint returns 404. Small pieces merge to `main` dark. Mike's project gets the flag only at a stage review.
- Schema: additive only (new tables, no changes to existing ones), so rollback is flag off and dropping the `dev_` tables. This is the one exception to "no migration files", because we need a record of what ran.
- Cron: the sync schedule is added to `vercel.json` only when a stage needs it, behind `PRODUCTION_SYNC_ENABLED`, default off. Vercel runs crons only on production deployments.
- Sheets: developed against a copy that Morris owns. Mike's originals are touched only at cutover, after ownership moves to Mike. Because the data lands in Mike's own database, stage reviews can use real jobs and no customer data leaves his account.
- Verification: after each change, the commit hash in the admin corner stamp is checked on both sites (preview and Mike's), so everyone knows what is deployed where.
- What is given up: this is not a hard boundary. The preview still holds the live service-role key, so keeping to `dev_` depends on code, and the read-only switch is the safety net. A stronger version is a Postgres role limited to read plus `dev_` tables, used by the preview in place of the service key. That needs database work on the live project and is not planned.

## Purchasing and cost capture (later phase, separate scope)

Not part of the five review stages. Recorded here so the production tables leave room for it.

Why: QuickBooks does not track inventory. Parts are in the item catalog but never counted. Job cost exists only where a bill was assigned to a customer, and the first read-only report (2026-10-24) found most spend carries no job. The exact baseline is in the OneDrive findings doc, not here, because this repo is public. Pricing, cash flow and estimating all depend on knowing what a job actually cost.

Design:

- Order capture. A photo of a handwritten order becomes text, tied to a job number. Mike or Carlos confirms it on a review screen before anything is created. Parsed text is never trusted on its own.
- One owner per fact. The module owns what was ordered and for which job. QuickBooks owns the money. Each order stores its QuickBooks purchase order ID, and the PO carries the order number, so either side can find the other.
- Purchase orders, never bills. A QuickBooks PO does not post to the books. When the vendor invoice arrives, the bookkeeper converts the PO to a bill, and the difference between PO and bill is the reconciliation. The module never writes bills.
- Prices. An order has no price when it is written. The PO amount is an estimate from the catalog or the last price paid. Actual cost arrives with the bill.
- Failure behavior. If QuickBooks is down or the token refresh fails, the order still saves and the PO is queued and retried. Ordering never waits on accounting.
- No duplicates. One PO per order, with a stored idempotency key.
- Safe development. The write path is built and tested only against an Intuit sandbox company, behind its own env flag. Nothing writes to Caliber's live books until Mike approves a go-live.

Gates:

1. Read only. Capture orders in the module and show them next to QuickBooks bills. No writes.
2. Sandbox POs.
3. Live POs, each approved by Mike.
4. PO to bill variance report, and cost data feeding estimates (including comparing our quote with a competitor's number from the lost-deal fields).

Measure of success: the share of spend that carries a job, from the same report, before and after. It is a number Mike can see, and it needs no one to be blamed.

Before this phase starts:

- Confirm Caliber's QuickBooks plan supports purchase orders.
- Learn how each major vendor is actually ordered (portal, email, phone) and who places the order. If most orders happen outside the notebook, the module records after the fact and gets weaker.
- Get Brianna involved before Mike. Converting PO to bill is her step, and her adoption decides whether the data is complete.
- Break down the untagged spend by account and vendor, and group the report by job number, not customer, before any conclusion about the books or about margin.

## Open items

1. Sheet ownership. The files are owned by Morris's personal Gmail, with Mike as Editor. Move them to a Mike-owned account before the sync is wired up, because the service account and the cutover export both point at specific file IDs.
2. Sync frequency against Vercel Active CPU cost. Measure after the first week.
3. Job Hardware Orders is 2.2 MB. Check whether images in cells inflate it before choosing a sync batch size.
4. Stages and dates (decided 2026-10-23). Mike sets each job's stage, and nobody else does. Delivery, install and completion dates are proposed automatically from the production schedule and stage progress, so Mike reviews and edits them instead of typing them from scratch. Only Mike's confirmed date is final, which keeps the 10/14 rule that only an admin sets these dates. Carlos and Anna see them read-only. The Financial tab reads the dates for payment timing and keeps its "estimated" label until Mike confirms. The automation rules (for example, weeks from paperwork in shop to delivery) need Mike's real numbers at review stage 1, not guesses.
   Two protections, because a proposed date that slips quietly would move when a payment falls due:
   - Every date shows its state, Proposed or Confirmed, everywhere it appears. The Financial tab treats Proposed as an estimate and Confirmed as real.
   - Nudge: an unconfirmed delivery date within 4 weeks raises an item in Action Items for Mike. The Production payment falls due 3 weeks before delivery (contract §7.3), so the date has to be confirmed before then. Install and completion dates get the same nudge on a shorter window. The windows are starting values, tuned with Mike.
5. OCR scan-to-text screen: accuracy bar and cost per scan, tested on about 30 real orders before building.
6. Purchasing and cost capture (section above): scope and price separately once the open questions there are answered. Cost capture and estimating go well beyond the production-sheets price.
7. Free-text fields: the QuickBooks Sales Type on invoices has four spellings of Lump Sum. The module uses a fixed list.
