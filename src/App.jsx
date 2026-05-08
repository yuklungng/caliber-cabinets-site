import { SiteFooter } from './components/SiteFooter.jsx';
import { SiteHeader } from './components/SiteHeader.jsx';
import { HomePage } from './pages/HomePage.jsx';

export default function App() {
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
