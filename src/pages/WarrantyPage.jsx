import { useEffect } from 'react';
import { SiteFooter } from '../components/SiteFooter.jsx';
import { SiteHeader } from '../components/SiteHeader.jsx';

// The warranty text below is Section 11 of the Master Cabinetry Agreement, form v2026, copied word for word.
// Do not paraphrase or "improve" it: it is attorney-reviewed contract language. If the agreement's Section 11
// changes, replace this text with the new Section 11 and bump the version label.
const FORM_VERSION = 'v2026';

export function WarrantyPage() {
  useEffect(() => {
    document.title = 'Workmanship Warranty | Caliber Cabinets';
  }, []);

  return (
    <div className="lead-page">
      <SiteHeader />
      <main id="main-content">
        <div className="privacy-shell">
          <div className="privacy-doc">
            <header className="privacy-header">
              <h1>Limited Workmanship Warranty</h1>
              <p className="privacy-meta">
                Master Cabinetry Agreement, Section 11 &nbsp;·&nbsp; Form {FORM_VERSION}{' '}
                &nbsp;·&nbsp; Caliber Cabinets, Inc.
              </p>
            </header>

            <section>
              <p>
                This page reproduces Section 11 of the Caliber Cabinets Master Cabinetry Agreement
                (form {FORM_VERSION}). Your signed agreement is the controlling document. If it
                differs from this page, your signed agreement governs. Terms such as
                &ldquo;Substantial Completion&rdquo; are defined in the agreement.
              </p>
            </section>

            <section>
              <h2>11. Limited Warranty</h2>
              <p>
                <strong>11.1 Workmanship Warranty.</strong> Subject to the limitations, exclusions,
                and conditions set forth in this Agreement, Contractor warrants solely to the
                original Client that installation labor personally performed by Contractor under
                this Agreement shall be free from material defects in workmanship for a period of
                one (1) year from the date of Substantial Completion (&ldquo;Limited Warranty
                Period&rdquo;). During the Limited Warranty Period, Contractor&apos;s sole and
                exclusive obligation, and Client&apos;s sole and exclusive remedy, shall be limited
                to the repair or replacement, at Contractor&apos;s sole election, of any portion of
                the Work determined by Contractor to contain a material defect in workmanship.
                Contractor shall have a reasonable opportunity to inspect any claimed defect before
                performing warranty work.
              </p>
              <p>
                <strong>WARRANTY EXCLUSIONS.</strong> The Limited Workmanship Warranty does not
                apply to: (a) ordinary wear and tear; (b) cosmetic issues not reported within ten
                (10) calendar days following Substantial Completion; (c) natural movement,
                expansion, contraction, settling, or warping of wood or wood-based products; (d)
                damage from moisture, humidity, leaks, plumbing failures, flooding, steam, or
                environmental conditions; (e) misuse, abuse, neglect, or failure to follow
                Contractor&apos;s care instructions; (f) damage caused by third parties; (g)
                customer-supplied materials or hardware; (h) modifications, repairs, or alterations
                performed by persons other than Contractor; (i) structural movement, building
                settlement, or hidden conditions; or (j) manufacturer defects, which are governed
                solely by any applicable manufacturer warranty.
              </p>
              <p>
                <strong>DISCLAIMER OF OTHER WARRANTIES.</strong> EXCEPT FOR THE EXPRESS LIMITED
                WORKMANSHIP WARRANTY SET FORTH HEREIN, CONTRACTOR EXPRESSLY DISCLAIMS, TO THE
                MAXIMUM EXTENT PERMITTED BY CALIFORNIA LAW, ANY AND ALL OTHER WARRANTIES, EXPRESS
                OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY IMPLIED WARRANTY OF MERCHANTABILITY,
                FITNESS FOR A PARTICULAR PURPOSE, OR HABITABILITY.
              </p>
              <p>
                <strong>11.2 Manufacturer Warranties.</strong> To the extent transferable,
                Contractor hereby assigns to Client any applicable manufacturer warranties on
                cabinetry materials, hardware, hinges, drawer slides, finishes, and other
                third-party products incorporated into the Project. Client acknowledges that
                Contractor is not the manufacturer of such products and does not independently
                warrant their quality, performance, or fitness for any particular purpose.
              </p>
              <p>
                <strong>11.3 Moisture and Environmental Conditions.</strong> Client agrees to
                maintain commercially reasonable interior climate control. Excessive humidity,
                moisture exposure, temperature swings, plumbing leaks, or poor ventilation may void
                warranty coverage.
              </p>
              <p>
                <strong>11.4 Limitation of Remedy.</strong> Client&apos;s exclusive remedy under
                this Agreement shall be repair or replacement of defective work. To the fullest
                extent permitted under California law, Contractor shall not be liable for
                consequential damages, incidental damages, lost profits, relocation expenses,
                temporary housing costs, loss of use damages, or emotional distress damages.
              </p>
            </section>

            <section>
              <h2>Questions about your warranty</h2>
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
    </div>
  );
}
