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

  // Fetch deal objects — include stage-entry dates for operational metrics
  const res = await hs('/crm/v3/objects/deals/batch/read', 'POST', {
    properties: [
      'dealstage', 'dealname', 'hs_lastmodifieddate',
      'hs_date_entered_3869825744',      // New Request (Caliber custom)
      'hs_date_entered_qualifiedtobuy',  // Qualified
      'hs_date_entered_3869825755',      // Quote Sent (Caliber custom)
      'hs_date_entered_contractsent',    // Contract Sent
    ],
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
    const p = deal.properties ?? {};
    // DEBUG: log stage-entry dates to confirm HubSpot is returning them
    console.log(`[hubspot] deal ${deal.id} stage-entry dates:`, {
      newRequest:   p['hs_date_entered_3869825744'],
      qualified:    p['hs_date_entered_qualifiedtobuy'],
      quoteSent:    p['hs_date_entered_3869825755'],
      contractSent: p['hs_date_entered_contractsent'],
    });
    out[deal.id] = {
      stageId,
      stageLabel: stageLabels[stageId] ?? stageId,
      stageDate: p.hs_lastmodifieddate ?? null,
      dealUrl: portalId
        ? `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`
        : null,
      // Stage-entry timestamps for operational metrics (days between stages)
      dateEnteredNewRequest:    p['hs_date_entered_3869825744']     ?? null,
      dateEnteredQualified:     p['hs_date_entered_qualifiedtobuy'] ?? null,
      dateEnteredQuoteSent:     p['hs_date_entered_3869825755']     ?? null,
      dateEnteredContractSent:  p['hs_date_entered_contractsent']   ?? null,
    };
  }
  return out;
}

/**
 * Fetch every deal in the configured pipeline, with associated contact details.
 * Returns an array of lead-shaped objects (same shape as Supabase leads after enrichment)
 * so they can be merged into the admin leads list without frontend changes.
 *
 * source: 'hubspot' distinguishes these from web-form submissions.
 */
export async function getAllPipelineDeals() {
  const pipelineId = process.env.HUBSPOT_PIPELINE_ID ?? 'default';
  const portalId   = process.env.HUBSPOT_PORTAL_ID;

  // Resolve stage labels for this pipeline
  let stageLabels = { ...DEFAULT_STAGE_LABELS };
  try {
    const stagesRes = await hs(`/crm/v3/pipelines/deals/${pipelineId}/stages`, 'GET');
    if (stagesRes.ok) {
      for (const stage of (await stagesRes.json()).results ?? []) {
        stageLabels[stage.id] = stage.label;
      }
    }
  } catch { /* use fallback labels */ }

  // Paginate through all deals in the pipeline
  const allDeals = [];
  let after;
  do {
    const res = await hs('/crm/v3/objects/deals/search', 'POST', {
      filterGroups: [{ filters: [{ propertyName: 'pipeline', operator: 'EQ', value: pipelineId }] }],
      properties: [
        'dealname', 'dealstage', 'createdate', 'hs_lastmodifieddate',
        'hs_date_entered_3869825744',
        'hs_date_entered_qualifiedtobuy',
        'hs_date_entered_3869825755',
        'hs_date_entered_contractsent',
      ],
      limit: 100,
      ...(after ? { after } : {}),
    });
    if (!res.ok) break;
    const data = await res.json();
    allDeals.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  if (allDeals.length === 0) return [];

  // Batch-fetch contact associations, then resolve contact properties
  const dealIds = allDeals.map((d) => d.id);
  const contactByDealId = {};
  try {
    const assocRes = await hs('/crm/v4/associations/deals/contacts/batch/read', 'POST', {
      inputs: dealIds.map((id) => ({ id })),
    });
    if (assocRes.ok) {
      const dealToContactId = {};
      for (const r of (await assocRes.json()).results ?? []) {
        if (r.to?.length > 0) dealToContactId[r.from.id] = String(r.to[0].toObjectId);
      }
      const contactIds = [...new Set(Object.values(dealToContactId))];
      if (contactIds.length > 0) {
        const cRes = await hs('/crm/v3/objects/contacts/batch/read', 'POST', {
          properties: ['firstname', 'lastname', 'email', 'phone'],
          inputs: contactIds.map((id) => ({ id })),
        });
        if (cRes.ok) {
          const contactMap = {};
          for (const c of (await cRes.json()).results ?? []) contactMap[c.id] = c.properties;
          for (const [dealId, contactId] of Object.entries(dealToContactId)) {
            contactByDealId[dealId] = contactMap[contactId] ?? {};
          }
        }
      }
    }
  } catch (e) {
    console.error('[hubspot] getAllPipelineDeals association fetch error:', e.message);
  }

  return allDeals.map((deal) => {
    const contact = contactByDealId[deal.id] ?? {};
    const stageId = deal.properties?.dealstage ?? '';
    const p = deal.properties ?? {};
    return {
      id: `hs-${deal.id}`,
      source: 'hubspot',
      form_type: null,
      created_at: p.createdate ?? new Date().toISOString(),
      hubspot_deal_id: deal.id,
      fields: {
        firstName: contact.firstname ?? '',
        lastName:  contact.lastname  ?? '',
        email:     contact.email     ?? '',
        phone:     contact.phone     ?? '',
        dealName:  p.dealname ?? '',
      },
      hs_stage_id:    stageId,
      hs_stage_label: stageLabels[stageId] ?? stageId,
      hs_stage_date:  p.hs_lastmodifieddate ?? null,
      hs_deal_url:    portalId
        ? `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}`
        : null,
      hs_date_entered_new_request:   p['hs_date_entered_3869825744']     ?? null,
      hs_date_entered_qualified:     p['hs_date_entered_qualifiedtobuy'] ?? null,
      hs_date_entered_quote_sent:    p['hs_date_entered_3869825755']     ?? null,
      hs_date_entered_contract_sent: p['hs_date_entered_contractsent']   ?? null,
    };
  });
}

/**
 * Build contact properties and a deal with full form content in the description.
 */
export function buildHubSpotObjects(formType, fields, attachmentUrls = {}) {
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

  // Attachments (both forms) — include signed URLs if available
  if (Array.isArray(fields.attachments) && fields.attachments.length > 0) {
    lines.push('');
    lines.push('Uploaded Files:');
    for (const path of fields.attachments) {
      const filename = path.split('/').pop().replace(/^\d+-/, '');
      const url = attachmentUrls[path];
      lines.push(url ? `  ${filename}: ${url}` : `  ${filename}`);
    }
  }

  const dealProperties = {
    dealname: dealName,
    description: lines.join('\n'),
  };

  return { contactProperties, dealProperties };
}
