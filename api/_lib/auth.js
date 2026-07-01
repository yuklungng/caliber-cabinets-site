/* global process */
import { createClient } from '@supabase/supabase-js';

/**
 * Validates a Bearer token from the request.
 * Supports two mechanisms:
 *   1. ADMIN_PASSWORD env var (emergency backdoor, always works)
 *   2. Session token UUID (created by /api/admin-auth on login)
 *
 * Returns { ok, isSuperAdmin, user }
 */
export async function checkAuth(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false };

  // Emergency backdoor — ADMIN_PASSWORD always works (legacy)
  if (process.env.ADMIN_PASSWORD && token === process.env.ADMIN_PASSWORD) {
    return {
      ok: true,
      isSuperAdmin: true,
      user: { name: 'Admin', email: 'admin', is_super_admin: true },
    };
  }

  // Internal snapshot token — SNAPSHOT_SECRET used by analytics-snapshot.js
  if (process.env.SNAPSHOT_SECRET && token === process.env.SNAPSHOT_SECRET) {
    return {
      ok: true,
      isSuperAdmin: false,
      user: { name: 'Snapshot', email: 'snapshot', is_super_admin: false },
    };
  }

  // Session token lookup
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    const { data: session } = await supabase
      .from('admin_sessions')
      .select('*, admin_users(*)')
      .eq('token', token)
      .single();

    if (!session) return { ok: false };

    if (new Date(session.expires_at) < new Date()) {
      await supabase.from('admin_sessions').delete().eq('token', token);
      return { ok: false };
    }

    return {
      ok: true,
      isSuperAdmin: session.admin_users?.is_super_admin ?? false,
      user: session.admin_users,
    };
  } catch {
    return { ok: false };
  }
}
