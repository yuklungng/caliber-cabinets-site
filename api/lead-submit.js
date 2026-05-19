/* global process */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { formType, fields, turnstileToken } = req.body;

  if (!turnstileToken) {
    return res.status(400).json({ error: 'Missing Turnstile token' });
  }

  const verificationResponse = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY ?? '',
        response: turnstileToken,
      }),
    },
  );

  const outcome = await verificationResponse.json();

  if (!outcome.success) {
    return res.status(400).json({ error: 'Bot verification failed. Please try again.' });
  }

  // TODO Step 2: Save submission to Supabase
  // Use @supabase/supabase-js with SUPABASE_URL and SUPABASE_ANON_KEY env vars
  // Insert into a 'leads' table with: formType, fields, submittedAt

  // TODO Step 3: Send notification email via Resend
  // Use resend npm package with RESEND_API_KEY env var
  // Send to info@calibercabinetshop.com with form summary

  // TODO Step 4: Push lead to HubSpot
  // Use HUBSPOT_ACCESS_TOKEN env var
  // Create a contact and associated deal/form submission

  console.log('[lead-submit] Turnstile verified. Submission received:', { formType, fields });
  return res.status(200).json({
    success: true,
    message: 'Submission received. Backend storage and notifications coming in next deployment.',
  });
}
