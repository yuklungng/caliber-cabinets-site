/* global process */
import { createClient } from '@supabase/supabase-js';
import { checkAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Missing path' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data, error } = await supabase.storage
    .from('lead-uploads')
    .createSignedUrl(path, 3600); // 1-hour link

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ url: data.signedUrl });
}
