import { useEffect, useState } from 'react';

// Placeholder for the Production module while it is in development. It only
// renders when the server reports PRODUCTION_MODULE_ENABLED, and shows which
// tables and mode the module is using so nobody mistakes dev for live.
export default function ProductionView() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token') ?? '';
    fetch('/api/admin-settings?resource=production&action=status', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Status ${r.status}`))))
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '24px 16px' }}>
      <h2 style={{ margin: '0 0 8px', color: '#78350f' }}>Production</h2>
      <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: '14px' }}>
        In development. Nothing here is connected to the production sheets yet.
      </p>
      {error && <p style={{ color: '#b91c1c' }}>Could not load status: {error}</p>}
      {status && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', fontSize: '14px', lineHeight: 1.6 }}>
          <div>Table mode: <strong>{status.mode}</strong> (prefix <code>{status.prefix || 'none'}</code>)</div>
          <div>Sync: <strong>{status.syncEnabled ? 'on' : 'off'}</strong></div>
          <div>Read-only preview: <strong>{status.readOnlyPreview ? 'on' : 'off'}</strong></div>
          <div style={{ marginTop: '8px', color: '#6b7280' }}>Tables: {status.tables.join(', ')}</div>
        </div>
      )}
    </div>
  );
}
