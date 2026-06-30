import { useEffect, useState } from 'react';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

// Static fallback — shown until DB is seeded or if API is unavailable
const STATIC_PROJECTS = [
  {
    id: 'static-1',
    title: 'Contemporary Kitchen Remodel',
    location: 'Clayton, CA',
    image_url: '/images/caliber-project-clayton-kitchen.webp',
  },
  {
    id: 'static-2',
    title: 'Modern White Kitchen',
    location: 'Livermore, CA',
    image_url: '/images/caliber-project-modern-white-kitchen.jpg',
  },
  {
    id: 'static-3',
    title: 'Two-Tone Kitchen Design',
    location: 'Pleasanton, CA',
    image_url: '/images/caliber-project-pleasanton-kitchen.webp',
  },
  {
    id: 'static-4',
    title: 'Traditional Wood Cabinetry',
    location: 'Castro Valley, CA',
    image_url: '/images/caliber-project-traditional-wood-kitchen.jpg',
  },
];

export function GalleryPage() {
  const [projects, setProjects] = useState(STATIC_PROJECTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Our Work | Caliber Cabinets';
    window.scrollTo(0, 0);

    fetch('/api/admin-projects')
      .then((r) => r.json())
      .then(({ projects: data }) => {
        if (Array.isArray(data) && data.length > 0) setProjects(data);
      })
      .catch(() => { /* keep static fallback */ })
      .finally(() => setLoading(false));
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
            {loading ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>Loading projects…</div>
            ) : (
              <div className="gallery-project-grid">
                {projects.map((project) => (
                  <article className="gallery-project-card" key={project.id}>
                    <div className="gallery-project-image">
                      <img
                        src={project.image_url}
                        alt={`${project.title} by Caliber Cabinets — ${project.location}`}
                        loading="lazy"
                      />
                    </div>
                    <div className="gallery-project-body">
                      <p className="gallery-project-location">{project.location}</p>
                      <h2 className="gallery-project-title">{project.title}</h2>
                      {project.description && (
                        <p className="gallery-project-desc">{project.description}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
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
