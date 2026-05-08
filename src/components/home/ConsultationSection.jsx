import { useState } from 'react';

export function ConsultationSection() {
  const [isSubmitted, setIsSubmitted] = useState(false);

  function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitted(true);
  }

  return (
    <section
      className="home-section consultation-section"
      id="consultation"
      aria-labelledby="consultation-title"
    >
      <div className="container consultation-grid">
        <div className="section-copy">
          <h2 id="consultation-title">Book Your Free Consultation</h2>
          <p>Tell us about your project and we&rsquo;ll follow up to discuss next steps.</p>
        </div>

        <form className="consultation-form" onSubmit={handleSubmit}>
          <label>
            Full Name
            <input name="fullName" type="text" autoComplete="name" required />
          </label>
          <label>
            Phone Number
            <input name="phone" type="tel" autoComplete="tel" required />
          </label>
          <label>
            Email Address
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Tell us about your project
            <textarea name="projectDetails" rows="5" required />
          </label>

          <button className="button button-primary" type="submit">
            Submit Project Request
          </button>

          <p className="consultation-contact">
            Or call us directly: (925) 292-9124 &middot; info@calibercabinetshop.com
          </p>

          {isSubmitted && (
            <p className="form-success" role="status">
              Thanks &mdash; we received your request and will follow up soon.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
