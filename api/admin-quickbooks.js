import { checkAuth } from './_lib/auth.js';
import { startConnect, getConnectionStatus, disconnect } from './_lib/quickbooks.js';

// Connection management only — super-admin gated, since connecting/
// disconnecting QuickBooks is an account-level action. The actual
// invoice/payment pull-and-match logic lives in a separate endpoint once
// that's built (see api/admin-cashflow.js for the payment schedule this
// will eventually reconcile against).
export default async function handler(req, res) {
  const auth = await checkAuth(req);
  if (!auth.ok) return res.status(401).json({ error: 'Unauthorized' });
  if (!auth.isSuperAdmin) return res.status(403).json({ error: 'Super admin required' });

  const action = req.query?.action;

  if (req.method === 'GET' && action === 'status') {
    try {
      const status = await getConnectionStatus();
      return res.status(200).json(status);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'connect') {
    try {
      const authorizeUrl = await startConnect();
      return res.status(200).json({ authorizeUrl });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST' && action === 'disconnect') {
    try {
      await disconnect();
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
