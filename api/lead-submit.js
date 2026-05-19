/* global process */

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { formType, fields, turnstileToken } = req.body;

  if (!turnstileToken) {
    return res.status(400).json({ error: 'Missing Turnstile token' });
  }

  // Step 1: Verify Turnstile token server-side
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

  // Step 2: Save to Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { error: dbError } = await supabase.from('leads').insert({
    form_type: formType,
    fields,
    status: 'new',
  });

  if (dbError) {
    console.error('[lead-submit] Supabase insert error:', dbError.message);
    return res.status(500).json({
      error:
        'Failed to save your submission. Please call us at (925) 292-9124 or email info@calibercabinetshop.com.',
    });
  }

  console.log('[lead-submit] Lead saved to Supabase:', formType);

  // Step 3: Send notification email via Resend (direct HTTP — no SDK)
  if (process.env.RESEND_API_KEY) {
    try {
      const formLabel =
        formType === 'homeowner-consultation'
          ? 'Design Consultation Request'
          : 'Trade Partner Estimate Request';

      const fieldsSummary = Object.entries(fields)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Caliber Cabinets <leads@calibercabinetshop.com>',
          to: ['morrisng@nexperionsolutions.com'], // TODO: change to mike@calibercabinetshop.com before go-live
          subject: `New ${formLabel} - ${fields.firstName || ''} ${fields.lastName || ''}`.trim(),
          text: `New lead submitted via the website.\n\nForm: ${formLabel}\n\n${fieldsSummary}\n\nView in Supabase dashboard.`,
        }),
      });

      if (emailRes.ok) {
        console.log('[lead-submit] Notification email sent via Resend');
      } else {
        const emailErr = await emailRes.text();
        console.error('[lead-submit] Resend API error:', emailErr);
      }
    } catch (emailError) {
      // Email failure is non-fatal — lead is already saved to Supabase
      console.error('[lead-submit] Resend fetch error:', emailError.message);
    }
  }

  // TODO Step 4: Push lead to HubSpot
  // Use HUBSPOT_ACCESS_TOKEN env var
  // Create a contact and associated deal/form submission

  return res.status(200).json({ success: true });
}
