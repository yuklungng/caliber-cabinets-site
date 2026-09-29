/* global process */
import { createClient } from '@supabase/supabase-js';
import { checkAuth } from './auth.js';

// FAQ CRUD. Dispatched from api/admin-projects.js when ?resource=faqs, so we
// stay under Vercel's per-deployment serverless function limit (no new file in /api).
export async function handleFaqs(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // ── GET: public gets published only; authed admin (?all=1) gets everything ──
  if (req.method === 'GET') {
    let includeAll = false;
    if (req.query?.all === '1') {
      const auth = await checkAuth(req);
      includeAll = !!auth.ok;
    }
    let q = supabase
      .from('faqs')
      .select('id, question, answer, sort_order, published')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (!includeAll) q = q.eq('published', true);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ faqs: data || [] });
  }

  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'create') {
      const { question, answer, published = true } = req.body;
      if (!question?.trim() || !answer?.trim()) {
        return res.status(400).json({ error: 'question and answer are required' });
      }
      const { data: maxRow } = await supabase
        .from('faqs')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sort_order = (maxRow?.sort_order ?? 0) + 10;
      const { data, error } = await supabase
        .from('faqs')
        .insert({ question: question.trim(), answer: answer.trim(), published, sort_order })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ faq: data });
    }

    if (action === 'update') {
      const { id, question, answer, published } = req.body;
      const updates = { updated_at: new Date().toISOString() };
      if (question !== undefined) updates.question = question.trim();
      if (answer !== undefined) updates.answer = answer.trim();
      if (published !== undefined) updates.published = published;
      const { data, error } = await supabase
        .from('faqs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ faq: data });
    }

    // Persist a full new ordering: body.ids = [id, id, ...] top to bottom
    if (action === 'reorder') {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
      const results = await Promise.all(
        ids.map((id, i) => supabase.from('faqs').update({ sort_order: (i + 1) * 10 }).eq('id', id)),
      );
      const failed = results.find((r) => r.error);
      if (failed) return res.status(500).json({ error: failed.error.message });
      return res.status(200).json({ success: true });
    }
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    const { error } = await supabase.from('faqs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
