const homeownerConsultationUrl = 'https://calibercabinetshop.com/request-a-design-consultation/';
const tradeEstimateUrl = 'https://calibercabinetshop.com/request-design-estimate/';

export function ContactCta() {
  return (
    <section
      className="home-section contact-cta"
      id="contact"
      aria-labelledby="contact-title"
    >
      <div className="container cta-panel">
        <h2 id="contact-title">Ready to Start Your Project?</h2>
        <p>
          Book a free consultation with Mike and the team. We'll walk through your space and provide
          transparent, expert advice.
        </p>
        <div className="cta-actions">
          <a className="button button-primary" href={homeownerConsultationUrl}>
            I&apos;m a Homeowner &mdash; Request Consultation
          </a>
          <a className="button button-secondary cta-secondary" href={tradeEstimateUrl}>
            I&apos;m a Trade Professional &mdash; Request Estimate
          </a>
        </div>
      </div>
    </section>
  );
}
