import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
const consultationAnchorUrl = '/#consultation';

const navItems = [
  { label: 'About', href: '/#about' },
  { label: 'Our Work', href: '/our-work' },
  { label: 'Process', href: '/#process' },
];

export function SiteHeader({ hideCta = false }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);

  // Close mobile menu on Escape key — returns focus to the toggle button
  useEffect(() => {
    if (!isMenuOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMenuOpen]);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="site-nav container" aria-label="Primary navigation">
        <a className="brand" href="/" aria-label="Caliber Cabinets home">
          <img className="brand-logo" src="/images/caliber-logo-brand.webp" alt="" aria-hidden="true" width="200" height="143" />
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

        {!hideCta && (
          <a className="nav-cta" href={consultationAnchorUrl}>
            Get Started
          </a>
        )}

        <button
          ref={menuButtonRef}
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
        {!hideCta && (
          <a
            className="button button-primary"
            href={consultationAnchorUrl}
            onClick={() => setIsMenuOpen(false)}
          >
            Get Started
          </a>
        )}
      </div>
    </header>
  );
}
