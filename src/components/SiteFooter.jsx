import { Facebook, Instagram, MessageCircleMore, PencilRuler } from 'lucide-react';

const footerLinks = [
  { label: 'Our Work', href: '#work' },
  { label: 'Homeowners', href: '#homeowners' },
  { label: 'Trade Partners', href: '#trade-partners' },
  { label: 'Consultation', href: 'https://calibercabinetshop.com/request-a-design-consultation/' },
];

const socialLinks = [
  {
    label: 'Yelp',
    href: 'https://www.yelp.com/biz/caliber-cabinets-livermore',
    icon: MessageCircleMore,
  },
  {
    label: 'Houzz',
    href: 'https://www.houzz.com/professionals/cabinets-and-cabinetry/caliber-cabinets-pfvwus-pf~1361985220',
    icon: PencilRuler,
  },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/calcabinets/',
    icon: Facebook,
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/calibercabinets/',
    icon: Instagram,
  },
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
          <div className="footer-social" aria-label="Social media links">
            {socialLinks.map(({ label, href, icon }) => (
              <a
                key={label}
                className="footer-social-link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Visit Caliber Cabinets on ${label}`}
              >
                {icon({ size: 16, 'aria-hidden': 'true' })}
              </a>
            ))}
          </div>
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
