/* global process */

/**
 * GET /api/analytics-snapshot?key=SNAPSHOT_SECRET
 *
 * Lightweight trigger endpoint for UptimeRobot (or any cron/monitor service).
 * When hit, it calls /api/admin-analytics internally using ADMIN_PASSWORD, which
 * runs the full GA + GSC + Turnstile fetch and upserts daily rows to Supabase.
 *
 * UptimeRobot monitor URL:
 *   https://calibercabinetshop.com/api/analytics-snapshot?key=<SNAPSHOT_SECRET>
 * Monitor type: HTTP(s) keyword · keyword: "ok":true
 * Interval: every 24 hours (or less for more frequent snapshots)
 *
 * Required env vars (add in Vercel → Project Settings → Environment Variables):
 *   SNAPSHOT_SECRET   — any random string, must match the key= param in UptimeRobot
 *   ADMIN_PASSWORD    — already set; used to authenticate the internal analytics call
 *   SITE_URL          — e.g. https://calibercabinetshop.com (no trailing slash)
 */
export default async function handler(req, res) {
  // UptimeRobot's HTTP(s) monitor sends HEAD requests — accept both GET and HEAD.
  // The analytics fetch runs on either; HEAD responses have no body (stripped by HTTP layer).
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).json({ error: 'Method not allowed' });

  // Validate snapshot secret
  const secret = process.env.SNAPSHOT_SECRET;
  if (!secret) return res.status(500).json({ error: 'SNAPSHOT_SECRET env var not set' });
  if (req.query.key !== secret) return res.status(401).json({ error: 'Unauthorized' });

  // Resolve base URL — prefer explicit SITE_URL, fall back to Vercel automatic vars
  const siteUrl = process.env.SITE_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? (process.env.VERCEL_URL                    ? `https://${process.env.VERCEL_URL}`                    : null)
    ?? 'http://localhost:3000';

  const triggeredAt = new Date().toISOString();

  try {
    // Use SNAPSHOT_SECRET as the internal auth token — no separate ADMIN_PASSWORD needed
    const r = await fetch(`${siteUrl}/api/admin-analytics`, {
      headers: { Authorization: `Bearer ${secret}` },
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error(`[analytics-snapshot] admin-analytics returned ${r.status}:`, detail);
      return res.status(502).json({ ok: false, error: `admin-analytics returned ${r.status}` });
    }

    // Response from admin-analytics confirms fetch succeeded; persist ran as side effect.
    return res.status(200).json({ ok: true, triggered_at: triggeredAt });
  } catch (err) {
    console.error('[analytics-snapshot] fetch error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
