import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

// ─── Dark mode ──────────────────────────────────────────────────────────────
// Per-browser preference (see AdminPage). Dark mode is a CSS filter invert
// applied to the main content — but `position: fixed` overlays (dropdowns,
// modals, chart tooltips) can't live inside that filtered subtree: a `filter`
// on an ancestor becomes the containing block for fixed descendants, which
// breaks their viewport-relative positioning the moment the page is scrolled.
// FixedOverlay portals them to <body> instead, in their own unfiltered-by-page
// fixed layer, and applies the same invert directly so they still look dark.
export const DarkModeContext = createContext(false);

export function FixedOverlay({ children }) {
  const darkMode = useContext(DarkModeContext);
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, ...(darkMode ? { filter: 'invert(1) hue-rotate(180deg)' } : {}) }}>
      <div style={{ pointerEvents: 'auto' }}>{children}</div>
    </div>,
    document.body,
  );
}
