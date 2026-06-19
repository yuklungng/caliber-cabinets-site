import { useEffect, useState } from 'react';
import { CircleCheckBig } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';
import { uploadFiles } from '../lib/uploadFiles.js';
import { FileDropZone } from '../components/FileDropZone.jsx';

const tradeTypes = [
  'Interior Designer',
  'General Contractor',
  'Architect',
  'Builder / Developer',
  'Remodeling Contractor',
  'Other',
];

const preferredContactOptions = ['Phone', 'Email', 'Either'];
const installationTimelineOptions = ['1-2 Months', '3-6 Months', '6-12 Months', 'Other'];

const constructionMethodOptions = [
  'Face Frame, 1/8" Reveal, Full Overlay',
  'Flush Inset Doors / Drawer Fronts',
  'Frame-less (European Style), Full Overlay',
  'Other (explain in comments)',
];

const crownMoldingOptions = [
  'Traditional Crown Molding',
  'Flat Crown Molding',
  'No Molding / Shadow Line',
  'Other (explain in comments)',
];

const doorStyleOptions = [
  'Slab Door',
  'Shaker Door / Flat Panel',
  'Raised Panel',
  'Other (attach photo or explain)',
];

const woodSpeciesOptions = [
  'Painted Cabinetry',
  'Maple',
  'Cherry',
  'Alder',
  'Beech',
  'Hickory / Pecan',
  'Red Oak',
  'White Oak',
  'Rift Oak',
  'Quarter Sawn Oak',
  'Walnut',
  'Bamboo',
  'Cleaf / Laminate',
  'Vertical Grain Fir',
  'Other (explain in comments)',
];

const areaOptions = [
  'Kitchen',
  'Bathroom(s)',
  'Entertainment Center',
  'Closet Cabinetry',
  'Fireplace Mantle',
  'Garage',
  'Other',
];

const accessoryOptions = [
  'Panelized Ends',
  'Base Pull-Outs',
  'Spice Rack / Drawers',
  'Solid Wood Dovetail Drawer Boxes',
  'Roll-Out Drawers',
  'Two-Tier Silverware Drawer',
  'LED Lighting',
  'Lazy Susan',
  'Lemans II',
  'Other (explain in comments)',
];

const stateOptions = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'District of Columbia',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
  'American Samoa',
  'Guam',
  'Northern Mariana Islands',
  'Puerto Rico',
  'U.S. Virgin Islands',
];

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

function Req() {
  return <span className="req"> (Required)</span>;
}

function SuccessState() {
  return (
    <div className="form-success-card">
      <span className="lead-success-icon" aria-hidden="true">
        <CircleCheckBig size={32} />
      </span>
      <div>
        <h1>We got your message.</h1>
        <p>
          Thanks for reaching out. We&apos;ll follow up within 1 business day. For urgent
          requests, call us at (925) 292-9124.
        </p>
      </div>
    </div>
  );
}

