import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { CircleCheckBig } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

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

export function ConsultationPage() {
  const [turnstileToken, setTurnstileToken] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    document.title = 'Request a Design Consultation | Caliber Cabinets';
  }, []);

  // Warn on browser navigation (tab close, back button, address bar)
  useEffect(() => {
    if (!isDirty || isSubmitted) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, isSubmitted]);

  // Warn on React Router in-app navigation (logo, nav links)
  const blocker = useBlocker(isDirty && !isSubmitted);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('You have unsaved changes. Leave this page?')) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');
    setIsSending(true);

    const formData = new FormData(event.currentTarget);
    const fields = {
      firstName: formData.get('firstName') ?? '',
      lastName: formData.get('lastName') ?? '',
      phone: formData.get('phone') ?? '',
      email: formData.get('email') ?? '',
      projectType: formData.get('projectType') ?? '',
      timeline: formData.get('timeline') ?? '',
      projectAddress: formData.get('projectAddress') ?? '',
      description: formData.get('description') ?? '',
      inspiration: formData.get('inspiration') ?? '',
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
                    <input id="c-phone" name="phone" type="tel" required />
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
                  <label htmlFor="c-address">Project Address</label>
                  <p className="lead-helper-text">Optional — helps us prepare for your consultation</p>
                  <input id="c-address" name="projectAddress" type="text" />
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
                  <p className="lead-helper-text">
                    Optional — share links, style references, or describe your vision
                  </p>
                  <textarea id="c-inspiration" name="inspiration" rows="3" />
                </div>

                <div className="lead-field">
                  <label>Upload Photos or Sketches</label>
                  <p className="lead-helper-text">Optional</p>
                  <div className="lead-banner">
                    File uploads coming soon. Email photos to{' '}
                    <a href="mailto:info@calibercabinetshop.com">info@calibercabinetshop.com</a>
                  </div>
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
