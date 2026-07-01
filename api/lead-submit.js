/* global process */

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { buildHtmlEmail } from './email-template.js';
import { upsertContact, createDeal, buildHubSpotObjects } from './hubspot.js';

// ─── Distance helpers ──────────────────────────────────────────────────────────
// Caliber Cabinets: 5640 La Ribera St., Unit A, Livermore, CA 94550
const CALIBER_LAT = 37.6977;
const CALIBER_LON = -121.7308;

function haversineDistanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeAddress(addressStr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addressStr)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'CaliberCabinets/1.0 (info@calibercabinetshop.com)' },
  });
  const data = await res.json();
  return data[0] ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
}
// ──────────────────────────────────────────────────────────────────────────────

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

  // Step 2: Geocode lead address and compute straight-line distance from Caliber
  let distanceMiles = null;
  try {
    const leadAddrStr =
      formType === 'homeowner-consultation'
        ? (fields.projectAddress || '')
        : [fields.streetAddress, fields.city, fields.state, fields.zipCode].filter(Boolean).join(', ');
    if (leadAddrStr) {
      const coords = await geocodeAddress(leadAddrStr);
      if (coords) {
        distanceMiles =
          Math.round(haversineDistanceMiles(CALIBER_LAT, CALIBER_LON, coords.lat, coords.lon) * 10) / 10;
      }
    }
  } catch (geoErr) {
    console.warn('[lead-submit] Geocoding failed (non-fatal):', geoErr.message);
  }

  const enrichedFields = distanceMiles !== null ? { ...fields, distance_miles: distanceMiles } : fields;

  // Step 3: Save to Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: insertData, error: dbError } = await supabase
    .from('leads')
    .insert({ form_type: formType, fields: enrichedFields, status: 'new' })
    .select('id')
    .single();

  if (dbError) {
    console.error('[lead-submit] Supabase insert error:', dbError.message);
    return res.status(500).json({
      error:
        'Failed to save your submission. Please call us at (925) 292-9124 or email info@calibercabinetshop.com.',
    });
  }

  console.log('[lead-submit] Lead saved to Supabase:', formType);

  // Read notification recipients from settings (falls back to Mike's address)
  let notificationEmails = ['mike@calibercabinetshop.com'];
  try {
    const { data: emailSetting } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'notification_emails')
      .single();
    if (Array.isArray(emailSetting?.value) && emailSetting.value.length > 0) {
      notificationEmails = emailSetting.value;
    }
  } catch { /* use default */ }

  // Step 3: Send notification email via Gmail SMTP (nodemailer)
  if (process.env.GMAIL_APP_PASSWORD) {
    try {
      const formLabel =
        formType === 'homeowner-consultation'
          ? 'Design Consultation Request'
          : 'Trade Partner Estimate Request';

      const fieldsSummary = Object.entries(fields)
        .filter(([k]) => k !== 'attachments')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n');

      // Download uploaded files from Supabase Storage and attach to email
      const emailAttachments = [];
      const failedFiles = [];

      if (Array.isArray(fields.attachments) && fields.attachments.length > 0) {
        for (const path of fields.attachments) {
          try {
            const { data: blob, error: dlError } = await supabase.storage
              .from('lead-uploads')
              .download(path);
            if (dlError || !blob) throw new Error(dlError?.message ?? 'Download failed');
            const arrayBuffer = await blob.arrayBuffer();
            const content = Buffer.from(arrayBuffer);
            // Strip the leading timestamp from the filename (e.g. 1748123456789-photo.jpg → photo.jpg)
            const filename = path.split('/').pop().replace(/^\d+-/, '');
            emailAttachments.push({ filename, content });
          } catch (dlErr) {
            failedFiles.push(path.split('/').pop());
            console.error('[lead-submit] File attachment error:', dlErr.message);
          }
        }
      }

      const attachedFileNames = emailAttachments.map((a) => a.filename);
      const failedFileNames = failedFiles.map((f) => f.split('/').pop());

      // Plain text fallback
      let attachmentNote = '';
      if (attachedFileNames.length > 0) {
        attachmentNote = `\n\nAttached files: ${attachedFileNames.join(', ')}`;
      }
      if (failedFileNames.length > 0) {
        attachmentNote += `\n\nCould not attach (check Supabase): ${failedFileNames.join(', ')}`;
      }

      const htmlBody = buildHtmlEmail({
        formLabel,
        fields: enrichedFields,
        attachedFiles: attachedFileNames,
        failedFiles: failedFileNames,
        distanceMiles,
      });

      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'mike@calibercabinetshop.com',
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      });

      await transporter.sendMail({
        from: '"Caliber Cabinets" <info@calibercabinetshop.com>',
        to: notificationEmails.join(', '),
        subject: `New ${formLabel} - ${fields.firstName || ''} ${fields.lastName || ''}`.trim(),
        text: `New lead submitted via the website.\n\nForm: ${formLabel}\n\n${fieldsSummary}${attachmentNote}\n\nView in admin panel.`,
        html: htmlBody,
        attachments: emailAttachments,
      });

      console.log('[lead-submit] Notification email sent via Gmail SMTP');
    } catch (emailError) {
      // Email failure is non-fatal — lead is already saved to Supabase
      console.error('[lead-submit] Gmail SMTP error:', emailError.message);
    }
  }

  // Step 4: Send confirmation email to customer if auto-reply is enabled
  if (process.env.GMAIL_APP_PASSWORD && fields.email) {
    try {
      const { data: confirmSettings } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', ['confirmations_enabled', 'confirmation_subject', 'confirmation_message']);

      const settingsMap = {};
      for (const row of confirmSettings ?? []) settingsMap[row.key] = row.value;

      console.log('[lead-submit] confirmations_enabled value:', settingsMap.confirmations_enabled);
      if (settingsMap.confirmations_enabled === true || settingsMap.confirmations_enabled === 'true') {
        const confirmSubject = settingsMap.confirmation_subject || 'Thank you for contacting Caliber Cabinets';
        const confirmMessage = settingsMap.confirmation_message || '<p>Thank you for reaching out. We will be in touch within 1 business day.</p>';

        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 587,
          secure: false,
          auth: {
            user: 'mike@calibercabinetshop.com',
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        });

        await transporter.sendMail({
          from: '"Caliber Cabinets" <info@calibercabinetshop.com>',
          to: fields.email,
          subject: confirmSubject,
          html: confirmMessage,
          text: confirmMessage.replace(/<[^>]+>/g, ''),
        });

        console.log('[lead-submit] Confirmation email sent to:', fields.email);
      }
    } catch (confirmError) {
      console.error('[lead-submit] Confirmation email error:', confirmError.message);
    }
  }

  // Step 5: Push lead to HubSpot and store deal ID back in Supabase
  if (process.env.HUBSPOT_ACCESS_TOKEN) {
    try {
      // Generate 1-year signed URLs for any uploaded files so Mike can open
      // them directly from the HubSpot deal description
      const attachmentUrls = {};
      if (Array.isArray(fields.attachments) && fields.attachments.length > 0) {
        for (const path of fields.attachments) {
          const { data } = await supabase.storage
            .from('lead-uploads')
            .createSignedUrl(path, 31_536_000); // 1 year in seconds
          if (data?.signedUrl) attachmentUrls[path] = data.signedUrl;
        }
      }

      const { contactProperties, dealProperties } = buildHubSpotObjects(formType, fields, attachmentUrls);
      const contactId = await upsertContact(contactProperties);
      const dealId = await createDeal(dealProperties, contactId);
      console.log('[lead-submit] HubSpot contact and deal created, deal ID:', dealId);

      // Write deal ID back to Supabase so admin page can link to HubSpot
      if (dealId && insertData?.id) {
        const { error: updateError } = await supabase
          .from('leads')
          .update({ hubspot_deal_id: dealId })
          .eq('id', insertData.id);
        if (updateError) {
          console.error('[lead-submit] Failed to store hubspot_deal_id:', updateError.message);
        }
      }
    } catch (hsError) {
      // Non-fatal — lead is already saved to Supabase and email sent
      console.error('[lead-submit] HubSpot error:', hsError.message);
    }
  }

  return res.status(200).json({ success: true });
}
