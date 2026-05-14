import { useState } from 'react';

const projectTypes = [
  'Kitchen',
  'Bathroom',
  'Closet',
  'Garage',
  'Whole-Home Cabinetry',
  'Cabinet Restoration / Refinishing',
  'Other',
];

const submitMessage =
  'This form is being prepared for launch. Please use the existing request links for now.';

export function ConsultationPrepSection() {
  const [activeForm, setActiveForm] = useState('homeowner');
  const [status, setStatus] = useState({
    homeowner: '',
    trade: '',
  });

  function handleSubmit(formType, event) {
    event.preventDefault();
    setStatus((current) => ({
      ...current,
      [formType]: submitMessage,
    }));
  }

  return (
    <section className="home-section consultation-section" aria-labelledby="consultation-prep-title">
      <div className="container consultation-prep-shell">
        <div className="section-heading consultation-prep-heading">
          <h2 id="consultation-prep-title">How Can We Help?</h2>
          <p>
            Tell us a little about your project so we can route your request to the right next
            step.
          </p>
        </div>

        <div className="consultation-tabs" role="tablist" aria-label="Consultation request paths">
          <button
            type="button"
            className={`consultation-tab${activeForm === 'homeowner' ? ' is-active' : ''}`}
            role="tab"
            id="consultation-tab-homeowner"
            aria-selected={activeForm === 'homeowner'}
            aria-controls="consultation-panel-homeowner"
            onClick={() => setActiveForm('homeowner')}
          >
            Homeowner
          </button>
          <button
            type="button"
            className={`consultation-tab${activeForm === 'trade' ? ' is-active' : ''}`}
            role="tab"
            id="consultation-tab-trade"
            aria-selected={activeForm === 'trade'}
            aria-controls="consultation-panel-trade"
            onClick={() => setActiveForm('trade')}
          >
            Trade Professional
          </button>
        </div>

        <div className="consultation-grid">
          <article
            className="consultation-form-card"
            role="tabpanel"
            id="consultation-panel-homeowner"
            aria-labelledby="consultation-tab-homeowner"
            hidden={activeForm !== 'homeowner'}
          >
            <div className="consultation-card-header">
              <h3>Homeowner Consultation</h3>
              <p>Ideal for kitchen, bath, restoration, and whole-home cabinetry projects.</p>
            </div>

            <form className="consultation-form" onSubmit={(event) => handleSubmit('homeowner', event)}>
              <label htmlFor="homeowner-name">
                Full Name *
                <input id="homeowner-name" name="fullName" type="text" autoComplete="name" required />
              </label>

              <div className="consultation-form-grid">
                <label htmlFor="homeowner-phone">
                  Phone Number *
                  <input id="homeowner-phone" name="phone" type="tel" autoComplete="tel" required />
                </label>
                <label htmlFor="homeowner-email">
                  Email Address *
                  <input
                    id="homeowner-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </label>
              </div>

              <div className="consultation-form-grid">
                <label htmlFor="homeowner-zip">
                  Project ZIP Code *
                  <input id="homeowner-zip" name="zipCode" type="text" inputMode="numeric" required />
                </label>
                <label htmlFor="homeowner-project-type">
                  Project Type
                  <select id="homeowner-project-type" name="projectType" defaultValue="">
                    <option value="" disabled>
                      Select a project type
                    </option>
                    {projectTypes.map((projectType) => (
                      <option key={projectType} value={projectType}>
                        {projectType}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label htmlFor="homeowner-project-notes">
                Tell us about your project
                <textarea id="homeowner-project-notes" name="projectNotes" rows="5" />
              </label>

              <button className="button button-primary" type="submit">
                Request Consultation
              </button>

              {status.homeowner ? (
                <p className="form-success" role="status" aria-live="polite">
                  {status.homeowner}
                </p>
              ) : null}
            </form>
          </article>

          <article
            className="consultation-form-card"
            role="tabpanel"
            id="consultation-panel-trade"
            aria-labelledby="consultation-tab-trade"
            hidden={activeForm !== 'trade'}
          >
            <div className="consultation-card-header">
              <h3>Trade Professional Estimate</h3>
              <p>Built for contractors, designers, and collaborative cabinetry project work.</p>
            </div>

            <form className="consultation-form" onSubmit={(event) => handleSubmit('trade', event)}>
              <div className="consultation-form-grid">
                <label htmlFor="trade-name">
                  Full Name *
                  <input id="trade-name" name="fullName" type="text" autoComplete="name" required />
                </label>
                <label htmlFor="trade-company">
                  Company Name *
                  <input id="trade-company" name="companyName" type="text" autoComplete="organization" required />
                </label>
              </div>

              <div className="consultation-form-grid">
                <label htmlFor="trade-phone">
                  Phone Number *
                  <input id="trade-phone" name="phone" type="tel" autoComplete="tel" required />
                </label>
                <label htmlFor="trade-email">
                  Email Address *
                  <input id="trade-email" name="email" type="email" autoComplete="email" required />
                </label>
              </div>

              <div className="consultation-form-grid">
                <label htmlFor="trade-zip">
                  Project ZIP Code *
                  <input id="trade-zip" name="zipCode" type="text" inputMode="numeric" required />
                </label>
                <label htmlFor="trade-scope">
                  Project Type / Scope
                  <input id="trade-scope" name="projectScope" type="text" />
                </label>
              </div>

              <label htmlFor="trade-notes">
                Project Notes
                <textarea id="trade-notes" name="projectNotes" rows="5" />
              </label>

              <button className="button button-primary" type="submit">
                Request Trade Estimate
              </button>

              {status.trade ? (
                <p className="form-success" role="status" aria-live="polite">
                  {status.trade}
                </p>
              ) : null}
            </form>
          </article>
        </div>
      </div>
    </section>
  );
}
