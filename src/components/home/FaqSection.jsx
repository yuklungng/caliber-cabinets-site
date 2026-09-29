import { useEffect, useMemo, useState } from 'react';
import { FAQ_CATEGORIES, sortFaqs } from '../../lib/faqCategories.js';

// Fallback shown until the API responds (or if it fails). Live content is managed
// in Admin → Content → FAQs and served from /api/admin-projects?resource=faqs.
const FALLBACK_FAQS = [
  { id: 'f1', category: 'Service and scope', sort_order: 10, question: 'Which cities do you serve?', answer: 'Caliber Cabinets serves Livermore and the broader Tri-Valley area, including Pleasanton, Dublin, San Ramon, Danville, Walnut Creek, and Alamo in the East Bay of California.' },
  { id: 'f2', category: 'Process and timing', sort_order: 20, question: 'Do you offer free consultations?', answer: 'Yes, Caliber Cabinets offers a free design consultation. You can request one online at calibercabinetshop.com.' },
];

// Questions shown before "Show all" within the selected view. Order comes from
// Admin → Content → FAQs. JSON-LD always includes every published FAQ.
const INITIAL_VISIBLE = 5;
const ALL = 'All';

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
  const [showAll, setShowAll] = useState(false);
  const [activeCategory, setActiveCategory] = useState(ALL);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin-projects?resource=faqs')
      .then((r) => r.json())
      .then(({ faqs: data }) => {
        if (cancelled) return;
        if (Array.isArray(data)) {
          const sorted = sortFaqs(data);
          setFaqs(sorted);
          syncJsonLd(sorted);
        }
      })
      .catch(() => { /* keep fallback + static JSON-LD */ })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Only categories that currently have published FAQs get a pill
  const categories = useMemo(() => {
    const present = new Set(faqs.map((f) => f.category));
    return FAQ_CATEGORIES.filter((c) => present.has(c));
  }, [faqs]);

  // Once loaded, an empty list means everything is unpublished: hide the section.
  if (loaded && faqs.length === 0) return null;

  const inView = activeCategory === ALL ? faqs : faqs.filter((f) => f.category === activeCategory);
  const visible = showAll ? inView : inView.slice(0, INITIAL_VISIBLE);

  function pick(cat) {
    setActiveCategory(cat);
    setShowAll(false);
  }

  return (
    <section className="home-section faq-section" id="faq" aria-labelledby="faq-title">
      <div className="container section-heading">
        <p className="eyebrow">Common Questions</p>
        <h2 id="faq-title">Frequently Asked Questions</h2>
        <p>Straight answers about working with Caliber Cabinets, from first consultation to final install.</p>
      </div>

      {categories.length > 1 && (
        <div className="container faq-filters" role="group" aria-label="Filter questions by topic">
          {[ALL, ...categories].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`faq-pill${activeCategory === cat ? ' is-active' : ''}`}
              aria-pressed={activeCategory === cat}
              onClick={() => pick(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="container faq-list">
        {visible.map((faq) => (
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
        {inView.length > INITIAL_VISIBLE && (
          <button
            type="button"
            className="faq-toggle"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? 'Show fewer questions' : `Show all ${inView.length} questions`}
          </button>
        )}
      </div>
    </section>
  );
}
