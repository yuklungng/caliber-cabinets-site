import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const navItems = [
  { label: 'Our Work', href: '#work' },
  { label: 'Homeowners', href: '#homeowners' },
  { label: 'Trade Partners', href: '#trade-partners' },
  { label: 'Process', href: '#process' },
];

const homeownerConsultationUrl = 'https://calibercabinetshop.com/request-a-design-consultation/';

export function SiteHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="site-nav container" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Caliber Cabinets home">
          <img className="brand-logo" src="/images/caliber-logo.jpg" alt="" aria-hidden="true" />
          <span>
            <strong>Caliber Cabinets</strong>
          </span>
        </a>

        <ul className="nav-list" id="primary-menu">
          {navItems.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>

        <a className="nav-cta" href={homeownerConsultationUrl}>
          Get Consultation
        </a>

        <button
          className="icon-button mobile-menu-button"
          type="button"
          aria-controls="mobile-menu"
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          {isMenuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </nav>

      <div className="mobile-menu container" id="mobile-menu" hidden={!isMenuOpen}>
        <ul>
          {navItems.map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={() => setIsMenuOpen(false)}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <a className="button button-primary" href={homeownerConsultationUrl} onClick={() => setIsMenuOpen(false)}>
          Get Consultation
        </a>
      </div>
    </header>
  );
}
