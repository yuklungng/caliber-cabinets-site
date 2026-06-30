/* global process */
import { createClient } from '@supabase/supabase-js';
import { checkAuth } from './_lib/auth.js';

const BUCKET = 'project-images';

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // ── Public GET — no auth required ─────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('projects')
      .select('id, title, location, image_url, featured, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ projects: data || [] });
  }

  // ── All writes require auth ───────────────────────────────────────────────
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body;

    // Step 1 of upload: get a signed URL so the browser can PUT directly to storage
    if (action === 'get-upload-url') {
      const { filename } = req.body;
      const ext = (filename ?? 'jpg').split('.').pop().toLowerCase();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(path);
      if (error) return res.status(500).json({ error: error.message });
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      return res.status(200).json({ signedUrl: data.signedUrl, path, publicUrl });
    }

    // Step 2 of upload: save the project record after image is uploaded
    if (action === 'create') {
      const { title, location, image_url, featured = false } = req.body;
      if (!title || !location || !image_url) {
        return res.status(400).json({ error: 'title, location, and image_url are required' });
      }
      // Place new project at the end of the sort order
      const { data: maxRow } = await supabase
        .from('projects')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .single();
      const sort_order = (maxRow?.sort_order ?? 0) + 10;

      const { data, error } = await supabase
        .from('projects')
        .insert({ title, location, image_url, featured, sort_order })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ project: data });
    }

    // Toggle featured / update metadata
    if (action === 'update') {
      const { id, title, location, featured } = req.body;
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (location !== undefined) updates.location = location;
      if (featured !== undefined) updates.featured = featured;
      const { data, error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ project: data });
    }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id, image_url } = req.body;
    // Only delete from storage if it's a Supabase-hosted image (not a static /images/ file)
    if (image_url?.includes(`/storage/v1/object/public/${BUCKET}/`)) {
      const path = image_url.split(`/storage/v1/object/public/${BUCKET}/`)[1];
      await supabase.storage.from(BUCKET).remove([path]);
    }
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
