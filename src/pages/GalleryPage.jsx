import { useEffect } from 'react';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

const projects = [
  {
    title: 'Modern White Kitchen',
    location: 'Livermore, CA',
    description: 'Crisp white shaker cabinetry with quartz countertops and custom hardware throughout.',
    image: '/images/caliber-project-modern-white-kitchen.jpg',
  },
  {
    title: 'Two-Tone Kitchen Design',
    location: 'Pleasanton, CA',
    description: 'Navy lower cabinets paired with white uppers — bold contrast with timeless proportions.',
    image: '/images/caliber-project-pleasanton-kitchen.webp',
  },
  {
    title: 'Traditional Wood Cabinetry',
    location: 'Castro Valley, CA',
    description: 'Warm stained wood with raised panel doors and crown molding throughout.',
    image: '/images/caliber-project-traditional-wood-kitchen.jpg',
  },
  {
    title: 'Contemporary Kitchen Remodel',
    location: 'Clayton, CA',
    description: 'Soft gray shaker cabinetry with a walnut island, Calacatta marble countertops, and integrated appliances.',
    image: '/images/caliber-project-clayton-kitchen.webp',
  },
];

export function GalleryPage() {
  useEffect(() => {
    document.title = 'Our Work | Caliber Cabinets';
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="lead-page">
      <SiteHeader />
      <main id="main-content">
        <section className="gallery-page-hero">
          <div className="container">
            <h1>Our Work</h1>
            <p>
              Every project is a collaboration. Here's a look at kitchens, baths, and built-ins
              we've completed for homeowners across the Tri-Valley and Diablo Valley areas.
            </p>
          </div>
        </section>

        <section className="gallery-grid-section">
          <div className="container">
            <div className="gallery-project-grid">
              {projects.map((project) => (
                <article className="gallery-project-card" key={project.title}>
                  <div className="gallery-project-image">
                    <img
                      src={project.image}
                      alt={`${project.title} by Caliber Cabinets — ${project.location}`}
                      loading="lazy"
                    />
                  </div>
                  <div className="gallery-project-body">
                    <p className="gallery-project-location">{project.location}</p>
                    <h2 className="gallery-project-title">{project.title}</h2>
                    <p className="gallery-project-desc">{project.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="gallery-cta">
          <div className="container">
            <h2>Have a project in mind?</h2>
            <p>We'd love to hear about it. Request a free design consultation and we'll follow up within one business day.</p>
            <a className="button button-primary" href="/request-a-design-consultation">
              Request a Consultation
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
