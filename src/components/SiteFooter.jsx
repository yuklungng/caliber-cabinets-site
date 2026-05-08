const footerLinks = [
  { label: 'Our Work', href: '#work' },
  { label: 'Homeowners', href: '#homeowners' },
  { label: 'Trade Partners', href: '#trade-partners' },
  { label: 'Consultation', href: '#consultation' },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-company">
          <p className="footer-brand">Caliber Cabinets, Inc.</p>
          <p>
            Serving Livermore and the Tri-Valley area for over 25 years. We specialize in custom
            cabinetry that fits your home and your life.
          </p>
        </div>

        <div>
          <h2>Contact Us</h2>
          <address>
            <span>
              5640 La Ribera St., Unit A
              <br />
              Livermore, CA 94550
            </span>
            <a href="tel:+19252929124">(925) 292-9124</a>
            <a href="mailto:info@calibercabinetshop.com">info@calibercabinetshop.com</a>
          </address>
        </div>

        <nav aria-label="Footer navigation">
          <h2>Navigation</h2>
          <ul>
            {footerLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="container footer-bottom">
        <p>&copy; 2026 Caliber Cabinets, Inc. All rights reserved.</p>
      </div>
    </footer>
  );
}
