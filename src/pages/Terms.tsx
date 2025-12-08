import React from "react";

export default function Terms() {
  return (
    <main
      style={{
        padding: "2rem",
        maxWidth: "960px",
        margin: "0 auto",
        lineHeight: 1.6,
      }}
    >
      <h1>Terms of Service — Purple Music</h1>
      <p>Last updated: December 8, 2025</p>

      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using Purple Music, you agree to these Terms of Service and the accompanying Privacy Policy. If you do not agree
          with all conditions, you must stop using the Service immediately.
        </p>
      </section>

      <section>
        <h2>2. Service Description</h2>
        <p>
          Purple Music provides music discovery and playback through the official YouTube IFrame Player. The Service does not host or store
          any YouTube audio or video files; every stream comes directly from YouTube servers. Purple Music relies on the Pi Network SDK for
          login and Pi payments, and Supabase for secure storage of user metadata and playlist information. Because the Service depends on
          these third-party platforms, we cannot control outages, policy changes, or other issues arising from YouTube, Pi Network, or Supabase.
        </p>
      </section>

      <section>
        <h2>3. Third-Party Platform Terms</h2>
        <ul>
          <li>
            <strong>YouTube:</strong> Playback uses the visible YouTube IFrame Player with controls set to controls=1 and YouTube branding
            displayed. Downloading, recording, scraping, or modifying YouTube content is prohibited. Use of YouTube content is subject to the
            YouTube Terms of Service, YouTube API Services Terms of Service, and Google Privacy Policy.
          </li>
          <li>
            <strong>Pi Network:</strong> Login and payments occur exclusively through the official Pi SDK. Use of Pi services is governed by the
            Pi Network Terms and Pi Developer Terms of Use.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Accounts and Security</h2>
        <ul>
          <li>You must be at least 13 years old or meet the minimum legal age in your jurisdiction.</li>
          <li>You are responsible for safeguarding your device, account credentials, and any activity under your account.</li>
          <li>Purple Music may suspend or terminate access for violations of laws or these Terms.</li>
          <li>Purple Music never stores Pi passwords, private keys, or other sensitive authentication secrets.</li>
        </ul>
      </section>

      <section>
        <h2>5. Premium Plans and Payments</h2>
        <ul>
          <li>Weekly or monthly premium plans are available and priced in Pi currency.</li>
          <li>Payments are initiated through the Pi SDK and validated server-side before benefits are granted.</li>
          <li>Premium renewals are manual; benefits end automatically on the premium_until timestamp.</li>
          <li>Refunds are not provided once digital benefits are delivered, except where required by law.</li>
        </ul>
      </section>

      <section>
        <h2>6. Acceptable Use</h2>
        <ul>
          <li>No attempts to download or redistribute YouTube content.</li>
          <li>No removal or concealment of YouTube controls, branding, or attribution.</li>
          <li>No scraping or automated data extraction from YouTube or Pi Network.</li>
          <li>No circumvention of payment verification or fraud prevention processes.</li>
          <li>No abusive, fraudulent, harmful, or unlawful conduct.</li>
          <li>No interference with Pi Network, YouTube API, or Supabase infrastructure.</li>
        </ul>
      </section>

      <section>
        <h2>7. User Content &amp; Intellectual Property</h2>
        <p>
          Users retain rights to the content they create, such as playlist names or descriptions. By submitting content, you grant Purple Music
          a limited license to display and operate that content within the Service. Purple Music UI, branding, and code remain proprietary, while
          Pi-related integration logic is licensed under the PiOS License as required by Section 5 of the Pi Network Developer Terms of Use.
        </p>
      </section>

      <section>
        <h2>8. Copyright Complaints</h2>
        <p>
          Rights holders who believe their content is being misused may email nikolastojadinov@yahoo.co.uk with relevant links, screenshots,
          and proof of ownership. Purple Music will review and act consistent with applicable laws.
        </p>
      </section>

      <section>
        <h2>9. Privacy</h2>
        <p>
          The Privacy Policy describes what data Purple Music collects and how it is used. By using the Service, you agree to the Privacy Policy
          in addition to these Terms.
        </p>
      </section>

      <section>
        <h2>10. Disclaimers</h2>
        <ul>
          <li>The Service is provided "as is" and "as available."</li>
          <li>Purple Music is not responsible for outages, errors, or policy changes from YouTube, Pi Network, or Supabase.</li>
          <li>Purple Music is not responsible for network failures, loss of data caused by external services, or the availability of YouTube content.</li>
        </ul>
      </section>

      <section>
        <h2>11. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Purple Music is not liable for indirect, incidental, special, consequential, or punitive
          damages, including loss of profits, data, or goodwill. Users assume responsibility for their use of the Service.
        </p>
      </section>

      <section>
        <h2>12. Indemnification</h2>
        <p>
          You agree to indemnify and hold Purple Music harmless from claims, damages, or expenses arising from misuse of the Service, violations
          of these Terms, or infringement of third-party rights.
        </p>
      </section>

      <section>
        <h2>13. Changes to These Terms</h2>
        <p>
          Purple Music may update these Terms at any time. Updated versions will be posted on this page, and continued use after changes are
          published signifies acceptance of the revised Terms.
        </p>
      </section>

      <section>
        <h2>14. Termination</h2>
        <p>
          Purple Music may suspend or terminate access for violations of these Terms or legal requirements. You may stop using the Service at
          any time.
        </p>
      </section>

      <section>
        <h2>15. Governing Law</h2>
        <p>
          These Terms are governed by the laws of your country of residence unless mandatory law dictates otherwise.
        </p>
      </section>

      <section>
        <h2>16. Contact</h2>
        <p>
          For support or legal inquiries, email <a href="mailto:nikolastojadinov@yahoo.co.uk">nikolastojadinov@yahoo.co.uk</a>.
        </p>
      </section>
    </main>
  );
}
