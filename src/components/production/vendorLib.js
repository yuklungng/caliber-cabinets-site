/**
 * Shared by the Vendors tab and its price books: the API call, uploads to signed links, styles and formatting.
 */
import { useEffect, useState } from 'react';

const API = '/api/admin-settings?resource=production&action=';

const authHeaders = () => ({ Authorization: `Bearer ${sessionStorage.getItem('admin_token') ?? ''}` });

export async function call(action, { params, body } = {}) {
  const qs = params ? '&' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  const r = await fetch(API + action + qs, body
    ? { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { headers: authHeaders() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Status ${r.status}`);
  return data;
}

/** Runs fn over items, `size` at a time. */

export async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

/** PUT a file or picture to a signed upload link, reporting progress (0-1). */

export function uploadTo(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(uploadError(xhr))));
    xhr.onerror = () => reject(new Error('The connection dropped during the upload'));
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    xhr.send(form);
  });
}

function uploadError(xhr) {
  try {
    const j = JSON.parse(xhr.responseText);
    if (xhr.status === 413 || /maximum allowed size|too large/i.test(j.message ?? j.error ?? '')) return 'The file is larger than storage allows. The storage upload limit needs raising in Supabase.';
    return j.message || j.error || `Upload failed (${xhr.status})`;
  } catch { return `Upload failed (${xhr.status})`; }
}

export const ctl = { padding: '7px 12px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', color: '#374151', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minHeight: '34px' };

export const primary = { ...ctl, background: '#78350f', color: '#fff', borderColor: '#78350f' };

export const field = { padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box', minHeight: '32px', width: '100%' };

export const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px' };

export const muted = { color: '#6b7280', fontSize: '13px' };

export const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDay = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export const todayIso = () => new Date().toLocaleDateString('en-CA');

export const isPdf = (f) => /\.pdf$/i.test(f?.name ?? '') || f?.type === 'application/pdf';

export const isCsv = (f) => /\.(csv|txt)$/i.test(f?.name ?? '');

// A box to drop a file on, or click to choose one. accept: the file picker's filter; hint: the line under the title.
export function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
