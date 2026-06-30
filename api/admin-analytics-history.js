/* global process */
import { createClient } from '@supabase/supabase-js';
import { checkAuth } from './_lib/auth.js';

/**
 * GET /api/admin-analytics-history?months=12
 *
 * Returns historical daily rows from the three analytics snapshot tables.
 * Data is accumulated by /api/admin-analytics on every admin page load.
 *
 * Response:
 *   { ga: DailyRow[], gsc: DailyRow[], turnstile: DailyRow[] }
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const months = Math.min(Math.max(parseInt(req.query.months ?? '12', 10), 1), 36);
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  const sinceDate = since.toISOString().split('T')[0];

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const [gaRes, gscRes, tsRes] = await Promise.all([
    supabase
      .from('analytics_ga_daily')
      .select('date, sessions, users, page_views, new_users, bounce_rate, avg_duration, engagement_rate, pages_per_session')
      .gte('date', sinceDate)
      .order('date', { ascending: true }),

    supabase
      .from('analytics_gsc_daily')
      .select('date, clicks, impressions, ctr, position')
      .gte('date', sinceDate)
      .order('date', { ascending: true }),

    supabase
      .from('analytics_turnstile_daily')
      .select('date, passed, failed')
      .gte('date', sinceDate)
      .order('date', { ascending: true }),
  ]);

  if (gaRes.error)  console.error('[analytics-history] GA query error:',        gaRes.error.message);
  if (gscRes.error) console.error('[analytics-history] GSC query error:',       gscRes.error.message);
  if (tsRes.error)  console.error('[analytics-history] Turnstile query error:', tsRes.error.message);

  return res.status(200).json({
    since:     sinceDate,
    months,
    ga:        gaRes.data  ?? [],
    gsc:       gscRes.data ?? [],
    turnstile: tsRes.data  ?? [],
  });
}
