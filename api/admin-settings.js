/* global process */
import './_lib/readonly.js';
import { createClient } from '@supabase/supabase-js';
import { checkAuth } from './_lib/auth.js';
import { handleProduction, publicFlags } from './_lib/production.js';

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  // Production module: feature flags for the admin UI, and the module's own endpoint (404 while its flag is off).
  if (req.method === 'GET' && req.query?.resource === 'flags') return res.status(200).json(publicFlags());
  if (req.query?.resource === 'production') return handleProduction(req, res, auth);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // GET — return all settings as a key→value object
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('admin_settings').select('*');
    if (error) return res.status(500).json({ error: error.message });
    const settings = {};
    for (const row of data ?? []) settings[row.key] = row.value;
    return res.status(200).json({ settings });
  }

  // PUT — upsert a single setting key
  if (req.method === 'PUT') {
    const { key, value } = req.body ?? {};
    if (key === undefined || key === null) {
      return res.status(400).json({ error: 'Missing key' });
    }
    const { error } = await supabase.from('admin_settings').upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
