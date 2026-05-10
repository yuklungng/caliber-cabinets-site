function SocialIcon({ children, ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      {children}
    </svg>
  );
}

function YelpIcon(props) {
  return (
    <SocialIcon {...props}>
      <path d="M12 3.75 13.85 8l4.62-.98-2.97 3.55 3.1 3.45-4.67-.81L12 18.5l-1.93-4.29-4.67.81 3.1-3.45-2.97-3.55L10.15 8 12 3.75Z" />
    </SocialIcon>
  );
}

function HouzzIcon(props) {
  return (
    <SocialIcon {...props}>
      <path d="M7 4.5v15" />
      <path d="M12 9v10.5" />
      <path d="M17 4.5v15" />
      <path d="M7 12h10" />
    </SocialIcon>
  );
}

function FacebookIcon(props) {
  return (
    <SocialIcon {...props}>
      <path d="M13.5 20v-6h2.2l.3-2.5h-2.5V9.9c0-.8.2-1.4 1.4-1.4H16V6.3c-.2 0-.9-.1-1.8-.1-1.9 0-3.2 1.1-3.2 3.4v1.9H9v2.5h2.2v6" />
    </SocialIcon>
  );
}

function InstagramIcon(props) {
  return (
    <SocialIcon {...props}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="4" />
      <circle cx="12" cy="12" r="3.4" />
      <circle cx="17.1" cy="6.9" r="0.9" fill="currentColor" stroke="none" />
    </SocialIcon>
  );
}

const footerLinks = [
  { label: 'Our Work', href: '#work' },
  { label: 'Homeowners', href: '#homeowners' },
  { label: 'Consultation', href: 'https://calibercabinetshop.com/request-a-design-consultation/' },
];

const socialLinks = [
  {
    label: 'Yelp',
    href: 'https://www.yelp.com/biz/caliber-cabinets-livermore',
    Icon: YelpIcon,
  },
  {
    label: 'Houzz',
    href: 'https://www.houzz.com/professionals/cabinets-and-cabinetry/caliber-cabinets-inc-pfvwus-pf~629470965',
    Icon: HouzzIcon,
  },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/calcabinets/',
    Icon: FacebookIcon,
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/calibercabinets/',
    Icon: InstagramIcon,
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
            {socialLinks.map((socialLink) => (
              <a
                key={socialLink.label}
                className="footer-social-link"
                href={socialLink.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Visit Caliber Cabinets on ${socialLink.label}`}
              >
                <socialLink.Icon className="footer-social-icon" aria-hidden="true" />
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
