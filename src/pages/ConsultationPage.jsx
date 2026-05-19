import { useState } from 'react';
import { CircleCheckBig } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

const referralOptions = [
  'Google Search',
  'Yelp',
  'Houzz',
  'Referral from friend/family',
  'Facebook/Instagram',
  'Drove by / saw our work',
  'Other',
];

const projectTypes = [
  'Kitchen',
  'Bathroom',
  'Closet',
  'Garage',
  'Whole-Home Cabinetry',
  'Cabinet Restoration / Refinishing',
  'Other',
];

const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

function SuccessState() {
  return (
    <div className="lead-card lead-success">
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

  function handleSubmit(event) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());

    console.log({
      ...values,
      turnstileToken,
    });

    setIsSubmitted(true);
  }

  return (
    <div className="lead-page">
      <SiteHeader />
      <main id="main-content">
        <div className="lead-page-shell">
          {isSubmitted ? (
            <SuccessState />
          ) : (
            <div className="lead-card">
              <h1>Request a Design Consultation</h1>
              <p className="lead-subheading">
                Tell us about your project and we&apos;ll follow up within 1 business day.
              </p>

              <form className="lead-form" onSubmit={handleSubmit}>
                <div className="lead-field">
                  <label htmlFor="consultation-name">Full Name *</label>
                  <input id="consultation-name" name="fullName" type="text" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="consultation-phone">Phone Number *</label>
                  <input id="consultation-phone" name="phoneNumber" type="tel" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="consultation-email">Email Address *</label>
                  <input id="consultation-email" name="emailAddress" type="email" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="consultation-zip">Project ZIP Code *</label>
                  <input id="consultation-zip" name="projectZipCode" type="text" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="consultation-project-type">Project Type</label>
                  <select id="consultation-project-type" name="projectType" defaultValue="">
                    <option value="">Select a project type</option>
                    {projectTypes.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lead-field">
                  <label htmlFor="consultation-project-details">Tell us about your project</label>
                  <textarea
                    id="consultation-project-details"
                    name="projectDescription"
                    rows="4"
                  />
                </div>

                <div className="lead-field">
                  <label htmlFor="consultation-referral">How did you hear about us?</label>
                  <select id="consultation-referral" name="referralSource" defaultValue="">
                    <option value="">Select an option</option>
                    {referralOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
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

                <button className="lead-submit" type="submit" disabled={!turnstileToken}>
                  Send My Request
                </button>
              </form>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
