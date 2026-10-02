/* global process */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'crypto';
import nodemailer from 'nodemailer';

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const RESET_TTL_MS = 60 * 60 * 1000;      // reset links last 1 hour
const RESET_RESEND_MS = 60 * 1000;        // at most one email per user per minute
const MIN_PASSWORD_LENGTH = 8;

// Only the hash is stored, so a DB read alone can't be used to take over an account.
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Built from SITE_URL (must use www., see CLAUDE.md), never from the request
// Host header, so a forged Host can't redirect reset links to another domain.
const siteUrl = () => (process.env.SITE_URL || 'https://www.calibercabinetshop.com').replace(/\/$/, '');

async function sendResetEmail(to, name, link) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: 'mike@calibercabinetshop.com', pass: process.env.GMAIL_APP_PASSWORD },
  });
  const first = (name || '').split(' ')[0] || 'there';
  await transporter.sendMail({
    from: '"Caliber Cabinets" <info@calibercabinetshop.com>',
    to,
    subject: 'Reset your Caliber Cabinets admin password',
    text: `Hi ${first},\n\nWe received a request to reset your admin password. Use this link within 1 hour:\n\n${link}\n\nIf you didn't request this, you can ignore this email. Your password won't change.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111827">
        <div style="background:#78350f;color:#fff;padding:18px 24px;font-size:18px;font-weight:700;border-radius:8px 8px 0 0">Caliber Cabinets</div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 12px">Hi ${first.replace(/[<>&]/g, '')},</p>
          <p style="margin:0 0 18px">We received a request to reset your admin password. This link works for 1 hour.</p>
          <p style="margin:0 0 22px"><a href="${link}" style="background:#78350f;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-weight:700;display:inline-block">Reset password</a></p>
          <p style="margin:0 0 6px;font-size:12px;color:#6b7280">Or paste this into your browser:<br>${link}</p>
          <p style="margin:14px 0 0;font-size:12px;color:#6b7280">If you didn't request this, ignore this email. Your password won't change.</p>
        </div>
      </div>`,
  });
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
      role: 'staff',
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
      authUser = { id: null, name: 'Admin', email, is_super_admin: true, role: 'staff' };
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
        role: authUser?.role ?? 'staff',
      },
    });
  }

  // ── Forgot password: email a single-use reset link ──────────────────────────
  // Always answers the same way whether or not the email exists, so this can't
  // be used to discover which addresses have accounts.
  if (action === 'forgot') {
    const generic = { success: true, message: 'If that email has an account, a reset link is on its way.' };
    const addr = String(email ?? '').toLowerCase().trim();
    if (!addr) return res.status(400).json({ error: 'Email is required' });
    if (!process.env.GMAIL_APP_PASSWORD) {
      console.error('[admin-auth] forgot: GMAIL_APP_PASSWORD not set, cannot send reset email');
      return res.status(200).json(generic);
    }

    try {
      const { data: user } = await supabase
        .from('admin_users')
        .select('id, name, email, reset_expires_at')
        .eq('email', addr)
        .maybeSingle();

      if (user) {
        // Throttle: skip if a link was issued within the last minute.
        const issuedAt = user.reset_expires_at ? new Date(user.reset_expires_at).getTime() - RESET_TTL_MS : 0;
        if (Date.now() - issuedAt >= RESET_RESEND_MS) {
          const token = randomBytes(32).toString('hex');
          const { error } = await supabase
            .from('admin_users')
            .update({
              reset_token_hash: hashToken(token),
              reset_expires_at: new Date(Date.now() + RESET_TTL_MS).toISOString(),
            })
            .eq('id', user.id);
          if (error) throw error;
          await sendResetEmail(user.email, user.name, `${siteUrl()}/admin?reset=${token}`);
        }
      }
    } catch (err) {
      console.error('[admin-auth] forgot error:', err.message);
    }
    return res.status(200).json(generic);
  }

  // ── Reset password: consume the emailed token ───────────────────────────────
  if (action === 'reset') {
    const { token } = req.body ?? {};
    if (!token || typeof token !== 'string' || !password) {
      return res.status(400).json({ error: 'Reset link and new password are required' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const { data: user } = await supabase
      .from('admin_users')
      .select('id, reset_expires_at')
      .eq('reset_token_hash', hashToken(token))
      .maybeSingle();

    if (!user || !user.reset_expires_at || new Date(user.reset_expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const { error } = await supabase
      .from('admin_users')
      .update({ password_hash, reset_token_hash: null, reset_expires_at: null })
      .eq('id', user.id);
    if (error) return res.status(500).json({ error: 'Could not update password. Please try again.' });

    // Sign out everywhere: anyone holding an old session shouldn't survive a reset.
    await supabase.from('admin_sessions').delete().eq('user_id', user.id);
    return res.status(200).json({ success: true });
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
