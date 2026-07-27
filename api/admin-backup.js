/* global process */
import { createClient } from '@supabase/supabase-js';
import { checkAuth } from './_lib/auth.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BUCKET = 'db-backups';

function supabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** Ensure the db-backups bucket exists (private, no public access). */
async function ensureBucket(supabase) {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.name === BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(BUCKET, { public: false });
  }
}

/** Convert an array of objects to CSV string. */
function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Wrap in quotes if contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

/** Flatten a lead row into a flat CSV-friendly object. */
function flattenLead(lead) {
  const f = lead.fields ?? {};
  return {
    id: lead.id,
    created_at: lead.created_at,
    form_type: lead.form_type,
    first_name: f.firstName ?? '',
    last_name: f.lastName ?? '',
    email: f.email ?? '',
    phone: f.phone ?? '',
    company_name: f.companyName ?? '',
    address: f.address ?? '',
    city: f.city ?? '',
    project_type: f.projectType ?? '',
    message: f.message ?? '',
    lead_source: f.leadSource ?? '',
    quote_amount: f.quote_amount ?? '',
    probability: f.probability ?? '',
    hs_stage_id: lead.hs_stage_id ?? '',
    hs_stage_label: lead.hs_stage_label ?? '',
    hs_stage_date: lead.hs_stage_date ?? '',
    hubspot_deal_id: lead.hubspot_deal_id ?? '',
    hs_date_entered_new_request: lead.hs_date_entered_new_request ?? '',
    hs_date_entered_qualified: lead.hs_date_entered_qualified ?? '',
    hs_date_entered_quote_sent: lead.hs_date_entered_quote_sent ?? '',
    hs_date_entered_contract_sent: lead.hs_date_entered_contract_sent ?? '',
    hs_date_entered_closed_won: lead.hs_date_entered_closed_won ?? '',
    hs_date_entered_closed_lost: lead.hs_date_entered_closed_lost ?? '',
    distance_miles: lead.distance_miles ?? '',
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = supabaseClient();
  const action = req.query?.action;

  // ── GET ?action=export-csv — any admin ─────────────────────────────────────
  if (req.method === 'GET' && action === 'export-csv') {
    try {
      const { data: leads, error } = await supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const csv = toCSV((leads ?? []).map(flattenLead));
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="caliber-leads-${date}.csv"`);
      return res.status(200).send(csv);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // All remaining actions are super-admin only
  if (!auth.isSuperAdmin) {
    return res.status(403).json({ error: 'Super admin required' });
  }

  // ── GET ?action=list — list backup files ───────────────────────────────────
  if (req.method === 'GET' && action === 'list') {
    try {
      await ensureBucket(supabase);
      const { data: files, error } = await supabase.storage.from(BUCKET).list('', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });
      if (error) throw error;
      return res.status(200).json({ files: files ?? [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ?action=create — snapshot tables to JSON in Storage ───────────────
  if (req.method === 'POST' && action === 'create') {
    try {
      await ensureBucket(supabase);

      // Fetch all three tables
      const [leadsRes, settingsRes, usersRes] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('admin_settings').select('*'),
        supabase.from('admin_users').select('*'),
      ]);

      if (leadsRes.error) throw leadsRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (usersRes.error) throw usersRes.error;

      const snapshot = {
        created_at: new Date().toISOString(),
        version: 1,
        tables: {
          leads: leadsRes.data ?? [],
          admin_settings: settingsRes.data ?? [],
          admin_users: usersRes.data ?? [],
        },
      };

      const filename = `backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
      const body = JSON.stringify(snapshot, null, 0);

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filename, body, { contentType: 'application/json', upsert: false });

      if (uploadError) throw uploadError;

      return res.status(200).json({
        ok: true,
        filename,
        lead_count: snapshot.tables.leads.length,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ?action=restore — restore from a backup file ─────────────────────
  if (req.method === 'POST' && action === 'restore') {
    const { filename } = req.query;
    if (!filename) return res.status(400).json({ error: 'Missing filename' });

    try {
      await ensureBucket(supabase);

      // 1. Auto-create a pre-restore safety snapshot first
      const [leadsRes, settingsRes, usersRes] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('admin_settings').select('*'),
        supabase.from('admin_users').select('*'),
      ]);
      const safetySnapshot = {
        created_at: new Date().toISOString(),
        version: 1,
        pre_restore_safety: true,
        tables: {
          leads: leadsRes.data ?? [],
          admin_settings: settingsRes.data ?? [],
          admin_users: usersRes.data ?? [],
        },
      };
      const safetyFilename = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
      await supabase.storage
        .from(BUCKET)
        .upload(safetyFilename, JSON.stringify(safetySnapshot, null, 0), {
          contentType: 'application/json',
          upsert: false,
        });

      // 2. Download the target backup
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(filename);

      if (downloadError) throw downloadError;

      const text = await fileData.text();
      const snapshot = JSON.parse(text);

      if (!snapshot?.tables) {
        return res.status(400).json({ error: 'Invalid backup format' });
      }

      const { leads, admin_settings, admin_users } = snapshot.tables;

      // 3. Upsert each table (restore by merging, not truncating)
      const errors = [];

      if (leads?.length > 0) {
        const { error } = await supabase.from('leads').upsert(leads, { onConflict: 'id' });
        if (error) errors.push(`leads: ${error.message}`);
      }
      if (admin_settings?.length > 0) {
        const { error } = await supabase.from('admin_settings').upsert(admin_settings, { onConflict: 'id' });
        if (error) errors.push(`admin_settings: ${error.message}`);
      }
      if (admin_users?.length > 0) {
        const { error } = await supabase.from('admin_users').upsert(admin_users, { onConflict: 'id' });
        if (error) errors.push(`admin_users: ${error.message}`);
      }

      if (errors.length > 0) {
        return res.status(207).json({ ok: false, errors, safety_backup: safetyFilename });
      }

      return res.status(200).json({
        ok: true,
        restored_from: filename,
        safety_backup: safetyFilename,
        lead_count: leads?.length ?? 0,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
