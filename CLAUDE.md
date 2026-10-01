# CLAUDE.md — Caliber Cabinets website

Marketing site and internal admin/CRM panel for Caliber Cabinets, Inc. (custom cabinetry, Livermore CA; owner Mike Giannecchini; built and maintained by Morris Ng / NexPerion). React 19 + Vite SPA on Vercel with serverless functions in `/api`, Supabase (Postgres + Storage) for data, HubSpot as the CRM of record, QuickBooks Online for invoicing/payments, Gmail SMTP (nodemailer) for lead email. The public site lives at `/`; the admin panel at `/admin` (lazy-loaded, one large file: `src/pages/AdminPage.jsx`, 7,500+ lines).

**Spec doc:** `D:\Claude\Projects\Caliber Cabinets\caliber-website-spec.md` (outside this repo). It is the architecture/feature reference — read it for routes, env vars, integrations, and schema instead of re-deriving them here. Fully refreshed 2026-10-01 (previous version archived in `Archive\`). Trust the code and live DB over the spec where they disagree, and update the spec when they drift.

## Environment and git workflow (standing rules)

- Machine: Windows 11, **PowerShell** is the primary shell. Working repo: `D:\dev\caliber-cabinets` (not OneDrive-synced). `…\Website Redesign\project-dev` under OneDrive is an **old, stale clone** (HEAD from July) — do not edit or deploy from it.
- Deploys: push to `main` on `github.com/yuklungng/caliber-cabinets-site` auto-deploys to Vercel (live in ~30s). There is no staging branch in normal use, so every push is a production deploy.
- **Claude commits and pushes from the session shell, with Morris's OK each time.** Verified 2026-10-01: commit and push both worked first try from the desktop-app Git Bash session (no lock files). Ask before every push, since each push to `main` is a production deploy; a "yes" covers that commit only. Report commits by their message, not the hash. Commit messages end with the Co-Authored-By line from the session's attribution reminder.
- **Fallback to Morris's PowerShell** if git fails with `index.lock` / `HEAD.lock` errors (seen in the older sandbox shell) or a file must be deleted (`rm: Operation not permitted`). Don't retry in a loop; hand him the commands in this form:
  ```powershell
  cd "D:\dev\caliber-cabinets"
  Remove-Item ".git\index.lock" -Force -ErrorAction SilentlyContinue
  Remove-Item ".git\HEAD.lock" -Force -ErrorAction SilentlyContinue
  git add <explicit file paths>
  git commit -m "<type>(<scope>): <description>"
  git push origin main
  ```
- **Stage explicit paths, never `git add -A` / `commit -a`.** In the sandbox, `git status` shows many files as modified (e.g. `global.css`, `package.json`, `vercel.json`) that are pure CRLF/LF line-ending noise. Check with `git diff --ignore-space-at-eol --stat` — empty means no real change.
- Commit messages follow conventional style, lowercase: `feat(faq): …`, `fix(financial): …`, `perf(images): …`, `style(faq): …`, `content: …`.
- If a file must be removed from the repo, Morris does it in PowerShell (the sandbox can't). Old-versioned client deliverables get moved to an `Archive` subfolder, never deleted.

## Build and verification caveats

- The sandbox cannot run `vite build` (Windows-installed `node_modules`; the Linux rollup native module is missing). Verify instead with `node --check <file>` for `api/*.js` and `npx eslint <files>` for JSX.
- `npm run lint` has **pre-existing** errors in `AdminPage.jsx` (unused vars such as `getUser`, `formatBytes`, `quotesSentCount`). Don't treat those as regressions; check only for new ones in the lines you touched.
- Supabase MCP: the connector is authorized to **one org at a time**, and Morris switches it between his own org and Caliber's. Before any SQL/migration, run `list_projects` and confirm project `jqgjgwrwrxmtdamjpctg` ("Caliber Cabinets") is returned. If not, tell Morris to reconnect the connector and pick "Caliber Cabinets" in the OAuth org dropdown — don't diagnose.
- The HubSpot MCP connector points at **NexPerion's own portal (48956003), not Caliber's (245173274)**. Don't use it for Caliber data. Morris also lacks HubSpot UI access to Caliber's portal (needs Mike's login); structural changes go through the API.
- Lighthouse (DevTools) varies ±10 points run to run. Re-run 2–3 times or use pagespeed.web.dev before acting on a score change. Check whether the JS bundle hash actually changed.

## Landmines and non-obvious decisions

- **No new files in `/api`.** Vercel Hobby allows 12 serverless functions and `api/` has exactly 12 (a previous deploy broke on this). Helpers go in `api/_lib/` (not counted). The FAQ endpoint rides inside `admin-projects.js` via `?resource=faqs` → `api/_lib/faqs.js`. Add new endpoints the same way (dispatch on a query param) or consolidate.
- **No migration files.** The live Supabase DB is the source of truth (the spec's schema section mirrors it as of 2026-10-01). Before assuming a column or table exists, query `information_schema`. Schema changes are applied with SQL (MCP `apply_migration`, or Morris in the Supabase SQL editor), and the app code and DB must ship together — a column the code expects but the DB lacks fails at runtime, not build time. Tables beyond the spec: `payment_schedule`, `deal_payments`, `quickbooks_connection`, `faqs`, plus extra `leads`/`admin_users` columns.
- **Service-role key is server-only.** All data access goes through `/api/*` with `checkAuth` (`api/_lib/auth.js`). New tables use RLS enabled with no policies (service role only).
- **Caching:** the public FAQ GET sets `s-maxage=60`; the admin view uses `?all=1` to bypass it. Do **not** add edge caching to the public `admin-projects` GET — the admin panel shares that exact URL and would show stale lists after edits.
- **Email:** lead notifications and customer confirmations send via Gmail SMTP (`nodemailer`, env `GMAIL_APP_PASSWORD`, sending as `info@calibercabinetshop.com`). Uploaded files are sent as 1-year signed **links**, not attachments (Gmail's ~25MB cap vs. a 15-file limit). Resend was rejected on cost; Brevo/SES were discussed as free/cheap alternatives (nodemailer transporter swap + one-time DNS domain verification) but not built.
- **`SITE_URL` must use `www.`** (`https://www.calibercabinetshop.com`) — the apex redirects and strips auth headers on internal fetches (`analytics-snapshot` → `admin-analytics`).
- **Payment schedule model:** one QuickBooks invoice per room/split, paid down against three stages (Initial Deposit / Production / Final, default 50/45/5, `STAGE_ORDER` in `admin-cashflow.js`). `syncRoomGroupFromQbo` allocates payments by waterfall; QB-linked rows are locked in the UI; a group with its whole amount on one stage (100/0/0) is treated as unpriced and re-split to defaults, otherwise the deposit shows "Partially Paid" after a normal 50% payment. Auto-sync is throttled to limit Vercel Active CPU; HubSpot-direct-deal discovery runs at most once a day.
- **HubSpot is the source of truth for pipeline stage;** Supabase mirrors `hs_stage*` columns and syncs both ways. Stage IDs, `HS_PIPELINE`, `HS_EXIT_STAGES`, `HS_STAGE_COLORS` live at module scope in `AdminPage.jsx`; `EXIT_STAGE_IDS` must stay at module scope (scoping it into a component throws a `ReferenceError` in the other view). Adding a stage touches `AdminPage.jsx`, `api/_lib/hubspot.js`, `api/admin-leads.js`, and a Supabase `ALTER TABLE`.
- **Admin dark mode is a CSS `invert` filter** on the page. `position: fixed` overlays (modals, dropdowns, tooltips) must render through `FixedOverlay` (portal to `<body>`) or they mis-position when the page is scrolled.
- **Durations use business hours** (`businessDaysBetween` helpers), not calendar days — KPI tooltips state this.
- **FAQ system:** categories and their display order are the constant in `src/lib/faqCategories.js` (FAQs store the category name as text; sort is category order, then `sort_order`). `index.html` keeps a static FAQ JSON-LD block (`id="faq-jsonld"`) as a crawler fallback; `FaqSection.jsx` replaces it at runtime from the live published list. Homepage shows 6 at a time (even number keeps the 2-column grid balanced). Entries containing `[CONFIRM WITH MIKE]` are unpublished drafts — never publish them with the placeholder text in.
- **Images:** serve responsive WebP variants (`-900`, `-1350`) with `srcSet`/`sizes`; don't ship 2560px originals into small slots. Large PNG/JPG originals in `public/images` are kept for rollback and are mostly unused.
- **Public cards:** `<figure>` has a 40px default side margin — reset to 0 on card classes or they inset from the page container.
- **Business facts come from the contract, not memory:** payment 50/45/5, 2 design revisions then $195/hr, 1-year workmanship warranty, 30-day price lock, 3-day cancel right (Master Cabinetry Agreement, `…\Master Cabinetry Agreement Review\FINAL\`). Don't invent lead times, price ranges, or material sourcing for site copy — ask Mike.
- **Compliance:** before/after photos need written (email) client permission logged in HubSpot.

## Keeping this file and caliber-website-spec.md current

- Use judgment on when to update — don't update every session, but don't wait to be asked either.
- Update CLAUDE.md when: you hit a time-costly gotcha, make a design decision future work must respect, or a standing rule changes.
- Update the spec doc (`caliber-website-spec.md`) only for structural changes (schema/architecture/integrations) — not small bugfixes or UI tweaks.
- Any such update goes in the same commit as the code change, and say so explicitly. (The spec lives outside this repo, so for spec changes, state in the commit message/handoff that the spec was updated and give the path.) If unsure whether something is durable enough to add, ask Morris rather than skipping it silently.

## Outstanding / in-progress work

- **Kenny Wong payment statuses:** the 100/0/0 re-split fix is committed (`fix(financial): re-split…`). After deploy, click the refresh icon on each split to recompute; Kitchen and Laundry deposits should show Paid. Hall is genuinely under 50% paid in QuickBooks. Morris believes Kenny paid more — if so, the payments aren't applied to those invoices in QuickBooks.
- **FAQ content:** 9 hidden draft FAQs need Mike's real answers before publishing (showroom visit, quote turnaround, lead time, cost range, lump-sum rationale, plywood/materials, finishes, doors/drawer boxes, keeping existing countertops). Warranty FAQ uses the contract's 1-year term, while the old site redirected a "limited lifetime workmanship warranty" page — confirm with Mike.
- **Cleanup:** delete the stray `public/images/*-photo-600.webp` files (unused; created by the sandbox, which can't delete them).
- **Pending backlog:** draft SOPs for the admin features; reconcile the "Info Requested" stage with the showroom-first intake reversal; send Mike the 3D-preview proposal follow-ups; decide on moving off Gmail SMTP (Brevo/SES).
- **Optional perf:** separate public/admin URLs for projects so the public GET can be edge-cached; Lighthouse "image delivery" items re-check after the team-photo resize deploy.
