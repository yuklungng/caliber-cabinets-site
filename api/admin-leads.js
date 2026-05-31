/* global process */

import { createClient } from '@supabase/supabase-js';

function checkAuth(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token.length > 0 && token === process.env.ADMIN_PASSWORD;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // GET — list all leads, newest first
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin-leads] Supabase select error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ leads: data });
  }

  // PATCH — update a lead's status
  if (req.method === 'PATCH') {
    const { id, status } = req.body ?? {};

    if (!id || !status) {
      return res.status(400).json({ error: 'Missing id or status' });
    }

    const { error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id);

    if (error) {
      console.error('[admin-leads] Supabase update error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
