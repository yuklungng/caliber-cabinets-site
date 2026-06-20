/* global process */

/**
 * HubSpot CRM helpers
 *
 * Required env var:
 *   HUBSPOT_ACCESS_TOKEN  — Service Key token
 *
 * Optional env vars:
 *   HUBSPOT_PIPELINE_ID    — deal pipeline ID (default: "default")
 *   HUBSPOT_DEAL_STAGE_ID  — initial deal stage ID (default: "appointmentscheduled")
 *   HUBSPOT_PORTAL_ID      — HubSpot account number (from URL) for building deal links
 *
 * Required HubSpot scopes:
 *   crm.objects.contacts.read
 *   crm.objects.contacts.write
 *   crm.objects.deals.read
 *   crm.objects.deals.write
 */

// Fallback labels — built-in HubSpot stage IDs + Caliber's custom stages
const DEFAULT_STAGE_LABELS = {
  '3869825744': 'New Request',           // Caliber custom
  '3869825755': 'Quote Sent',            // Caliber custom
  qualifiedtobuy: 'Qualified To Buy',
  appointmentscheduled: 'Appointment Scheduled',
  presentationscheduled: 'Presentation Scheduled',
  decisionmakerboughtin: 'Decision Maker Bought-In',
  contractsent: 'Contract Sent',
  closedwon: 'Closed Won',
  closedlost: 'Closed Lost',
};

const BASE = 'https://api.hubapi.com';

function hs(path, method, body) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Create or update a HubSpot contact matched by email.
 * Returns the HubSpot contact ID string, or null on failure.
 */
