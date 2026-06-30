/* global process */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  const supabase = db();

  // GET — check if first-time setup is needed (no users in DB yet)
  if (req.method === 'GET') {
    try {
      const { count, error } = await supabase
        .from('admin_users')
        .select('*', { count: 'exact', head: true });
      if (error) return res.status(200).json({ needsSetup: false });
      return res.status(200).json({ needsSetup: count === 0 });
    } catch {
      return res.status(200).json({ needsSetup: false });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, name, email, password } = req.body ?? {};

  // ── Setup: create first super admin ────────────────────────────────────────
  if (action === 'setup') {
    const { count } = await supabase
      .from('admin_users')
      .select('*', { count: 'exact', head: true });
    if (count > 0) {
      return res.status(400).json({ error: 'Setup already complete' });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const { error } = await supabase.from('admin_users').insert({
      name,
      email: email.toLowerCase().trim(),
      password_hash,
      is_super_admin: true,
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  if (action === 'login') {
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: user } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    let authenticated = false;
    let authUser = user;

    if (user && (await bcrypt.compare(password, user.password_hash))) {
      authenticated = true;
    } else if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
      // Env var backdoor — grants access regardless of email
      authenticated = true;
      authUser = { id: null, name: 'Admin', email, is_super_admin: true };
    }

    if (!authenticated) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create session (7-day expiry)
    const token = randomUUID();
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('admin_sessions').insert({
      token,
      user_id: authUser?.id ?? null,
      expires_at,
    });

    return res.status(200).json({
      token,
      user: {
        name: authUser?.name ?? 'Admin',
        email: authUser?.email ?? email,
        is_super_admin: authUser?.is_super_admin ?? false,
      },
    });
  }

  // ── Logout ──────────────────────────────────────────────────────────────────
  if (action === 'logout') {
    const auth = req.headers.authorization ?? '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token) await supabase.from('admin_sessions').delete().eq('token', token);
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
