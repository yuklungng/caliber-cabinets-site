const steps = [
  {
    number: '01',
    title: 'Initial Consultation',
    copy: "We discuss your vision, space needs, and budget to see if we're the right fit for your project.",
    image: '/images/process-consultation.webp',
    imageAlt: 'Caliber team reviewing material samples with a client',
    width: 2562,
    height: 1436,
  },
  {
    number: '02',
    title: 'Design & Measurement',
    copy: 'Precise measurements and detailed 3D layouts ensure every inch of your space is optimized.',
    image: '/images/process-design-measurement.webp',
    imageAlt: 'Detailed CAD cabinet layout drawing on screen',
    width: 2556,
    height: 1437,
  },
  {
    number: '03',
    title: 'Expert Fabrication',
    copy: 'Your cabinetry is crafted in our Livermore workshop with meticulous attention to detail.',
    image: '/images/process-fabrication.webp',
    imageAlt: 'Craftsman finishing a cabinet door in the spray booth',
    width: 2339,
    height: 1320,
  },
  {
    number: '04',
    title: 'Professional Installation',
    copy: 'Our crew installs with care, ensuring a perfect fit and clean finish for your home.',
    image: '/images/process-installation.webp',
    imageAlt: 'Installer fitting a Caliber-branded cabinet drawer box',
    width: 2555,
    height: 1439,
  },
];

export function ProcessPreview() {
  return (
    <section className="home-section process-section" id="process" aria-labelledby="process-title">
      <div className="container section-heading">
        <h2 id="process-title">Our Practical Process</h2>
        <p>A simple, predictable path to your new kitchen. No guesswork, just clear steps from start to finish.</p>
      </div>
      <div className="container process-steps">
        {steps.map((step) => (
          <article className="process-step" key={step.number}>
            <div className="process-step-image">
              <img src={step.image} alt={step.imageAlt} width={step.width} height={step.height} loading="lazy" />
            </div>
            <div className="process-step-body">
              <span aria-hidden="true">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
