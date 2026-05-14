import { AboutSection } from '../components/home/AboutSection.jsx';
import { ConsultationPrepSection } from '../components/home/ConsultationPrepSection.jsx';
import { ContactCta } from '../components/home/ContactCta.jsx';
import { FeaturedWork } from '../components/home/FeaturedWork.jsx';
import { HeroSection } from '../components/home/HeroSection.jsx';
import { HomeownersSection } from '../components/home/HomeownersSection.jsx';
import { ProcessPreview } from '../components/home/ProcessPreview.jsx';
import { TestimonialsSection } from '../components/home/TestimonialsSection.jsx';
import { VideoIntroSection } from '../components/home/VideoIntroSection.jsx';

export function HomePage() {
  return (
    <div className="home-shell">
      <HeroSection />
      <VideoIntroSection />
      <AboutSection />
      <FeaturedWork />
      <HomeownersSection />
      <ProcessPreview />
      <TestimonialsSection />
      <ConsultationPrepSection />
      <ContactCta />
    </div>
  );
}
