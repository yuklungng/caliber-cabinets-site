const testimonials = [
  {
    name: 'E. Beratlis',
    project: 'Cabinet Restoration',
    initials: 'EB',
    quote:
      'I was nervous trusting such an important job to someone I found on Yelp, but Michael and his team exceeded every expectation. They restored our custom cabinets instead of just painting them, carefully matching finishes and repairing years of water damage. Over a year later, everything still looks brand new. I would 100% recommend Michael and his team for their honesty, craftsmanship, and attention to detail.',
  },
  {
    name: 'B. Hart',
    project: 'Full Kitchen Remodel',
    initials: 'BH',
    quote:
      "We worked closely with Mike and his team to fine-tune every detail of our kitchen remodel. The cabinets, woodwork, and finishes turned out amazing, and the installation was flawless. The team was incredibly responsive throughout the entire process. I can't recommend them enough.",
  },
  {
    name: 'C. Bason',
    project: 'Custom Cabinets',
    initials: 'CB',
    quote:
      'The quality of the work was outstanding, especially the custom colors. The team communicated clearly, checked every detail, and delivered on time. Installation was fast and professional, and they handled adjustments on the spot with practical solutions. Highly recommend Caliber for custom cabinetry.',
  },
];

export function TestimonialsSection() {
  return (
    <section className="home-section testimonials-section" id="testimonials" aria-labelledby="testimonials-title">
      <div className="container section-heading">
        <p className="eyebrow" style={{ color: '#78350f' }}>
          Verified Customer Reviews
        </p>
        <h2 id="testimonials-title">What Our Clients Say</h2>
      </div>
      <div className="container testimonial-grid">
        {testimonials.map((testimonial) => (
          <figure className="testimonial-card" key={testimonial.name}>
            <div className="stars" aria-label="5 star review">
              <span>★★★★★</span>
            </div>
            <blockquote>"{testimonial.quote}"</blockquote>
            <figcaption>
              <span className="review-initials" aria-hidden="true">
                {testimonial.initials}
              </span>
              <strong>
                {testimonial.name}
                <span>{testimonial.project}</span>
              </strong>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
