export function ContactCta() {
  return (
    <section
      className="home-section contact-cta"
      id="contact"
      aria-labelledby="contact-title"
    >
      <div className="container cta-panel" id="consultation">
        <h2 id="contact-title">Ready to Start Your Project?</h2>
        <p>
          Book a free consultation with Mike and the team. We'll walk through your space and provide
          transparent, expert advice.
        </p>
        <a className="button button-primary" href="#consultation">
          Book Your Free Consultation
        </a>
      </div>
    </section>
  );
}
