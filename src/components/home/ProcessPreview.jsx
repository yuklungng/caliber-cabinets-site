const steps = [
  {
    number: '01',
    title: 'Initial Consultation',
    copy: "We discuss your vision, space needs, and budget to see if we're the right fit for your project.",
  },
  {
    number: '02',
    title: 'Design & Measurement',
    copy: 'Precise measurements and detailed 3D layouts ensure every inch of your space is optimized.',
  },
  {
    number: '03',
    title: 'Expert Fabrication',
    copy: 'Your cabinetry is crafted in our Livermore workshop with meticulous attention to detail.',
  },
  {
    number: '04',
    title: 'Professional Installation',
    copy: 'Our crew installs with care, ensuring a perfect fit and clean finish for your home.',
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
            <span>{step.number}</span>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
