import { Navigate, Route, Routes } from 'react-router-dom';
import { SiteFooter } from './components/SiteFooter.jsx';
import { SiteHeader } from './components/SiteHeader.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { ConsultationPage } from './pages/ConsultationPage.jsx';
import { EstimatePage } from './pages/EstimatePage.jsx';
import { PrivacyPolicyPage } from './pages/PrivacyPolicyPage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';

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
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
