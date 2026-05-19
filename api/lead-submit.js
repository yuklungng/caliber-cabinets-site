/* global process */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { formType, fields, turnstileToken } = req.body;
  void turnstileToken;

  // TODO Step 1: Verify Turnstile token server-side
  // POST to https://challenges.cloudflare.com/turnstile/v0/siteverify
  // with secret: process.env.TURNSTILE_SECRET_KEY and response: turnstileToken
  // Reject submission if verification fails

  // TODO Step 2: Save submission to Supabase
  // Use @supabase/supabase-js with SUPABASE_URL and SUPABASE_ANON_KEY env vars
  // Insert into a 'leads' table with: formType, fields, submittedAt

  // TODO Step 3: Send notification email via Resend
  // Use resend npm package with RESEND_API_KEY env var
  // Send to info@calibercabinetshop.com with form summary

  // TODO Step 4: Push lead to HubSpot
  // Use HUBSPOT_ACCESS_TOKEN env var
  // Create a contact and associated deal/form submission

  // PLACEHOLDER: All TODOs above are not yet implemented.
  // Remove this placeholder block once all steps are wired and tested.
  const isConfigured = process.env.SUPABASE_URL && process.env.RESEND_API_KEY;

  if (!isConfigured) {
    console.log('[lead-submit] Placeholder mode - received submission:', { formType, fields });
    return res.status(200).json({
      success: true,
      message: 'Submission received (placeholder - backend not yet configured)',
      placeholder: true,
    });
  }

  return res.status(200).json({ success: true });
}
