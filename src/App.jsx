import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { SiteFooter } from './components/SiteFooter.jsx';
import { SiteHeader } from './components/SiteHeader.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { ConsultationPage } from './pages/ConsultationPage.jsx';
import { EstimatePage } from './pages/EstimatePage.jsx';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage.jsx';
import { GalleryPage } from './pages/GalleryPage.jsx';

// Lazy-load AdminPage — keeps Supabase and admin code out of the public visitor bundle
const AdminPage = lazy(() => import('./pages/AdminPage.jsx').then((m) => ({ default: m.AdminPage })));

function HomeRoute() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <HomePage />
      </main>
      <SiteFooter />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/request-a-design-consultation" element={<ConsultationPage />} />
      <Route path="/request-design-estimate" element={<EstimatePage />} />
      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
      <Route path="/our-work" element={<GalleryPage />} />
      <Route path="/admin" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
