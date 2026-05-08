import { Handshake } from 'lucide-react';

export function TradePartnerSection() {
  return (
    <section className="home-section trade-section" id="trade-partners" aria-labelledby="trade-partners-title">
      <div className="container trade-panel">
        <div>
          <Handshake className="trade-icon" size={40} aria-hidden="true" />
          <p className="eyebrow">Trade Partnership</p>
          <h2 id="trade-partners-title">Contractors & Designers</h2>
          <p>
            Need a reliable local cabinetry partner who respects your timelines and delights your
            clients? We provide professional support for trade partners in the Livermore area.
          </p>
        </div>
        <a className="button button-outline" href="#contact">
          Discuss Trade Terms
        </a>
      </div>
    </section>
  );
}
