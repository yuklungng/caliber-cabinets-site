/* global process */

/**
 * HubSpot CRM helpers
 *
 * Requires env var:
 *   HUBSPOT_ACCESS_TOKEN  — Private App access token (pat-na1-...)
 *
 * Optional env vars (override defaults):
 *   HUBSPOT_PIPELINE_ID    — deal pipeline ID (default: "default")
 *   HUBSPOT_DEAL_STAGE_ID  — initial deal stage ID (default: "appointmentscheduled")
 */

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
    inputs: [
      {
        idProperty: 'email',
        id: properties.email,
        properties,
      },
    ],
  });

  if (!res.ok) {
    throw new Error(`HubSpot contact upsert ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.results?.[0]?.id ?? null;
}

/**
 * Create a deal and associate it with a contact.
 * Returns the HubSpot deal ID string.
 */
export async function createDeal(properties, contactId) {
  // Set close date 90 days out as a placeholder
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

  if (!res.ok) {
    throw new Error(`HubSpot deal create ${res.status}: ${await res.text()}`);
  }

  const { id: dealId } = await res.json();

  // Associate deal → contact
  if (contactId && dealId) {
    const assocRes = await hs('/crm/v3/associations/deals/contacts/batch/create', 'POST', {
      inputs: [{ from: { id: dealId }, to: { id: contactId }, type: 'deal_to_contact' }],
    });
    if (!assocRes.ok) {
      // Log but don't throw — deal exists, association is best-effort
      console.error('[hubspot] Association failed:', await assocRes.text());
    }
  }

  return dealId;
}

/**
 * Build contact and deal properties from form submission fields.
 */
export function buildHubSpotObjects(formType, fields) {
  const isHomeowner = formType === 'homeowner-consultation';

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

  const personName = `${fields.firstName ?? ''} ${fields.lastName ?? ''}`.trim();
  const dealName = isHomeowner
    ? `Design Consultation – ${personName}`
    : `Trade Estimate – ${fields.companyName ? `${fields.companyName} (${personName})` : personName}`;

  // Build a deal description from key project details
  const notes = [];
  if (fields.projectType) notes.push(`Project type: ${fields.projectType}`);
  if (fields.timeline) notes.push(`Timeline: ${fields.timeline}`);
  if (fields.tradeRole) notes.push(`Trade role: ${fields.tradeRole}`);
  if (Array.isArray(fields.areasRequiringCabinetry) && fields.areasRequiringCabinetry.length) {
    notes.push(`Areas: ${fields.areasRequiringCabinetry.join(', ')}`);
  }
  if (fields.installationTimeline) notes.push(`Install timeline: ${fields.installationTimeline}`);
  if (fields.description) notes.push(`\nNotes: ${fields.description}`);
  if (fields.comments) notes.push(`\nComments: ${fields.comments}`);

  const dealProperties = {
    dealname: dealName,
    ...(notes.length && { description: notes.join(' | ') }),
  };

  return { contactProperties, dealProperties };
}
