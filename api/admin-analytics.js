/* global process */
import crypto from 'crypto';
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

  const [uptime, turnstile, ga, gsc, cloudflare] = await Promise.all([
    fetchUptimeRobot(),
    fetchTurnstile(accountId),
    fetchGoogleAnalytics(),
    fetchSearchConsole(),
    fetchCloudflare(),
  ]);

  return res.status(200).json({ uptime, turnstile, ga, gsc, cloudflare });
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

  // Cloudflare caps Turnstile at 1w1h. Date filters snap to midnight, so
  // 7 days back overshoots by ~18h. Use 6 days to stay safely under the limit.
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
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

// ── Google Analytics 4 ───────────────────────────────────────────────────────

async function getGoogleAccessToken(serviceAccount, scope = 'https://www.googleapis.com/auth/analytics.readonly') {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const signingInput = `${header}.${payload}`;
  const privateKey = (serviceAccount.private_key ?? '').replace(/\\n/g, '\n');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey, 'base64url');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error(tokenData.error_description ?? 'Failed to get GA access token');
  return tokenData.access_token;
}

async function gaReport(accessToken, propertyId, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return res.json();
}

async function fetchGoogleAnalytics() {
  const saJson = process.env.GA_SERVICE_ACCOUNT_JSON;
  const propertyId = process.env.GA_PROPERTY_ID;
  if (!saJson || !propertyId) return { configured: false };

  let serviceAccount;
  try { serviceAccount = JSON.parse(saJson); }
  catch { return { configured: true, error: 'Invalid GA_SERVICE_ACCOUNT_JSON — check Vercel env var' }; }

  try {
    const token = await getGoogleAccessToken(serviceAccount);

    // Run five reports in parallel
    const [dailyData, pagesData, sourcesData, geoData, deviceData] = await Promise.all([
      gaReport(token, propertyId, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'sessions' }, { name: 'activeUsers' },
          { name: 'screenPageViews' }, { name: 'newUsers' },
          { name: 'bounceRate' }, { name: 'averageSessionDuration' },
          { name: 'engagementRate' }, { name: 'screenPageViewsPerSession' },
        ],
        dimensions: [{ name: 'date' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
      }),
      gaReport(token, propertyId, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
        metrics: [{ name: 'screenPageViews' }],
        dimensions: [{ name: 'pagePath' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 5,
      }),
      gaReport(token, propertyId, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 6,
      }),
      // City-level geo — more useful than country for a local Tri-Valley business
      gaReport(token, propertyId, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }],
        dimensions: [{ name: 'city' }, { name: 'region' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      // Device category: mobile / desktop / tablet
      gaReport(token, propertyId, {
        dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
        metrics: [{ name: 'sessions' }, { name: 'engagementRate' }],
        dimensions: [{ name: 'deviceCategory' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      }),
    ]);

    if (dailyData.error) return { configured: true, error: dailyData.error.message };

    const daily = (dailyData.rows ?? []).map((row) => {
      const d = row.dimensionValues[0].value; // YYYYMMDD
      return {
        date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
        sessions: Number(row.metricValues[0].value),
        users: Number(row.metricValues[1].value),
        pageViews: Number(row.metricValues[2].value),
        newUsers: Number(row.metricValues[3].value),
        bounceRate: Number(row.metricValues[4].value),
        avgDuration: Number(row.metricValues[5].value),
        engagementRate: Number(row.metricValues[6].value),
        pagesPerSession: Number(row.metricValues[7].value),
      };
    });

    const totals = daily.reduce(
      (acc, d) => ({ sessions: acc.sessions + d.sessions, users: acc.users + d.users, pageViews: acc.pageViews + d.pageViews, newUsers: acc.newUsers + d.newUsers }),
      { sessions: 0, users: 0, pageViews: 0, newUsers: 0 },
    );

    const avgBounceRate = daily.length
      ? Math.round(daily.reduce((s, d) => s + d.bounceRate, 0) / daily.length * 100)
      : null;
    const avgDuration = daily.length
      ? Math.round(daily.reduce((s, d) => s + d.avgDuration, 0) / daily.length)
      : null;
    const avgEngagement = daily.length
      ? Math.round(daily.reduce((s, d) => s + d.engagementRate, 0) / daily.length * 100)
      : null;
    const avgPagesPerSession = daily.length
      ? Math.round(daily.reduce((s, d) => s + d.pagesPerSession, 0) / daily.length * 10) / 10
      : null;

    const topPages = (pagesData.rows ?? []).map((r) => ({
      page: r.dimensionValues[0].value,
      views: Number(r.metricValues[0].value),
    }));

    const sources = (sourcesData.rows ?? []).map((r) => ({
      channel: r.dimensionValues[0].value,
      sessions: Number(r.metricValues[0].value),
    }));

    const geo = (geoData.rows ?? [])
      .filter((r) => r.dimensionValues[0].value !== '(not set)')
      .map((r) => ({
        city: r.dimensionValues[0].value,
        region: r.dimensionValues[1].value,
        sessions: Number(r.metricValues[0].value),
      }));

    const devices = (deviceData.rows ?? []).map((r) => ({
      device: r.dimensionValues[0].value,
      sessions: Number(r.metricValues[0].value),
      engagementRate: Math.round(Number(r.metricValues[1].value) * 100),
    }));

    return {
      configured: true,
      period: 'last 28 days',
      totals: { ...totals, avgBounceRate, avgDuration, avgEngagement, avgPagesPerSession },
      daily,
      topPages,
      sources,
      geo,
      devices,
    };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

// ── Google Search Console ────────────────────────────────────────────────────

async function fetchSearchConsole() {
  const saJson = process.env.GA_SERVICE_ACCOUNT_JSON;
  const siteUrl = process.env.SEARCH_CONSOLE_SITE;
  if (!saJson || !siteUrl) return { configured: false };

  let serviceAccount;
  try { serviceAccount = JSON.parse(saJson); }
  catch { return { configured: true, error: 'Invalid GA_SERVICE_ACCOUNT_JSON' }; }

  try {
    const token = await getGoogleAccessToken(serviceAccount, 'https://www.googleapis.com/auth/webmasters.readonly');
    const encodedSite = encodeURIComponent(siteUrl);
    const base = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const body = (extra) => JSON.stringify({ startDate, endDate, ...extra });

    const [overviewRes, queriesRes, pagesRes, dailyRes] = await Promise.all([
      fetch(base, { method: 'POST', headers, body: body({ rowLimit: 1 }) }),
      fetch(base, { method: 'POST', headers, body: body({ dimensions: ['query'], rowLimit: 10 }) }),
      fetch(base, { method: 'POST', headers, body: body({ dimensions: ['page'], rowLimit: 5 }) }),
      fetch(base, { method: 'POST', headers, body: body({ dimensions: ['date'], rowLimit: 28 }) }),
    ]);

    const [overview, queriesData, pagesData, dailyData] = await Promise.all([
      overviewRes.json(), queriesRes.json(), pagesRes.json(), dailyRes.json(),
    ]);

    if (overview.error) return { configured: true, error: overview.error.message };

    const t = overview.rows?.[0] ?? {};
    const totals = {
      clicks: t.clicks ?? 0,
      impressions: t.impressions ?? 0,
      ctr: t.ctr != null ? Math.round(t.ctr * 100) : 0,
      position: t.position != null ? Math.round(t.position * 10) / 10 : null,
    };

    const queries = (queriesData.rows ?? []).map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: Math.round(r.ctr * 100),
      position: Math.round(r.position * 10) / 10,
    }));

    // Strip domain prefix from page URLs for readability
    const stripDomain = (url) => url
      .replace('https://calibercabinetshop.com', '')
      .replace('https://caliber-cabinets-site.vercel.app', '')
      || '/';

    const pages = (pagesData.rows ?? []).map((r) => ({
      page: stripDomain(r.keys[0]),
      fullUrl: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    }));

    const daily = (dailyData.rows ?? [])
      .sort((a, b) => a.keys[0].localeCompare(b.keys[0]))
      .map((r) => ({
        date: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Math.round(r.ctr * 100),
        position: Math.round(r.position * 10) / 10,
      }));

    return { configured: true, period: `${startDate} to ${endDate}`, totals, queries, pages, daily };
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
