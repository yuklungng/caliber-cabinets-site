import { ArrowRight } from 'lucide-react';

// Serve a smaller poster on mobile. <video poster> doesn't support srcset so we
// pick the right file once at render time. The matching version is also preloaded
// in index.html via <link rel="preload" media="(max-width: 768px)"> / "(min-width: 769px)".
const heroPoster =
  typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
    ? '/images/caliber-showroom-hero-mobile.webp'
    : '/images/caliber-showroom-hero-fallback.webp';

export function HeroSection() {
  return (
    <section className="hero-section" aria-labelledby="home-title">
      <video
        className="hero-video"
        poster={heroPoster}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      >
        <source src="/videos/caliber-hero-craft-loop-web.mp4" type="video/mp4" />
      </video>
      <div className="hero-scrim" aria-hidden="true" />

      <div className="container hero-layout">
        <div className="hero-copy">
          <h1 id="home-title">Premium Custom Cabinetry Crafted for Your Life.</h1>
          <p className="hero-intro">
            From our Livermore workshop to your home. We combine premium craftsmanship with faster
            execution and clear communication, making your custom kitchen project smooth and
            rewarding.
          </p>
          <div className="hero-actions" aria-label="Primary calls to action">
            <a className="button button-primary" href="/#consultation">
              How Can We Help? <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="button button-secondary" href="#work">
              View Our Recent Work
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
