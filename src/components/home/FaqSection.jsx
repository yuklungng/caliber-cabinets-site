import { useEffect, useState } from 'react';

// Fallback shown until the API responds (or if it fails). Live content is managed
// in Admin → Content → FAQs and served from /api/admin-projects?resource=faqs.
const FALLBACK_FAQS = [
  { id: 'f1', question: 'What areas does Caliber Cabinets serve?', answer: 'Caliber Cabinets serves Livermore and the broader Tri-Valley area, including Pleasanton, Dublin, San Ramon, Danville, Walnut Creek, and Alamo in the East Bay of California.' },
  { id: 'f2', question: 'Do you offer free consultations?', answer: 'Yes, Caliber Cabinets offers a free design consultation. You can request one online at calibercabinetshop.com.' },
];

function syncJsonLd(faqs) {
  if (!faqs.length) return;
  const json = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
  let el = document.getElementById('faq-jsonld');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'faq-jsonld';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(json);
}

export function FaqSection() {
  const [faqs, setFaqs] = useState(FALLBACK_FAQS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin-projects?resource=faqs')
      .then((r) => r.json())
      .then(({ faqs: data }) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          setFaqs(data);
          syncJsonLd(data);
        }
      })
      .catch(() => { /* keep fallback + static JSON-LD */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Once loaded, an empty list means everything is unpublished: hide the section.
  if (loaded && faqs.length === 0) return null;

  return (
    <section className="home-section faq-section" id="faq" aria-labelledby="faq-title">
      <div className="container section-heading">
        <p className="eyebrow">Common Questions</p>
        <h2 id="faq-title">Frequently Asked Questions</h2>
        <p>Straight answers about working with Caliber Cabinets, from first consultation to final install.</p>
      </div>
      <div className="container faq-list">
        {faqs.map((faq) => (
          <details className="faq-item" key={faq.id}>
            <summary>
              <span>{faq.question}</span>
              <span className="faq-icon" aria-hidden="true" />
            </summary>
            <div className="faq-answer">
              <p>{faq.answer}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
