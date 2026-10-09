// Tiny build stamp for the admin panel, pinned to the bottom-right corner.
// Values are injected at build time in vite.config.js: the package.json version,
// the commit that was deployed, and the build date.
const VERSION = import.meta.env.VITE_APP_VERSION;
const COMMIT = import.meta.env.VITE_APP_COMMIT;
const BUILT = import.meta.env.VITE_APP_BUILD_DATE;

export function VersionTag() {
  if (!VERSION) return null;
  return (
    <span
      title={`Version ${VERSION} · commit ${COMMIT} · built ${BUILT}`}
      style={{
        position: 'fixed', right: '8px', bottom: '5px', zIndex: 5,
        fontSize: '10px', lineHeight: 1, color: '#9ca3af', opacity: 0.75,
        fontFamily: 'Arial, Helvetica, sans-serif', letterSpacing: '0.02em',
      }}
    >
      v{VERSION} · {COMMIT}
    </span>
  );
}
