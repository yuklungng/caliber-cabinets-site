import { useState, useEffect } from 'react';

const FALLBACK_PROJECTS = [
  {
    title: 'Contemporary Kitchen Remodel',
    location: 'Clayton, CA',
    image_url: '/images/caliber-project-clayton-kitchen.webp',
  },
  {
    title: 'Modern White Kitchen',
    location: 'Livermore, CA',
    image_url: '/images/caliber-project-modern-white-kitchen.jpg',
  },
  {
    title: 'Two-Tone Kitchen Design',
    location: 'Pleasanton, CA',
    image_url: '/images/caliber-project-pleasanton-kitchen.webp',
  },
];

function pickRandom3(arr) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

export function FeaturedWork() {
  const [displayProjects, setDisplayProjects] = useState(FALLBACK_PROJECTS);

  useEffect(() => {
    fetch('/api/admin-projects')
      .then((r) => r.json())
      .then(({ projects }) => {
        const featured = (projects ?? []).filter((p) => p.featured);
        if (featured.length >= 3) {
          setDisplayProjects(pickRandom3(featured));
        } else if (featured.length > 0) {
          // Fewer than 3 featured — show what we have, pad with fallbacks if needed
          setDisplayProjects(featured);
        }
        // If none featured, keep the fallback
      })
      .catch(() => {
        // API unavailable — fallback already set
      });
  }, []);

  return (
    <section className="home-section featured-work" id="work" aria-labelledby="featured-work-title">
      <div className="container section-heading">
        <h2 id="featured-work-title">Recent Projects</h2>
        <p>
          Real work for real residents. See how we've helped homeowners across the Tri-Valley area
          transform their living spaces.
        </p>
      </div>
      <div className="container project-grid">
        {displayProjects.map((project) => (
          <article className="project-card" key={project.title}>
            <div className="project-image">
              <img
                src={project.image_url}
                alt={`${project.title} by Caliber Cabinets`}
                loading="lazy"
              />
            </div>
            <div className="project-card-body">
              <p>{project.location}</p>
              <h3>{project.title}</h3>
            </div>
          </article>
        ))}
      </div>
      <div className="container portfolio-link">
        <a href="/our-work">View all projects →</a>
      </div>
    </section>
  );
}
