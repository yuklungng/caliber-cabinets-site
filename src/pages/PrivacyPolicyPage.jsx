import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

export function PrivacyPolicyPage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <div className="lead-page">
          <div className="lead-card" style={{ maxWidth: '720px' }}>
            <h1>Privacy Policy</h1>
            <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
              Effective date: June 1, 2026 &nbsp;·&nbsp; Caliber Cabinets, Inc. &nbsp;·&nbsp;
              Livermore, CA
            </p>

            <section>
              <h2>What this policy covers</h2>
              <p>
                This policy describes how Caliber Cabinets, Inc. ("we", "our", "us") collects,
                uses, and protects information when you visit calibercabinetshop.com or submit a
                form on our site. It also describes the rights California residents have under the
                California Consumer Privacy Act (CCPA).
              </p>
            </section>

            <section>
              <h2>Information we collect</h2>
              <p>
                <strong>Information you provide directly.</strong> When you submit a design
                consultation or trade estimate request, we collect the details you enter: name,
                phone number, email address, project address, project type, and any notes or
                descriptions you include. This information is stored securely and used only to
                follow up on your request.
              </p>
              <p>
                <strong>Analytics data.</strong> We use Google Analytics 4 to understand how
                visitors use our site — which pages are visited, how long sessions last, and
                general geographic region. Google Analytics collects this data using cookies and
                anonymizes IP addresses. We do not use this data to identify individuals. You can
                opt out using the{' '}
                <a
                  href="https://tools.google.com/dlpage/gaoptout"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google Analytics opt-out browser add-on
                </a>
                .
              </p>
              <p>
                <strong>Session behavior data.</strong> We use Microsoft Clarity to capture
                anonymized session recordings and heatmaps that help us improve the site
                experience. Clarity does not capture passwords, payment details, or other sensitive
                fields. You can learn more at{' '}
                <a
                  href="https://privacy.microsoft.com/privacystatement"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Microsoft&apos;s Privacy Statement
                </a>
                .
              </p>
              <p>
                <strong>Bot-detection signals.</strong> Our contact forms use Cloudflare Turnstile
                to distinguish human visitors from automated bots. Turnstile analyzes browser
                signals without tracking cookies or storing personal data. See{' '}
                <a
                  href="https://www.cloudflare.com/privacypolicy/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Cloudflare&apos;s Privacy Policy
                </a>{' '}
                for details.
              </p>
            </section>

            <section>
              <h2>How we use your information</h2>
              <p>We use the information you submit to:</p>
              <ul>
                <li>Respond to your design consultation or estimate request</li>
                <li>Schedule follow-up calls or appointments</li>
                <li>Send confirmation and notification emails related to your request</li>
                <li>Maintain records of client inquiries for business purposes</li>
              </ul>
              <p>
                We do not use your information for advertising, profiling, or any purpose unrelated
                to your inquiry.
              </p>
            </section>

            <section>
              <h2>Third-party services</h2>
              <p>
                We use the following services to operate the site and manage inquiries. Each has
                its own privacy policy governing how it handles data.
              </p>
              <ul>
                <li>
                  <strong>Supabase</strong> — secure database storage for form submissions
                </li>
                <li>
                  <strong>Resend</strong> — transactional email delivery for lead notifications
                </li>
                <li>
                  <strong>HubSpot</strong> — CRM platform for managing and following up on
                  customer inquiries
                </li>
                <li>
                  <strong>Vercel</strong> — website hosting and serverless functions
                </li>
                <li>
                  <strong>Cloudflare</strong> — bot protection via Turnstile
                </li>
                <li>
                  <strong>Google Analytics</strong> — site analytics
                </li>
                <li>
                  <strong>Microsoft Clarity</strong> — session behavior analytics
                </li>
              </ul>
              <p>
                We do not sell, rent, or share your personal information with third parties for
                marketing purposes.
              </p>
            </section>

            <section>
              <h2>Data retention</h2>
              <p>
                Form submissions are retained for as long as needed to fulfill your request and
                for standard business record-keeping. If you would like your data removed, contact
                us at the address below.
              </p>
            </section>

            <section>
              <h2>California residents — your rights under CCPA</h2>
              <p>
                If you are a California resident, you have the following rights regarding your
                personal information:
              </p>
              <ul>
                <li>
                  <strong>Right to know.</strong> You may request a summary of the personal
                  information we have collected about you and how it has been used.
                </li>
                <li>
                  <strong>Right to delete.</strong> You may request that we delete personal
                  information we have collected, subject to certain exceptions.
                </li>
                <li>
                  <strong>Right to opt out of sale.</strong> We do not sell personal information.
                  There is nothing to opt out of.
                </li>
                <li>
                  <strong>Right to non-discrimination.</strong> We will not deny service or treat
                  you differently because you exercised your privacy rights.
                </li>
              </ul>
              <p>
                To exercise any of these rights, contact us at{' '}
                <a href="mailto:info@calibercabinetshop.com">info@calibercabinetshop.com</a> or
                by mail at the address below. We will respond within 45 days.
              </p>
            </section>

            <section>
              <h2>Cookies</h2>
              <p>
                We use cookies for analytics (Google Analytics, Microsoft Clarity) and site
                functionality. No cookies are used to track you across other websites or to build
                advertising profiles. You can disable cookies in your browser settings at any time,
                though this may affect site functionality.
              </p>
            </section>

            <section>
              <h2>Changes to this policy</h2>
              <p>
                We may update this policy from time to time. When we do, we will update the
                effective date at the top of this page. Continued use of the site after changes
                are posted constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2>Contact us</h2>
              <address>
                <strong>Caliber Cabinets, Inc.</strong>
                <br />
                5640 La Ribera St., Unit A
                <br />
                Livermore, CA 94550
                <br />
                <a href="tel:+19252929124">(925) 292-9124</a>
                <br />
                <a href="mailto:info@calibercabinetshop.com">info@calibercabinetshop.com</a>
              </address>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
