const projects = [
  {
    title: 'Modern White Kitchen',
    location: 'Livermore, CA',
    image: '/images/caliber-project-modern-white-kitchen.jpg',
  },
  {
    title: 'Two-Tone Kitchen Design',
    location: 'Pleasanton, CA',
    image: '/images/caliber-project-pleasanton-kitchen.webp',
  },
  {
    title: 'Traditional Wood Cabinetry',
    location: 'Castro Valley, CA',
    image: '/images/caliber-project-traditional-wood-kitchen.jpg',
  },
];

export function FeaturedWork() {
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
        {projects.map((project) => (
          <article className="project-card" key={project.title}>
            <div className="project-image">
              <img src={project.image} alt={`${project.title} by Caliber Cabinets`} loading="lazy" />
            </div>
            <div className="project-card-body">
              <p>{project.location}</p>
              <h3>{project.title}</h3>
            </div>
          </article>
        ))}
      </div>
      <div className="container portfolio-link">
        <a href="#work">View full portfolio</a>
      </div>
    </section>
  );
}
