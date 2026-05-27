/* global process */

const FIELD_LABELS = {
  // Shared
  firstName: 'First Name',
  lastName: 'Last Name',
  phone: 'Phone',
  email: 'Email',
  // Homeowner consultation
  projectType: 'Project Type',
  timeline: 'Estimated Timeline',
  projectAddress: 'Project Address',
  description: 'Project Description',
  inspiration: 'Inspiration / Style',
  // Trade estimate
  needsDesignServices: 'Needs Design Services',
  companyName: 'Company / Firm',
  tradeRole: 'Trade Role',
  licenseNumber: 'License Number',
  preferredContact: 'Preferred Contact',
  gcNameAndPhone: 'General Contractor',
  clientFirstName: 'Client First Name',
  clientLastName: 'Client Last Name',
  partnerFirstName: 'Partner First Name',
  partnerLastName: 'Partner Last Name',
  streetAddress: 'Street Address',
  city: 'City',
  state: 'State',
  zipCode: 'ZIP Code',
  areasRequiringCabinetry: 'Areas Requiring Cabinetry',
  installationTimeline: 'Installation Timeline',
  constructionMethod: 'Construction Method',
  crownMolding: 'Crown Molding',
  doorStyle: 'Door Style',
  woodSpecies: 'Wood Species / Material',
  accessories: 'Accessories & Upgrades',
  comments: 'Comments',
};

function formatValue(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function isEmpty(value) {
  if (value === '' || value === null || value === undefined) return true;
  if (value === false) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function buildFieldRows(fields) {
  return Object.entries(fields)
    .filter(([k, v]) => k !== 'attachments' && !isEmpty(v))
    .map(([k, v]) => {
      const label = FIELD_LABELS[k] ?? k;
      const value = formatValue(v);
      return `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f3f4f6;vertical-align:top;width:36%;">
            <p style="margin:0;font-size:12px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${label}</p>
          </td>
          <td style="padding:10px 0 10px 20px;border-bottom:1px solid #f3f4f6;vertical-align:top;">
            <p style="margin:0;font-size:14px;color:#111827;line-height:1.55;">${value}</p>
          </td>
        </tr>`;
    })
    .join('');
}

function buildAttachmentRows(attachedFiles, failedFiles) {
  if (attachedFiles.length === 0 && failedFiles.length === 0) return '';

  const attachedItems = attachedFiles
    .map((f) => `<p style="margin:0 0 4px;font-size:14px;color:#111827;">&#128206; ${f}</p>`)
    .join('');

  const failedNote =
    failedFiles.length > 0
      ? `<p style="margin:8px 0 0;font-size:13px;color:#b91c1c;">Could not attach (check Supabase): ${failedFiles.join(', ')}</p>`
      : '';

  return `
    <tr>
      <td colspan="2" style="padding:16px 0 0;">
        <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Attached Files</p>
        ${attachedItems}
        ${failedNote}
      </td>
    </tr>`;
}

export function buildHtmlEmail({ formLabel, fields, attachedFiles = [], failedFiles = [] }) {
  const firstName = fields.firstName || '';
  const lastName = fields.lastName || '';
  const fieldRows = buildFieldRows(fields);
  const attachmentRows = buildAttachmentRows(attachedFiles, failedFiles);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>New Lead: ${formLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">

        <!-- Header bar -->
        <tr>
          <td style="background:#78350f;padding:28px 36px;">
            <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.01em;">Caliber Cabinets</p>
            <p style="margin:5px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">New Lead Notification</p>
          </td>
        </tr>

        <!-- Lead identity -->
        <tr>
          <td style="padding:28px 36px 0;">
            <span style="display:inline-block;background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${formLabel}</span>
            <h1 style="margin:12px 0 0;font-size:22px;color:#111827;font-weight:700;line-height:1.2;">${firstName} ${lastName}</h1>
          </td>
        </tr>

        <!-- Field table -->
        <tr>
          <td style="padding:20px 36px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${fieldRows}
              ${attachmentRows}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 36px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Submitted via calibercabinetshop.com &nbsp;&middot;&nbsp; View full record in Supabase dashboard
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