function optionId(prefix, value) {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function EstimatePage() {
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    document.title = 'Trade Partner Design & Estimate Request | Caliber Cabinets';
  }, []);

  // Warn on browser navigation (tab close, back button, address bar)
  useEffect(() => {
    if (!isDirty || isSubmitted) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, isSubmitted]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');
    setIsSending(true);

    const formData = new FormData(event.currentTarget);

    let attachments = [];
    if (selectedFiles.length > 0) {
      try {
        attachments = await uploadFiles(selectedFiles, 'trade-estimate');
      } catch (uploadErr) {
        setUploadError(uploadErr.message);
        setIsSending(false);
        return;
      }
    }

    const fields = {
      needsDesignServices: formData.get('needsDesignServices') === 'Yes',
      firstName: formData.get('firstName') ?? '',
      lastName: formData.get('lastName') ?? '',
      companyName: formData.get('companyName') ?? '',
      tradeRole: formData.get('tradeRole') ?? '',
      phone: formData.get('phone') ?? '',
      email: formData.get('email') ?? '',
      licenseNumber: formData.get('licenseNumber') ?? '',
      preferredContact: formData.get('preferredContact') ?? '',
      gcNameAndPhone: formData.get('gcNameAndPhone') ?? '',
      clientFirstName: formData.get('clientFirstName') ?? '',
      clientLastName: formData.get('clientLastName') ?? '',
      streetAddress: formData.get('streetAddress') ?? '',
      city: formData.get('city') ?? '',
      state: formData.get('state') ?? '',
      zipCode: formData.get('zipCode') ?? '',
      areasRequiringCabinetry: formData.getAll('areasRequiringCabinetry'),
      installationTimeline: formData.get('installationTimeline') ?? '',
      constructionMethod: formData.get('constructionMethod') ?? '',
      crownMolding: formData.get('crownMolding') ?? '',
      doorStyle: formData.get('doorStyle') ?? '',
      woodSpecies: formData.getAll('woodSpecies'),
      accessories: formData.getAll('accessories'),
      comments: formData.get('comments') ?? '',
      attachments,
    };

    try {
      const response = await fetch('/api/lead-submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          formType: 'trade-estimate',
          fields,
          turnstileToken,
        }),
      });

      if (!response.ok) {
        throw new Error('Lead submission failed');
      }

      await response.json();
      setIsSubmitted(true);
    } catch {
      setSubmitError(
        'Something went wrong. Please call us at (925) 292-9124 or email info@calibercabinetshop.com.',
      );
      setIsSending(false);
    }
  }

  return (
    <div className="lead-page">
      <SiteHeader hideCta />
      <main id="main-content">
        <div className="container">
        <div className="form-shell">
          {isSubmitted ? (
            <SuccessState />
          ) : (
            <>
              <h1 className="form-page-title">Trade Partner Design &amp; Estimate Request</h1>
              <p className="form-page-subheading">
                Complete the form below and we&apos;ll follow up within 1 business day to discuss
                your project scope and schedule an estimate.
              </p>

              <form className="lead-form" onSubmit={handleSubmit} onChange={() => setIsDirty(true)}>
                <div className="lead-info-box">
                  <p>NEED DESIGN &amp; MEASURE SERVICES?</p>
                  <ul>
                    <li>
                      If your client does not have professional drawings or architect plans, we
                      offer a Design Agreement at $175/hr with a non-refundable 5-hour deposit
                      ($875).
                    </li>
                    <li>
                      Includes: Project Consultation, Job Site Measure, Layout, Detailed Estimate,
                      and 3D Renderings.
                    </li>
                    <li>
                      Design scope covers cabinetry layout and material selections only.
                    </li>
                  </ul>
                  <p className="lead-info-credit">
                    Design fees are fully credited toward the cabinet purchase if your client
                    proceeds with Caliber Cabinets.
                  </p>
                </div>

                <label
                  className="lead-choice lead-choice--single"
                  htmlFor="estimate-needs-design-services"
                >
                  <input
                    id="estimate-needs-design-services"
                    name="needsDesignServices"
                    type="checkbox"
                    value="Yes"
                  />
                  <span>Yes, my client needs Design &amp; Measure services for this project.</span>
                </label>

                <div className="form-section-title">
                  <h2>Trade Professional Information</h2>
                </div>

                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="estimate-first-name">First Name<Req /></label>
                    <input id="estimate-first-name" name="firstName" type="text" required />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="estimate-last-name">Last Name<Req /></label>
                    <input id="estimate-last-name" name="lastName" type="text" required />
                  </div>
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-company">Company / Firm Name</label>
                  <input id="estimate-company" name="companyName" type="text" />
                </div>

                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="estimate-phone">Phone Number<Req /></label>
                    <input id="estimate-phone" name="phone" type="tel" required />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="estimate-email">Email Address<Req /></label>
                    <input id="estimate-email" name="email" type="email" required />
                  </div>
                </div>

                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="estimate-trade-role">Trade Role</label>
                    <select id="estimate-trade-role" name="tradeRole" defaultValue="">
                      <option value="" disabled>Select your trade role</option>
                      {tradeTypes.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="lead-field">
                    <label htmlFor="estimate-license-number">License Number</label>
                    <input id="estimate-license-number" name="licenseNumber" type="text" />
                    <p className="lead-helper-text">If applicable</p>
                  </div>
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-preferred-contact">Preferred Contact</label>
                  <select id="estimate-preferred-contact" name="preferredContact" defaultValue="">
                    <option value="" disabled>Select preferred contact method</option>
                    {preferredContactOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-gc-contact">General Contractor Name &amp; Phone</label>
                  <input id="estimate-gc-contact" name="gcNameAndPhone" type="text" />
                  <p className="lead-helper-text">If different from above</p>
                </div>

                <div className="form-section-title">
                  <h2>Client Project Information</h2>
                </div>

                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="estimate-client-first-name">Client First Name</label>
                    <input id="estimate-client-first-name" name="clientFirstName" type="text" />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="estimate-client-last-name">Client Last Name</label>
                    <input id="estimate-client-last-name" name="clientLastName" type="text" />
                  </div>
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-street-address">Street Address</label>
                  <input id="estimate-street-address" name="streetAddress" type="text" />
                </div>

                <div className="lead-field-grid lead-field-grid--three">
                  <div className="lead-field">
                    <label htmlFor="estimate-city">City</label>
                    <input id="estimate-city" name="city" type="text" />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="estimate-state">State</label>
                    <select id="estimate-state" name="state" defaultValue="California">
                      {stateOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lead-field">
                    <label htmlFor="estimate-zip">ZIP Code</label>
                    <input id="estimate-zip" name="zipCode" type="text" />
                    <p className="lead-helper-text">For sales tax &amp; bid accuracy</p>
                  </div>
                </div>

                <div className="form-section-title">
                  <h2>Project Scope</h2>
                </div>

                <fieldset className="lead-choice-group">
                  <legend>Areas Requiring Cabinetry</legend>
                  <div className="lead-choice-grid lead-choice-grid--two">
                    {areaOptions.map((option) => (
                      <label
                        className="lead-choice"
                        htmlFor={optionId('estimate-area', option)}
                        key={option}
                      >
                        <input
                          id={optionId('estimate-area', option)}
                          name="areasRequiringCabinetry"
                          type="checkbox"
                          value={option}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="lead-choice-group">
                  <legend>Installation Timeline</legend>
                  <div className="lead-choice-grid lead-choice-grid--two">
                    {installationTimelineOptions.map((option) => (
                      <label
                        className="lead-choice"
                        htmlFor={optionId('estimate-installation-timeline', option)}
                        key={option}
                      >
                        <input
                          id={optionId('estimate-installation-timeline', option)}
                          name="installationTimeline"
                          type="radio"
                          value={option}
                        />
                        <span>{option.replaceAll('-', '\u2013')}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="form-section-title">
                  <h2>Materials &amp; Specifications</h2>
                </div>

                {/* Construction Method + Crown Molding: side by side */}
                <div className="form-cols-2">
                  <fieldset className="lead-choice-group">
                    <legend>Construction Method</legend>
                    <div className="lead-radio-list">
                      {constructionMethodOptions.map((option) => (
                        <label
                          className="lead-choice"
                          htmlFor={optionId('estimate-construction-method', option)}
                          key={option}
                        >
                          <input
                            id={optionId('estimate-construction-method', option)}
                            name="constructionMethod"
                            type="radio"
                            value={option}
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="lead-choice-group">
                    <legend>Crown Molding</legend>
                    <div className="lead-radio-list">
                      {crownMoldingOptions.map((option) => (
                        <label
                          className="lead-choice"
                          htmlFor={optionId('estimate-crown-molding', option)}
                          key={option}
                        >
                          <input
                            id={optionId('estimate-crown-molding', option)}
                            name="crownMolding"
                            type="radio"
                            value={option}
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

                <fieldset className="lead-choice-group">
                  <legend>Door Style</legend>
                  <div className="lead-choice-grid lead-choice-grid--three">
                    {doorStyleOptions.map((option) => (
                      <label
                        className="lead-choice"
                        htmlFor={optionId('estimate-door-style', option)}
                        key={option}
                      >
                        <input
                          id={optionId('estimate-door-style', option)}
                          name="doorStyle"
                          type="radio"
                          value={option}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="lead-choice-group">
                  <legend>Wood Species / Material</legend>
                  <div className="lead-choice-grid lead-choice-grid--three">
                    {woodSpeciesOptions.map((option) => (
                      <label
                        className="lead-choice"
                        htmlFor={optionId('estimate-wood-species', option)}
                        key={option}
                      >
                        <input
                          id={optionId('estimate-wood-species', option)}
                          name="woodSpecies"
                          type="checkbox"
                          value={option}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="form-section-title">
                  <h2 id="estimate-accessories-heading">Accessories &amp; Upgrades</h2>
                </div>

                <fieldset className="lead-choice-group" aria-labelledby="estimate-accessories-heading">
                  <div className="lead-choice-grid lead-choice-grid--two">
                    {accessoryOptions.map((option) => (
                      <label
                        className="lead-choice"
                        htmlFor={optionId('estimate-accessory', option)}
                        key={option}
                      >
                        <input
                          id={optionId('estimate-accessory', option)}
                          name="accessories"
                          type="checkbox"
                          value={option}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="form-section-title">
                  <h2>Project Notes &amp; Files</h2>
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-comments">Comments</label>
                  <textarea id="estimate-comments" name="comments" rows="5" />
                </div>

                <div className="lead-field">
                  <label>Upload Files</label>
                  <FileDropZone
                    accept=".pdf,.dwg,.jpg,.jpeg,.png"
                    multiple
                    hint="PDF, DWG, JPG, or PNG — up to 10MB each, max 5 files"
                    selectedFiles={selectedFiles}
                    onChange={(files) => { setSelectedFiles(files); setUploadError(''); }}
                    error={uploadError}
                  />
                </div>

                <div className="turnstile-wrap">
                  {turnstileSiteKey ? (
                    <Turnstile
                      siteKey={turnstileSiteKey}
                      onSuccess={(token) => setTurnstileToken(token)}
                      onExpire={() => setTurnstileToken('')}
                      onError={() => setTurnstileToken('')}
                    />
                  ) : (
                    <div className="turnstile-missing">
                      Turnstile is waiting for `VITE_TURNSTILE_SITE_KEY` in the environment.
                    </div>
                  )}
                </div>

                <button
                  className="lead-submit"
                  type="submit"
                  disabled={!turnstileToken || isSending}
                >
                  {isSending ? 'Sending...' : 'Send My Request'}
                </button>

                {submitError ? <p className="lead-error">{submitError}</p> : null}
              </form>
            </>
          )}
        </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
