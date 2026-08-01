/* global process */
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { checkAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });
  if (!auth.isSuperAdmin) return res.status(403).json({ error: 'Super admin access required' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // GET — list all users
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, name, email, is_super_admin, role, created_at')
      .order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ users: data ?? [] });
  }

  // POST — create a new user
  if (req.method === 'POST') {
    const { name, email, password, is_super_admin = false, role = 'staff' } = req.body ?? {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (!['staff', 'bookkeeper'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const password_hash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase
      .from('admin_users')
      .insert({ name, email: email.toLowerCase().trim(), password_hash, is_super_admin, role })
      .select('id, name, email, is_super_admin, role, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ user: data });
  }

  // PATCH — reset a user's password, and/or change their role
  if (req.method === 'PATCH') {
    const { id, password, role } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!password && !role) return res.status(400).json({ error: 'Nothing to update — provide password and/or role' });
    if (role && !['staff', 'bookkeeper'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const update = {};
    if (password) update.password_hash = await bcrypt.hash(password, 12);
    if (role) update.role = role;
    const { error } = await supabase
      .from('admin_users')
      .update(update)
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // DELETE — remove a user
  if (req.method === 'DELETE') {
    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const { error } = await supabase.from('admin_users').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
