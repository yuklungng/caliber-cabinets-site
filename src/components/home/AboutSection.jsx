export function AboutSection() {
  return (
    <section className="home-section about-section" id="about" aria-labelledby="about-title">
      <div className="container about-grid">
        <div className="image-frame">
          {/* TODO: Confirm correct image file for Mike photo — AI Studio uses a different shot */}
          <img src="/images/mike-photo.jpg" alt="Mike, owner of Caliber Cabinets" />
        </div>
        <div className="section-copy">
          <h2 id="about-title">About Caliber Cabinets</h2>
          <p>
            Our roots in cabinet craftsmanship go back to 1984, built on a family tradition of doing
            things the right way.
          </p>
          <p>
            Today, as a second-generation business, we continue that foundation with a focus on
            quality, precision, and long-term durability.
          </p>
          <p>
            Since relaunching in 2011, we've been serving homeowners across the Tri-Valley with
            custom cabinetry designed to last and built to fit how people actually live.
          </p>
        </div>
      </div>
    </section>
  );
}
