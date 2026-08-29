const teamMembers = [
  {
    image: '/images/linda-photo.webp',
    name: 'Linda',
    role: 'Office Manager',
  },
  {
    image: '/images/fedincio-photo.webp',
    name: 'Fedincio',
    role: 'Lead Craftsman',
  },
  {
    image: '/images/carlos-photo.webp',
    name: 'Carlos',
    role: 'Installer',
  },
];

export function AboutSection() {
  return (
    <section className="home-section about-section" id="about" aria-labelledby="about-title">
      <div className="container about-shell">
        <div className="about-grid">
          <div className="image-frame">
            {/* TODO: Confirm correct image file for Mike photo - AI Studio uses a different shot */}
            <img
              src="/images/mike-photo.webp"
              srcSet="/images/mike-photo-900.webp 900w, /images/mike-photo.webp 2560w"
              sizes="(max-width: 768px) 390px, 550px"
              alt="Mike, owner of Caliber Cabinets"
              width="2560"
              height="1708"
              loading="lazy"
            />
          </div>
          <div className="section-copy">
            <h2 id="about-title">About Caliber Cabinets</h2>
            <p>
              Caliber Cabinets traces back to 1984, when Mike&apos;s father started building custom
              cabinetry in Livermore. Mike apprenticed under him, learning the trade hands-on,
              before incorporating the business in 2009 as Custom Cabinets by Michael
              Giannecchini, Inc., doing business as Caliber Cabinets. That&apos;s over 40 years of
              family craftsmanship - not something you manufacture. It&apos;s built job by job, over
              decades.
            </p>
            <p>
              We&apos;re a small, hands-on shop serving the Tri-Valley - Livermore, Pleasanton,
              Dublin, and the surrounding 680 corridor. Every project runs through Michael directly,
              from design to fabrication to final installation. No franchise overhead, no showroom
              salespeople handing you off to a crew you&apos;ve never met.
            </p>
            <p>
              Our team - Michael, Linda, Fedincio, and Carlos - builds kitchens, bathrooms, home
              offices, garage storage, and custom built-ins for homeowners who want work that lasts.
              When you call us, you&apos;re talking to the people who will actually build your cabinets.
            </p>
          </div>
        </div>

        <div className="about-team">
          <h3>Meet the Team</h3>
          <div className="team-grid">
            {teamMembers.map((member) => (
              <article key={member.name} className="team-member">
                <img src={member.image} alt={`${member.name}, ${member.role}`} className="team-member-photo" loading="lazy" />
                <p className="team-member-name">{member.name}</p>
                <p className="team-member-role">{member.role}</p>
              </article>
            ))}
          </div>
        </div>
        <p style={{ width: '100%', marginTop: '24px', color: '#6b7280', fontSize: '0.85rem', letterSpacing: '0.02em', textAlign: 'center' }}>
          Licensed &amp; Insured &middot; CA C-6 Contractor License #917541 &middot; A+ Rated by the Better Business Bureau
        </p>
        <p className="about-closing-line">From the heart of our family, to the heart of your home.</p>
      </div>
    </section>
  );
}
