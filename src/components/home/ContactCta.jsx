const homeownerConsultationUrl = 'https://calibercabinetshop.com/request-a-design-consultation/';
const tradeEstimateUrl = 'https://calibercabinetshop.com/request-design-estimate/';

export function ContactCta() {
  return (
    <section className="home-section contact-cta" id="contact" aria-labelledby="contact-title">
      <div className="cta-panel">
        <div className="cta-media">
          <img
            src="/images/cta-kitchen-showcase.jpg"
            alt=""
            className="cta-image"
            aria-hidden="true"
          />
        </div>
        <div className="cta-content">
          <div className="cta-copy">
            <h2 id="contact-title">How Can We Help You?</h2>
            <p>
              Whether you&apos;re a homeowner starting a project or a trade professional &mdash; we
              have the right process for you.
            </p>
            <div className="cta-actions">
              <a
                className="button cta-homeowner"
                href={homeownerConsultationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                I&apos;m a Homeowner &mdash; Request Consultation
              </a>
              <a
                className="button cta-trade"
                href={tradeEstimateUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                I&apos;m a Trade Professional &mdash; Request Estimate
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
