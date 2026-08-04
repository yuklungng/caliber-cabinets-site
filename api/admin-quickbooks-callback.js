/* global process */
import { completeConnect } from './_lib/quickbooks.js';

// This is the exact URL registered in the Intuit app's Redirect URIs
// (Settings → Redirect URIs): <SITE_URL>/api/admin-quickbooks-callback.
//
// Intuit redirects the admin's browser here directly after they approve (or
// decline) the consent screen — this is a plain browser navigation, not a
// fetch() call from our own frontend, so it can't carry our normal Bearer
// session token. CSRF protection instead comes from the `state` param
// generated and persisted by startConnect() in api/admin-quickbooks.js, and
// verified here in completeConnect(). Anyone hitting this URL without a
// matching pending state gets rejected.
export default async function handler(req, res) {
  const { code, state, realmId, error } = req.query ?? {};
  const adminUrl = `${process.env.SITE_URL}/admin`;

  if (error) {
    return res.redirect(302, `${adminUrl}?qb=error&msg=${encodeURIComponent(error)}`);
  }
  if (!code || !state || !realmId) {
    return res.redirect(302, `${adminUrl}?qb=error&msg=${encodeURIComponent('Missing code/state/realmId from QuickBooks redirect.')}`);
  }

  try {
    await completeConnect({ code, state, realmId });
    return res.redirect(302, `${adminUrl}?qb=connected`);
  } catch (err) {
    return res.redirect(302, `${adminUrl}?qb=error&msg=${encodeURIComponent(err.message)}`);
  }
}
