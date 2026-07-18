import { useEffect, useState } from 'react';
import { CircleCheckBig } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';
import { uploadFiles } from '../lib/uploadFiles.js';
import { FileDropZone } from '../components/FileDropZone.jsx';

const projectTypes = [
  'Kitchen',
  'Bathroom',
  'Closet',
  'Garage',
  'Entertainment Center',
  'Other',
];

const timelineOptions = [
  'As soon as possible',
  '1–3 months',
  '3–6 months',
  '6+ months',
];

const stateOptions = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois',
  'Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts',
  'Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota',
  'Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
  'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington',
  'West Virginia','Wisconsin','Wyoming','American Samoa','Guam',
  'Northern Mariana Islands','Puerto Rico','U.S. Virgin Islands',
];

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

function Req() {
  return <span className="req"> (Required)</span>;
}

/** Auto-formats a phone string to (###)###-#### as the user types */
function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)})${digits.slice(3)}`;
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
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

export function ConsultationPage() {
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const prevTitle = document.title;
    const metaDesc = document.querySelector('meta[name="description"]');
    const canonical = document.querySelector('link[rel="canonical"]');
    const prevDesc = metaDesc?.getAttribute('content') ?? '';
    const prevCanonical = canonical?.getAttribute('href') ?? '';

    document.title = 'Request a Free Design Consultation | Caliber Cabinets Livermore';
    metaDesc?.setAttribute('content', 'Schedule a free cabinetry design consultation with Caliber Cabinets in Livermore, CA. Tell us about your kitchen, bathroom, or custom built-in project — we respond within 1 business day.');
    canonical?.setAttribute('href', 'https://calibercabinetshop.com/request-a-design-consultation');

    return () => {
      document.title = prevTitle;
      metaDesc?.setAttribute('content', prevDesc);
      canonical?.setAttribute('href', prevCanonical);
    };
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
        attachments = await uploadFiles(selectedFiles, 'homeowner-consultation');
      } catch (uploadErr) {
        setUploadError(uploadErr.message);
        setIsSending(false);
        return;
      }
    }

    const fields = {
      firstName: formData.get('firstName') ?? '',
      lastName: formData.get('lastName') ?? '',
      phone: formData.get('phone') ?? '',
      email: formData.get('email') ?? '',
      projectType: formData.get('projectType') ?? '',
      timeline: formData.get('timeline') ?? '',
      streetAddress: formData.get('streetAddress') ?? '',
      city: formData.get('city') ?? '',
      state: formData.get('state') ?? '',
      zipCode: formData.get('zipCode') ?? '',
      description: formData.get('description') ?? '',
      inspiration: formData.get('inspiration') ?? '',
      attachments,
    };

    try {
      const response = await fetch('/api/lead-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType: 'homeowner-consultation', fields, turnstileToken }),
      });

      if (!response.ok) throw new Error('Lead submission failed');
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
              <h1 className="form-page-title">Request a Design Consultation</h1>
              <p className="form-page-subheading">
                Once you submit: we review your details, reach out within 1 business day, and
                schedule your consultation — no pressure, no obligation.
              </p>

              <form className="lead-form" onSubmit={handleSubmit} onChange={() => setIsDirty(true)}>

                {/* Contact Info */}
                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="c-first-name">First Name<Req /></label>
                    <input id="c-first-name" name="firstName" type="text" required />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="c-last-name">Last Name<Req /></label>
                    <input id="c-last-name" name="lastName" type="text" required />
                  </div>
                </div>

                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="c-phone">Phone Number<Req /></label>
                    <input
                      id="c-phone"
                      name="phone"
                      type="tel"
                      required
                      value={phone}
                      onChange={e => setPhone(formatPhone(e.target.value))}
                      placeholder="(925)555-1234"
                      pattern="\(\d{3}\)\d{3}-\d{4}"
                      title="Enter a 10-digit US phone number"
                      maxLength={13}
                    />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="c-email">Email Address<Req /></label>
                    <input id="c-email" name="email" type="email" required />
                  </div>
                </div>

                {/* Project Details */}
                <div className="form-section-title">
                  <h2>Project Details</h2>
                </div>

                <div className="lead-field-grid lead-field-grid--two">
                  <div className="lead-field">
                    <label htmlFor="c-project-type">Project Type</label>
                    <select id="c-project-type" name="projectType" defaultValue="">
                      <option value="" disabled>Select a project type</option>
                      {projectTypes.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>

                  <div className="lead-field">
                    <label htmlFor="c-timeline">Estimated Timeline</label>
                    <select id="c-timeline" name="timeline" defaultValue="">
                      <option value="" disabled>Select a timeline</option>
                      {timelineOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="lead-field">
                  <label htmlFor="c-street-address">Street Address</label>
                  <input id="c-street-address" name="streetAddress" type="text" aria-describedby="c-street-address-hint" />
                  <p id="c-street-address-hint" className="lead-helper-text">Optional — helps us prepare for your consultation</p>
                </div>

                <div className="lead-field-grid lead-field-grid--three">
                  <div className="lead-field">
                    <label htmlFor="c-city">City<Req /></label>
                    <input id="c-city" name="city" type="text" required />
                  </div>
                  <div className="lead-field">
                    <label htmlFor="c-state">State</label>
                    <select id="c-state" name="state" defaultValue="California">
                      {stateOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="lead-field">
                    <label htmlFor="c-zip">ZIP Code<Req /></label>
                    <input id="c-zip" name="zipCode" type="text" required />
                  </div>
                </div>

                {/* About Your Project */}
                <div className="form-section-title">
                  <h2>About Your Project</h2>
                </div>

                <div className="lead-field">
                  <label htmlFor="c-description">Brief Description</label>
                  <textarea
                    id="c-description"
                    name="description"
                    rows="5"
                    placeholder="Share what you're looking to build, your goals, or any specific ideas you have"
                  />
                </div>

                {/* Inspiration */}
                <div className="form-section-title">
                  <h2>Inspiration</h2>
                </div>

                <div className="lead-field">
                  <label htmlFor="c-inspiration">Links or Style Description</label>
                  <textarea id="c-inspiration" name="inspiration" rows="3" aria-describedby="c-inspiration-hint" />
                  <p id="c-inspiration-hint" className="lead-helper-text">
                    Optional — share links, style references, or describe your vision
                  </p>
                </div>

                <div className="lead-field">
                  <label>Upload Photos or Sketches</label>
                  <FileDropZone
                    accept=".jpg,.jpeg,.png,.pdf"
                    multiple
                    hint="JPG, PNG, or PDF — up to 10MB each, max 5 files"
                    selectedFiles={selectedFiles}
                    onChange={(files) => { setSelectedFiles(files); setUploadError(''); }}
                    error={uploadError}
                  />
                </div>

                {/* What Happens Next */}
                <div className="form-section-title">
                  <h2>What Happens Next</h2>
                </div>
                <p className="form-next-steps">
                  Once you submit: we review your details, reach out within 1 business day, and
                  schedule your consultation — no pressure, no obligation.
                </p>

                {/* Turnstile + Submit */}
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
                      Turnstile is waiting for VITE_TURNSTILE_SITE_KEY in the environment.
                    </div>
                  )}
                </div>

                <button
                  className="lead-submit"
                  type="submit"
                  disabled={!turnstileToken || isSending}
                >
                  {isSending ? 'Sending…' : 'Send My Request'}
                </button>

                {submitError ? <p className="lead-error" role="alert">{submitError}</p> : null}
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