export async function upsertContact(properties) {
  const res = await hs('/crm/v3/objects/contacts/batch/upsert', 'POST', {
    inputs: [{ idProperty: 'email', id: properties.email, properties }],
  });
  if (!res.ok) throw new Error(`HubSpot contact upsert ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

/**
 * Create a deal and associate it with a contact.
 * Returns the HubSpot deal ID string.
 */
export async function createDeal(properties, contactId) {
  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + 90);

  const res = await hs('/crm/v3/objects/deals', 'POST', {
    properties: {
      pipeline: process.env.HUBSPOT_PIPELINE_ID ?? 'default',
      dealstage: process.env.HUBSPOT_DEAL_STAGE_ID ?? 'appointmentscheduled',
      closedate: closeDate.toISOString().split('T')[0],
      ...properties,
    },
  });
  if (!res.ok) throw new Error(`HubSpot deal create ${res.status}: ${await res.text()}`);
  const { id: dealId } = await res.json();

  if (contactId && dealId) {
    const assocRes = await hs('/crm/v3/associations/deals/contacts/batch/create', 'POST', {
      inputs: [{ from: { id: dealId }, to: { id: contactId }, type: 'deal_to_contact' }],
    });
    if (!assocRes.ok) {
      console.error('[hubspot] Deal-contact association failed:', await assocRes.text());
    }
  }

  return dealId;
}

/**
 * Batch-fetch deal stages for a list of HubSpot deal IDs.
 * Returns a map of dealId → { stageId, stageLabel, dealUrl }
 * Requires scope: crm.objects.deals.read
 */
export async function batchGetDealStages(dealIds) {
  if (!dealIds || dealIds.length === 0) return {};

  // Fetch deal objects
  const res = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
    properties: ['dealstage', 'dealname'],
    inputs: dealIds.map((id) => ({ id })),
  });
  if (!res.ok) {
    console.error('[hubspot] batchGetDealStages error:', res.status, await res.text());
    return {};
  }
  const { results } = await res.json();

  // Try to get stage labels from the pipeline
  let stageLabels = { ...DEFAULT_STAGE_LABELS };
  const pipelineId = process.env.HUBSPOT_PIPELINE_ID ?? 'default';
  try {
    const stagesRes = await hs(`/crm/v3/pipelines/deals/${pipelineId}/stages`, 'GET');
    if (stagesRes.ok) {
      const stagesData = await stagesRes.json();
      for (const stage of stagesData.results ?? []) {
        stageLabels[stage.id] = stage.label;
      }
    }
  } catch {
    // Use fallback labels
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const out = {};
  for (const deal of results ?? []) {
    const stageId = deal.properties?.dealstage ?? '';
    out[deal.id] = {
      stageId,
      stageLabel: stageLabels[stageId] ?? stageId,
      dealUrl: portalId
        ? `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`
        : null,
    };
  }
  return out;
}

/**
 * Build contact properties and a deal with full form content in the description.
 */
export function buildHubSpotObjects(formType, fields) {
  const isHomeowner = formType === 'homeowner-consultation';

  // --- Contact ---
  const contactProperties = {
    email: fields.email,
    firstname: fields.firstName ?? '',
    lastname: fields.lastName ?? '',
    phone: fields.phone ?? '',
    ...(fields.streetAddress && { address: fields.streetAddress }),
    ...(fields.city && { city: fields.city }),
    ...(fields.state && { state: fields.state }),
    ...(fields.zipCode && { zip: fields.zipCode }),
    ...(!isHomeowner && fields.companyName && { company: fields.companyName }),
  };

  // --- Deal name ---
  const personName = `${fields.firstName ?? ''} ${fields.lastName ?? ''}`.trim();
  const dealName = isHomeowner
    ? `Design Consultation – ${personName}`
    : `Trade Estimate – ${fields.companyName ? `${fields.companyName} (${personName})` : personName}`;

  // --- Deal description: full plain-text form content ---
  const lines = [];

  const line = (label, value) => {
    if (!value || (Array.isArray(value) && value.length === 0)) return;
    const display = Array.isArray(value) ? value.join(', ') : String(value);
    if (display.trim()) lines.push(`${label}: ${display.trim()}`);
  };

  if (isHomeowner) {
    lines.push('=== DESIGN CONSULTATION REQUEST ===');
    lines.push('');

    line('Project Type', fields.projectType);
    line('Timeline', fields.timeline);

    const addr = [fields.streetAddress, fields.city, fields.state, fields.zipCode]
      .filter(Boolean).join(', ');
    line('Project Address', addr);

    if (fields.description) {
      lines.push('');
      lines.push(`Project Description:\n${fields.description}`);
    }
    if (fields.inspiration) {
      lines.push('');
      lines.push(`Inspiration / Style Notes:\n${fields.inspiration}`);
    }
  } else {
    lines.push('=== TRADE PARTNER ESTIMATE REQUEST ===');
    lines.push('');

    line('Trade Role', fields.tradeRole);
    line('Company', fields.companyName);
    line('License #', fields.licenseNumber);
    line('Preferred Contact', fields.preferredContact);
    line('GC Name & Phone', fields.gcNameAndPhone);

    if (fields.needsDesignServices) {
      lines.push('');
      lines.push('✓ Client needs Design & Measure services ($875 deposit)');
    }

    lines.push('');
    const clientName = [fields.clientFirstName, fields.clientLastName].filter(Boolean).join(' ');
    line('Client Name', clientName);

    const addr = [fields.streetAddress, fields.city, fields.state, fields.zipCode]
      .filter(Boolean).join(', ');
    line('Project Address', addr);

    lines.push('');
    line('Areas Requiring Cabinetry', fields.areasRequiringCabinetry);
    line('Installation Timeline', fields.installationTimeline);

    lines.push('');
    line('Construction Method', fields.constructionMethod);
    line('Crown Molding', fields.crownMolding);
    line('Door Style', fields.doorStyle);
    line('Wood Species / Material', fields.woodSpecies);

    lines.push('');
    line('Accessories & Upgrades', fields.accessories);

    if (fields.comments) {
      lines.push('');
      lines.push(`Comments:\n${fields.comments}`);
    }
  }

  // Attachments (both forms)
  if (Array.isArray(fields.attachments) && fields.attachments.length > 0) {
    lines.push('');
    const names = fields.attachments
      .map((p) => p.split('/').pop().replace(/^\d+-/, ''))
      .join(', ');
    line('Uploaded Files', names);
  }

  const dealProperties = {
    dealname: dealName,
    description: lines.join('\n'),
  };

  return { contactProperties, dealProperties };
}
