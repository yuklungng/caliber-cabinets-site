import { Clock3, Ruler, ShieldCheck } from 'lucide-react';

const valueProps = [
  {
    icon: Ruler,
    title: 'Premium Customization',
    copy: 'Cabinets built exactly for your space and how you use it. No fillers, no compromises.',
  },
  {
    icon: Clock3,
    title: 'Faster Execution',
    copy: 'Our efficient Livermore workshop processes ensure your project stays on schedule.',
  },
  {
    icon: ShieldCheck,
    title: 'No Surprises, Ever',
    copy: "Firm pricing, clear timelines, and proactive updates from design to final install. You'll never have to chase us for an answer.",
  },
];

export function HomeownersSection() {
  return (
    <section className="home-section homeowners-section" id="homeowners" aria-labelledby="homeowners-title">
      <div className="container homeowners-grid">
        <div className="section-copy">
          <h2 id="homeowners-title">Made for Homeowners Who Value Quality & Trust</h2>
          <p>
            Transforming your kitchen is a significant journey, not just a purchase. We focus on
            being the partner you trust to deliver exactly what was promised, on time and with
            exceptional craftsmanship.
          </p>

          <dl className="homeowner-values">
            {valueProps.map((item) => {
              const Icon = item.icon;

              return (
                <div key={item.title}>
                  <dt>
                    <span aria-hidden="true">
                      <Icon size={24} />
                    </span>
                    {item.title}
                  </dt>
                  <dd>{item.copy}</dd>
                </div>
              );
            })}
          </dl>
        </div>

        <div className="homeowners-media">
          <img
            className="homeowners-photo"
            src="/images/homeowners-family.webp"
            alt="Family gathering in a warm, custom-built kitchen"
            width="2070"
            height="1380"
            loading="lazy"
          />
          <aside className="homeowner-quote" aria-label="Homeowner pull quote">
            <blockquote>
              "The communication was night and day compared to other contractors. We actually enjoyed
              the process."
            </blockquote>
            <p>&mdash; Livermore Homeowner</p>
          </aside>
        </div>
      </div>
    </section>
  );
}
