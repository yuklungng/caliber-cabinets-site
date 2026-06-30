export function VideoIntroSection() {
  return (
    <section className="home-section video-intro" id="video-intro" aria-labelledby="video-intro-title">
      <div className="container centered-section">
        <h2 id="video-intro-title">See How We Work</h2>
        <p>Take a closer look at how we approach design, build, and installation.</p>
        <div className="video-frame">
          <video
            className="section-video"
            controls
            preload="metadata"
            poster="/images/caliber-showroom-video-poster.webp"
          >
            <source src="/videos/caliber-about-film-web.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
    </section>
  );
}
