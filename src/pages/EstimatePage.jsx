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

const tradeTypes = [
  'General Contractor',
  'Interior Designer',
  'Architect',
  'Developer',
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

export function EstimatePage() {
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
              <h1>Request a Design Estimate</h1>
              <p className="lead-subheading">
                For contractors, designers, and trade partners. We&apos;ll respond within 1
                business day.
              </p>

              <form className="lead-form" onSubmit={handleSubmit}>
                <div className="lead-field">
                  <label htmlFor="estimate-name">Full Name *</label>
                  <input id="estimate-name" name="fullName" type="text" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-company">Company Name *</label>
                  <input id="estimate-company" name="companyName" type="text" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-phone">Phone Number *</label>
                  <input id="estimate-phone" name="phoneNumber" type="tel" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-email">Email Address *</label>
                  <input id="estimate-email" name="emailAddress" type="email" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-zip">Project ZIP Code *</label>
                  <input id="estimate-zip" name="projectZipCode" type="text" required />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-trade-type">Trade Type</label>
                  <select id="estimate-trade-type" name="tradeType" defaultValue="">
                    <option value="">Select a trade type</option>
                    {tradeTypes.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-scope">Project Type / Scope</label>
                  <textarea id="estimate-scope" name="projectScope" rows="3" />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-notes">Project Notes</label>
                  <textarea id="estimate-notes" name="projectNotes" rows="3" />
                </div>

                <div className="lead-field">
                  <label htmlFor="estimate-referral">How did you hear about us?</label>
                  <select id="estimate-referral" name="referralSource" defaultValue="">
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
