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
            Caliber Cabinets has been building custom cabinetry in Livermore since 1984. What
            started as one family&apos;s trade became a 40-year track record - one that Mike grew up
            inside before taking it over as a second-generation owner. That kind of continuity
            isn&apos;t something you manufacture. It&apos;s built job by job, over decades.
          </p>
          <p>
            We&apos;re a small, hands-on shop serving the Tri-Valley - Livermore, Pleasanton, Dublin,
            and the surrounding 680 corridor. Every project runs through Michael directly, from
            design to fabrication to final installation. No franchise overhead, no showroom
            salespeople handing you off to a crew you&apos;ve never met.
          </p>
          <p>
            Our team - Michael, Linda, Fedincio, and Carlos - builds kitchens, bathrooms, home
            offices, garage storage, and custom built-ins for homeowners who want work that lasts.
            When you call us, you&apos;re talking to the people who will actually build your cabinets.
          </p>
          <p className="about-closing-line">From the heart of our family, to the heart of your home.</p>
        </div>
      </div>
    </section>
  );
}
