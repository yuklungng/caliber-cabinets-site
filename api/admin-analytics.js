/* global process */
import { checkAuth } from './_lib/auth.js';

/**
 * GET /api/admin-analytics
 * Fetches site stats from UptimeRobot and Cloudflare in parallel.
 *
 * Required env vars:
 *   UPTIMEROBOT_API_KEY   — from UptimeRobot > My Settings > API Settings
 *   CLOUDFLARE_API_TOKEN  — Cloudflare API token with Zone Analytics:Read permission
 *   CLOUDFLARE_ZONE_ID    — found in Cloudflare dashboard > domain > Overview (right sidebar)
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const [uptime, cloudflare] = await Promise.all([
    fetchUptimeRobot(),
    fetchCloudflare(),
  ]);

  return res.status(200).json({ uptime, cloudflare });
}

// ── UptimeRobot ──────────────────────────────────────────────────────────────

async function fetchUptimeRobot() {
  const key = process.env.UPTIMEROBOT_API_KEY;
  if (!key) return { configured: false };

  try {
    const res = await fetch('https://api.uptimerobot.com/v2/getMonitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        api_key: key,
        format: 'json',
        response_times: '1',
        response_times_limit: '24',
        custom_uptime_ratios: '7-30',
        all_time_uptime_ratio: '1',
      }),
    });

    if (!res.ok) return { configured: true, error: `UptimeRobot ${res.status}` };
    const data = await res.json();
    if (data.stat !== 'ok') return { configured: true, error: data.error?.message ?? 'Unknown error' };

    const monitors = (data.monitors ?? []).map((m) => {
      const avgResponseTime = m.response_times?.length
        ? Math.round(m.response_times.reduce((sum, r) => sum + r.value, 0) / m.response_times.length)
        : null;

      const [ratio7, ratio30] = (m.custom_uptime_ratio ?? '').split('-').map(Number);

      return {
        id: m.id,
        name: m.friendly_name,
        url: m.url,
        // 2=up, 9=seems down, 8=down, 0=paused, 1=not checked yet
        status: m.status === 2 ? 'up' : m.status === 9 ? 'seems_down' : m.status === 8 ? 'down' : 'paused',
        uptimeRatio7: ratio7 ?? null,
        uptimeRatio30: ratio30 ?? null,
        uptimeRatioAll: m.all_time_uptime_ratio ? Number(m.all_time_uptime_ratio) : null,
        avgResponseMs: avgResponseTime,
        lastChecked: m.last_alert_datetime ? new Date(m.last_alert_datetime * 1000).toISOString() : null,
      };
    });

    return { configured: true, monitors };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

// ── Cloudflare ───────────────────────────────────────────────────────────────

async function fetchCloudflare() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) return { configured: false };

  // Last 7 days, day by day
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const startDate = start.toISOString().split('T')[0];
  const endDate = end.toISOString().split('T')[0];

  const query = `
    query {
      viewer {
        zones(filter: { zoneTag: "${zoneId}" }) {
          httpRequests1dGroups(
            limit: 8
            filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum {
              requests
              pageViews
              bytes
              threats
              cachedRequests
            }
            uniq { uniques }
          }
          total: httpRequests1dGroups(
            limit: 1
            filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
          ) {
            sum {
              requests
              pageViews
              bytes
              threats
              cachedRequests
            }
            uniq { uniques }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return { configured: true, error: `Cloudflare ${res.status}` };
    const data = await res.json();

    if (data.errors?.length) {
      return { configured: true, error: data.errors[0]?.message ?? 'GraphQL error' };
    }

    const zone = data?.data?.viewer?.zones?.[0];
    if (!zone) return { configured: true, error: 'Zone not found — check CLOUDFLARE_ZONE_ID' };

    const daily = (zone.httpRequests1dGroups ?? []).map((d) => ({
      date: d.dimensions.date,
      requests: d.sum.requests,
      pageViews: d.sum.pageViews,
      bytes: d.sum.bytes,
      threats: d.sum.threats,
      cachedRequests: d.sum.cachedRequests,
      uniques: d.uniq.uniques,
    }));

    // Aggregate totals
    const totals = daily.reduce(
      (acc, d) => ({
        requests: acc.requests + d.requests,
        pageViews: acc.pageViews + d.pageViews,
        bytes: acc.bytes + d.bytes,
        threats: acc.threats + d.threats,
        cachedRequests: acc.cachedRequests + d.cachedRequests,
        uniques: acc.uniques + d.uniques,
      }),
      { requests: 0, pageViews: 0, bytes: 0, threats: 0, cachedRequests: 0, uniques: 0 },
    );

    const cacheHitRate = totals.requests > 0
      ? Math.round((totals.cachedRequests / totals.requests) * 100)
      : null;

    return {
      configured: true,
      period: { start: startDate, end: endDate },
      totals: { ...totals, cacheHitRate },
      daily,
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}
