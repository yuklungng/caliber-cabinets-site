/* global process */
import { checkAuth } from './_lib/auth.js';

/**
 * GET /api/admin-analytics
 * Fetches site stats from UptimeRobot, Cloudflare Turnstile, and Cloudflare Traffic.
 *
 * Env vars:
 *   UPTIMEROBOT_API_KEY     — UptimeRobot > My Settings > API Settings > Main API Key
 *   CLOUDFLARE_API_TOKEN    — Cloudflare API token with Account Analytics:Read
 *   CLOUDFLARE_ACCOUNT_ID   — Cloudflare dashboard URL: dash.cloudflare.com/<THIS>/home
 *   CLOUDFLARE_ZONE_ID      — (future) for traffic analytics when proxying is enabled
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  const [uptime, turnstile, cloudflare] = await Promise.all([
    fetchUptimeRobot(),
    fetchTurnstile(accountId),
    fetchCloudflare(),
  ]);

  return res.status(200).json({ uptime, turnstile, cloudflare });
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
        status: m.status === 2 ? 'up' : m.status === 9 ? 'seems_down' : m.status === 8 ? 'down' : 'paused',
        uptimeRatio7: ratio7 ?? null,
        uptimeRatio30: ratio30 ?? null,
        uptimeRatioAll: m.all_time_uptime_ratio ? Number(m.all_time_uptime_ratio) : null,
        avgResponseMs: avgResponseTime,
      };
    });

    // Filter to Caliber monitors only — matches current Vercel URL and future calibercabinetshop.com
    const filtered = monitors.filter((m) => m.url?.toLowerCase().includes('caliber'));
    return { configured: true, monitors: filtered };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

// ── Cloudflare Turnstile ─────────────────────────────────────────────────────

async function fetchTurnstile(accountId) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token || !accountId) return { configured: false };

  // Last 30 days for Turnstile — gives better context than 7
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const startDate = start.toISOString().split('T')[0];
  const endDate = end.toISOString().split('T')[0];

  // Two queries in one: successful tokens by date, and failed/non-token attempts by date
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        passed: turnstileAdaptiveGroups(
          limit: 100
          filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
          orderBy: [date_ASC]
        ) {
          dimensions { date siteKey }
          count
        }
        failed: challengeReportsGroups(
          limit: 100
          filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
          orderBy: [date_ASC]
        ) {
          dimensions { date }
          count
        }
      }
    }
  }`;

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) return { configured: true, error: `Cloudflare ${res.status}: ${await res.text()}` };
    const data = await res.json();

    if (data.errors?.length) {
      // Fall back to tokens-only query if the combined query fails
      return fetchTurnstileSimple(accountId, token, startDate, endDate);
    }

    const account = data?.data?.viewer?.accounts?.[0];
    const passedGroups = account?.passed ?? [];
    const failedGroups = account?.failed ?? [];

    // Aggregate passed by date
    const byDate = {};
    let totalPassed = 0;

    for (const g of passedGroups) {
      const date = g.dimensions?.date;
      const count = g.count ?? 0;
      totalPassed += count;
      if (date) {
        if (!byDate[date]) byDate[date] = { date, passed: 0, failed: 0 };
        byDate[date].passed += count;
      }
    }

    let totalFailed = 0;
    for (const g of failedGroups) {
      const date = g.dimensions?.date;
      const count = g.count ?? 0;
      totalFailed += count;
      if (date) {
        if (!byDate[date]) byDate[date] = { date, passed: 0, failed: 0 };
        byDate[date].failed += count;
      }
    }

    const daily = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    const totalLoads = totalPassed + totalFailed;
    const solveRate = totalLoads > 0 ? Math.round((totalPassed / totalLoads) * 100) : null;

    return {
      configured: true,
      period: { start: startDate, end: endDate },
      totals: { pageLoads: totalLoads, verified: totalPassed, blocked: totalFailed, solveRate },
      daily,
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

// Fallback: tokens-only if challengeReportsGroups isn't available
async function fetchTurnstileSimple(accountId, token, startDate, endDate) {
  const query = `{
    viewer {
      accounts(filter: { accountTag: "${accountId}" }) {
        turnstileAdaptiveGroups(
          limit: 100
          filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
          orderBy: [date_ASC]
        ) {
          dimensions { date siteKey }
          count
        }
      }
    }
  }`;

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { configured: true, error: `Cloudflare ${res.status}` };
    const data = await res.json();
    if (data.errors?.length) return { configured: true, error: data.errors.map((e) => e.message).join('; ') };

    const groups = data?.data?.viewer?.accounts?.[0]?.turnstileAdaptiveGroups ?? [];
    const byDate = {};
    let total = 0;

    for (const g of groups) {
      const date = g.dimensions?.date;
      const count = g.count ?? 0;
      total += count;
      if (date) {
        if (!byDate[date]) byDate[date] = { date, passed: 0, failed: 0 };
        byDate[date].passed += count;
      }
    }

    return {
      configured: true,
      simpleMode: true, // flag so UI knows blocked count isn't available
      period: { start: startDate, end: endDate },
      totals: { pageLoads: total, verified: total, blocked: null, solveRate: null },
      daily: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)),
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

// ── Cloudflare Traffic (requires orange-cloud proxying) ──────────────────────

async function fetchCloudflare() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) return { configured: false };

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  const startDate = start.toISOString().split('T')[0];
  const endDate = end.toISOString().split('T')[0];

  const query = `{
    viewer {
      zones(filter: { zoneTag: "${zoneId}" }) {
        httpRequests1dGroups(
          limit: 8
          filter: { date_geq: "${startDate}", date_leq: "${endDate}" }
          orderBy: [date_ASC]
        ) {
          dimensions { date }
          sum { requests pageViews bytes threats cachedRequests }
          uniq { uniques }
        }
      }
    }
  }`;

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
    if (data.errors?.length) return { configured: true, error: data.errors[0]?.message };

    const zone = data?.data?.viewer?.zones?.[0];
    if (!zone) return { configured: true, error: 'Zone not found' };

    const daily = (zone.httpRequests1dGroups ?? []).map((d) => ({
      date: d.dimensions.date,
      requests: d.sum.requests,
      pageViews: d.sum.pageViews,
      bytes: d.sum.bytes,
      threats: d.sum.threats,
      cachedRequests: d.sum.cachedRequests,
      uniques: d.uniq.uniques,
    }));

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

    return {
      configured: true,
      period: { start: startDate, end: endDate },
      totals: {
        ...totals,
        cacheHitRate: totals.requests > 0
          ? Math.round((totals.cachedRequests / totals.requests) * 100)
          : null,
      },
      daily,
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}
